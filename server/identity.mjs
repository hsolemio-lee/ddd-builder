import { randomBytes, randomUUID, createHash } from 'node:crypto';
import * as oidc from 'openid-client';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const roles = ['viewer', 'editor', 'admin'];
const fail = (status, message = '요청을 허용할 수 없습니다.') => {
  throw Object.assign(new Error(message), { status });
};
const email = (value) => {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  )
    fail(400, '이메일 형식이 올바르지 않습니다.');
  return value.trim().toLowerCase();
};
const cookie = (req, name) =>
  req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + '='))
    ?.slice(name.length + 1);
const validateFields = (value, fields) => {
  if (!value || Object.keys(value).some((key) => !fields.includes(key)))
    fail(400, '허용되지 않은 필드가 있습니다.');
};
const userView = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  siteAdmin: Boolean(row.site_admin),
});
const tokenView = (row) => ({
  id: row.id,
  name: row.name,
  projectId: row.project_id,
  scope: row.scope,
  expiresAt: new Date(row.expires_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
});
const inviteView = (row) => ({
  id: row.id,
  email: row.email,
  role: row.role,
  expiresAt: new Date(row.expires_at).toISOString(),
});

export function validateAuthConfig(
  auth = { mode: 'legacy' },
  serviceMode = 'workshop',
  publicUrl,
) {
  if (!['workshop', 'production'].includes(serviceMode))
    throw new Error('SERVICE_MODE must be workshop or production.');
  if (!['legacy', 'oidc'].includes(auth.mode))
    throw new Error('AUTH_MODE must be legacy or oidc.');
  if (serviceMode === 'production' && auth.mode !== 'oidc')
    throw new Error('production requires OIDC authentication.');
  if (auth.mode === 'legacy') return;
  if (
    ![
      auth.issuer,
      auth.clientId,
      auth.clientSecret,
      auth.ownerEmail,
      publicUrl,
    ].every((v) => typeof v === 'string' && v.trim())
  )
    throw new Error(
      'OIDC issuer, client ID, client secret, owner email and PUBLIC_URL are required.',
    );
  let issuer, address;
  try {
    issuer = new URL(auth.issuer);
    address = new URL(publicUrl);
    email(auth.ownerEmail);
  } catch {
    throw new Error('OIDC issuer, owner email or PUBLIC_URL is invalid.');
  }
  const loopback = (url) =>
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const insecureTest =
    auth.testOnlyAllowInsecureLoopback === true &&
    serviceMode === 'workshop' &&
    issuer.protocol === 'http:' &&
    address.protocol === 'http:' &&
    loopback(issuer) &&
    loopback(address);
  if (auth.testOnlyAllowInsecureLoopback && !insecureTest)
    throw new Error(
      'OIDC test-only insecure loopback override is unavailable in production.',
    );
  if (
    (!insecureTest &&
      (issuer.protocol !== 'https:' || address.protocol !== 'https:')) ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    address.username ||
    address.password ||
    address.pathname !== '/' ||
    address.search ||
    address.hash
  )
    throw new Error(
      'OIDC issuer and PUBLIC_URL must use canonical HTTPS addresses.',
    );
}

export async function createIdentity({
  store,
  auth,
  publicUrl,
  safeguards,
  onChange,
}) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS auth_users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,site_admin INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS auth_identities(issuer TEXT NOT NULL,sub TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES auth_users(id),PRIMARY KEY(issuer,sub));
    CREATE TABLE IF NOT EXISTS auth_memberships(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES auth_users(id),role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),PRIMARY KEY(project_id,user_id));
    CREATE TABLE IF NOT EXISTS auth_invitations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,email TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS auth_invite_email ON auth_invitations(email);
    CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES auth_users(id),expires_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_tokens(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES auth_users(id),project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL,scope TEXT NOT NULL CHECK(scope IN ('read','write')),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_audit(id TEXT PRIMARY KEY,at INTEGER NOT NULL,request_id TEXT NOT NULL,actor_id TEXT,event TEXT NOT NULL,project_id TEXT,target_id TEXT,outcome TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS auth_audit_at ON auth_audit(at);`);
  const config = await oidc.discovery(
    new URL(auth.issuer),
    auth.clientId,
    { client_secret: auth.clientSecret },
    undefined,
    {
      execute: [
        ...(auth.testOnlyAllowInsecureLoopback
          ? [oidc.allowInsecureRequests]
          : []),
        oidc.enableNonRepudiationChecks,
      ],
      timeout: 10,
    },
  );
  const redirectUri = new URL('/api/auth/callback', publicUrl).href;
  const secure = new URL(publicUrl).protocol === 'https:' ? '; Secure' : '';
  const sessionCookie = (token, maxAge = 43200) =>
    `ddd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
  const flowCookie = (token, maxAge = 300) =>
    `ddd_oidc_flow=${token}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}${secure}`;
  const flows = new Map();
  let auditPrunedAt = 0;
  function pruneAudit(now = Date.now()) {
    if (now - auditPrunedAt >= 86400000) {
      db.prepare('DELETE FROM auth_audit WHERE at<?').run(now - 90 * 86400000);
      auditPrunedAt = now;
    }
  }
  function audit(
    requestId,
    signed,
    event,
    outcome = 'success',
    projectId,
    targetId,
  ) {
    const now = Date.now();
    pruneAudit(now);
    db.prepare('INSERT INTO auth_audit VALUES (?,?,?,?,?,?,?,?)').run(
      randomUUID(),
      now,
      requestId,
      signed?.user?.id ?? null,
      event,
      projectId ?? null,
      targetId ?? null,
      outcome,
    );
  }
  function prune() {
    const now = Date.now();
    pruneAudit(now);
    db.prepare(
      'DELETE FROM auth_sessions WHERE expires_at<=? OR last_seen<=?',
    ).run(now, now - 1800000);
    db.prepare('DELETE FROM auth_tokens WHERE expires_at<=?').run(now);
    db.prepare('DELETE FROM auth_invitations WHERE expires_at<=?').run(now);
    for (const [key, flow] of flows)
      if (flow.expiresAt <= now) flows.delete(key);
  }
  function credential(raw, bearer = false, touch = true) {
    if (!raw || raw.length > 200) return null;
    const now = Date.now();
    const item = bearer
      ? db
          .prepare(
            'SELECT t.*,u.id AS uid,u.name AS uname,u.email,u.site_admin,u.disabled FROM auth_tokens t JOIN auth_users u ON u.id=t.user_id WHERE token_hash=? AND expires_at>?',
          )
          .get(hash(raw), now)
      : db
          .prepare(
            'SELECT s.*,u.id AS uid,u.name AS uname,u.email,u.site_admin,u.disabled FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>? AND last_seen>?',
          )
          .get(hash(raw), now, now - 1800000);
    if (!item || item.disabled) return null;
    if (!bearer && touch)
      db.prepare('UPDATE auth_sessions SET last_seen=? WHERE token_hash=?').run(
        now,
        hash(raw),
      );
    return {
      token: raw,
      bearer,
      user: userView({ ...item, id: item.uid, name: item.uname }),
      ...(bearer
        ? {
            projectId: item.project_id,
            scope: item.scope,
            credentialId: item.id,
          }
        : {}),
    };
  }
  function session(req) {
    const authorization = req.headers.authorization;
    if (authorization !== undefined)
      return /^Bearer [A-Za-z0-9_-]+$/.test(authorization)
        ? credential(authorization.slice(7), true)
        : null;
    return credential(cookie(req, 'ddd_session'));
  }
  function refresh(signed, touch = true) {
    const current = credential(signed?.token, signed?.bearer, touch);
    if (!current) fail(401, '먼저 접속해 주세요.');
    return current;
  }
  function human(signed) {
    if (signed.bearer) fail(403);
  }
  function role(signed, projectId) {
    if (signed.bearer && signed.projectId !== projectId) return undefined;
    return db
      .prepare(
        'SELECT role FROM auth_memberships WHERE project_id=? AND user_id=?',
      )
      .get(projectId, signed.user.id)?.role;
  }
  function project(signed, projectId, minimum = 'viewer') {
    signed = refresh(signed);
    const effective = role(signed, projectId);
    if (!effective || !store.project(projectId))
      fail(404, '프로젝트를 찾을 수 없습니다.');
    if (
      roles.indexOf(effective) < roles.indexOf(minimum) ||
      (signed.bearer && minimum !== 'viewer' && signed.scope !== 'write')
    )
      fail(403);
    return signed;
  }
  function state(signed) {
    signed = refresh(signed, false);
    const state = store.state();
    const projects = state.projects.flatMap((p) => {
      const r = role(signed, p.id);
      return r
        ? [
            {
              ...p,
              role: signed.bearer
                ? signed.scope === 'read'
                  ? 'viewer'
                  : r === 'admin'
                    ? 'editor'
                    : r
                : r,
            },
          ]
        : [];
    });
    const ids = new Set(projects.map((p) => p.id));
    return { projects, cards: state.cards.filter((c) => ids.has(c.projectId)) };
  }
  function addAdmin(signed, projectId) {
    db.prepare('INSERT INTO auth_memberships VALUES (?,?,?)').run(
      projectId,
      signed.user.id,
      'admin',
    );
  }
  function activeAdmins(projectId) {
    return db
      .prepare(
        "SELECT count(*) AS n FROM auth_memberships m JOIN auth_users u ON u.id=m.user_id WHERE project_id=? AND role='admin' AND disabled=0",
      )
      .get(projectId).n;
  }
  function protectAdmin(projectId, userId, nextRole) {
    const member = db
      .prepare(
        'SELECT m.role,u.disabled FROM auth_memberships m JOIN auth_users u ON u.id=m.user_id WHERE project_id=? AND user_id=?',
      )
      .get(projectId, userId);
    if (
      member?.role === 'admin' &&
      !member.disabled &&
      nextRole !== 'admin' &&
      activeAdmins(projectId) <= 1
    )
      fail(409, '마지막 프로젝트 관리자는 제거할 수 없습니다.');
  }
  function acceptIdentity(claims) {
    if (
      claims.email_verified !== true ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.sub.length > 1000
    )
      fail(401);
    const address = email(claims.email);
    const existing = db
      .prepare(
        'SELECT u.* FROM auth_identities i JOIN auth_users u ON u.id=i.user_id WHERE issuer=? AND sub=?',
      )
      .get(auth.issuer, claims.sub);
    if (existing?.disabled) fail(401);
    const bootstrap =
      !db
        .prepare(
          "SELECT value FROM metadata WHERE key='identity_owner_bootstrapped'",
        )
        .get() && address === email(auth.ownerEmail);
    const invites = db
      .prepare('SELECT * FROM auth_invitations WHERE email=? AND expires_at>?')
      .all(address, Date.now());
    if (!existing && !bootstrap && !invites.length) fail(403);
    let user = existing;
    if (!user) {
      user = {
        id: randomUUID(),
        name:
          typeof claims.name === 'string' && claims.name.trim()
            ? claims.name.trim().slice(0, 60)
            : address.split('@')[0],
        email: address,
        site_admin: bootstrap ? 1 : 0,
        disabled: 0,
      };
      db.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?)').run(
        user.id,
        user.name,
        user.email,
        user.site_admin,
        0,
      );
      db.prepare('INSERT INTO auth_identities VALUES (?,?,?)').run(
        auth.issuer,
        claims.sub,
        user.id,
      );
    }
    if (bootstrap) {
      db.prepare('UPDATE auth_users SET site_admin=1 WHERE id=?').run(user.id);
      user.site_admin = 1;
      db.prepare(
        "INSERT INTO metadata VALUES ('identity_owner_bootstrapped',?)",
      ).run(user.id);
      for (const p of store.state().projects)
        db.prepare(
          "INSERT INTO auth_memberships VALUES (?,?,'admin') ON CONFLICT(project_id,user_id) DO UPDATE SET role='admin'",
        ).run(p.id, user.id);
    }
    for (const invitation of invites) {
      const current = db
        .prepare(
          'SELECT role FROM auth_memberships WHERE project_id=? AND user_id=?',
        )
        .get(invitation.project_id, user.id)?.role;
      const r =
        roles.indexOf(current) > roles.indexOf(invitation.role)
          ? current
          : invitation.role;
      db.prepare(
        'INSERT INTO auth_memberships VALUES (?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role',
      ).run(invitation.project_id, user.id, r);
      db.prepare('DELETE FROM auth_invitations WHERE id=?').run(invitation.id);
    }
    return userView(user);
  }
  async function routes({
    path,
    method,
    req,
    res,
    signed,
    requestId,
    body,
    json,
  }) {
    const redirect = (location, cookies) => {
      res.writeHead(302, {
        location,
        'cache-control': 'no-store',
        ...(cookies ? { 'set-cookie': cookies } : {}),
      });
      res.end();
    };
    if (path === '/api/auth/login' && method === 'GET') {
      prune();
      if (flows.size >= 200) fail(429);
      const state = oidc.randomState(),
        nonce = oidc.randomNonce(),
        verifier = oidc.randomPKCECodeVerifier(),
        binding = secret();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      if (flows.size >= 200) fail(429);
      flows.set(state, {
        nonce,
        verifier,
        binding: hash(binding),
        expiresAt: Date.now() + 300000,
      });
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        response_type: 'code',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      redirect(url.href, flowCookie(binding));
      return true;
    }
    if (path === '/api/auth/callback' && method === 'GET') {
      const url = new URL(req.url, publicUrl);
      const state = url.searchParams.get('state');
      const flow = flows.get(state);
      flows.delete(state);
      try {
        if (
          !flow ||
          flow.expiresAt <= Date.now() ||
          flow.binding !== hash(cookie(req, 'ddd_oidc_flow') || '')
        )
          fail(401);
        const result = await oidc.authorizationCodeGrant(config, url, {
          expectedState: state,
          expectedNonce: flow.nonce,
          pkceCodeVerifier: flow.verifier,
          idTokenExpected: true,
        });
        prune();
        const { user, token } = store.transaction(() => {
          const user = acceptIdentity(result.claims());
          const old = cookie(req, 'ddd_session');
          if (old)
            db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(
              hash(old),
            );
          if (
            db.prepare('SELECT count(*) AS n FROM auth_sessions').get().n >=
            safeguards.maxSessions
          )
            fail(429);
          const token = secret();
          db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run(
            hash(token),
            user.id,
            Date.now() + Math.min(safeguards.sessionLifetimeMs, 43200000),
            Date.now(),
          );
          audit(requestId, { user }, 'auth.login');
          return { user, token };
        });
        onChange();
        redirect('/', [
          flowCookie('', 0),
          sessionCookie(
            token,
            Math.max(
              1,
              Math.floor(
                Math.min(safeguards.sessionLifetimeMs, 43200000) / 1000,
              ),
            ),
          ),
        ]);
      } catch {
        audit(requestId, null, 'auth.login', 'failure');
        redirect('/?login_error=auth_failed', flowCookie('', 0));
      }
      return true;
    }
    if (path === '/api/session' && method === 'POST')
      fail(405, 'OIDC 로그인을 사용해 주세요.');
    if (!signed) return false;
    if (path === '/api/session' && ['GET', 'DELETE'].includes(method)) {
      human(signed);
      if (method === 'GET') json(res, 200, { user: signed.user });
      else {
        store.transaction(() => {
          db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(
            hash(signed.token),
          );
          audit(requestId, signed, 'session.logout');
        });
        onChange();
        json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0) });
      }
      return true;
    }
    if (path === '/api/tokens') {
      human(signed);
      if (method === 'GET') {
        prune();
        json(res, 200, {
          tokens: db
            .prepare(
              'SELECT * FROM auth_tokens WHERE user_id=? ORDER BY created_at',
            )
            .all(signed.user.id)
            .map(tokenView),
        });
        return true;
      }
      if (method === 'POST') {
        const value = await body(req);
        signed = refresh(signed);
        validateFields(value, ['name', 'projectId', 'scope', 'days']);
        if (
          typeof value.name !== 'string' ||
          !value.name.trim() ||
          value.name.length > 80 ||
          !['read', 'write'].includes(value.scope ?? 'read') ||
          !Number.isInteger(value.days ?? 7) ||
          (value.days ?? 7) < 1 ||
          (value.days ?? 7) > 30 ||
          typeof value.projectId !== 'string'
        )
          fail(400);
        project(
          signed,
          value.projectId,
          value.scope === 'write' ? 'editor' : 'viewer',
        );
        const token = secret(),
          row = {
            id: randomUUID(),
            name: value.name.trim(),
            project_id: value.projectId,
            scope: value.scope ?? 'read',
            created_at: Date.now(),
            expires_at: Date.now() + (value.days ?? 7) * 86400000,
          };
        store.transaction(() => {
          db.prepare('INSERT INTO auth_tokens VALUES (?,?,?,?,?,?,?,?)').run(
            row.id,
            hash(token),
            signed.user.id,
            row.project_id,
            row.name,
            row.scope,
            row.created_at,
            row.expires_at,
          );
          audit(
            requestId,
            signed,
            'token.create',
            'success',
            row.project_id,
            row.id,
          );
        });
        json(res, 201, { token, credential: tokenView(row) });
        return true;
      }
    }
    let match;
    if (
      (match = path.match(/^\/api\/tokens\/([^/]+)$/)) &&
      method === 'DELETE'
    ) {
      human(signed);
      signed = refresh(signed);
      const row = db
        .prepare('SELECT * FROM auth_tokens WHERE id=? AND user_id=?')
        .get(match[1], signed.user.id);
      if (!row) fail(404);
      store.transaction(() => {
        db.prepare('DELETE FROM auth_tokens WHERE id=?').run(row.id);
        audit(
          requestId,
          signed,
          'token.revoke',
          'success',
          row.project_id,
          row.id,
        );
      });
      onChange();
      json(res, 200, { ok: true });
      return true;
    }
    if (
      (match = path.match(
        /^\/api\/projects\/([^/]+)\/(access|invitations|members)(?:\/([^/]+))?$/,
      ))
    ) {
      human(signed);
      project(signed, match[1], 'admin');
      const [, projectId, action, targetId] = match;
      if (action === 'access' && method === 'GET' && !targetId) {
        json(res, 200, {
          members: db
            .prepare(
              'SELECT u.id AS userId,u.name,u.email,m.role FROM auth_memberships m JOIN auth_users u ON u.id=m.user_id WHERE project_id=?',
            )
            .all(projectId),
          invitations: db
            .prepare(
              'SELECT * FROM auth_invitations WHERE project_id=? AND expires_at>?',
            )
            .all(projectId, Date.now())
            .map(inviteView),
        });
        return true;
      }
      if (action === 'invitations' && method === 'POST' && !targetId) {
        const value = await body(req);
        signed = project(signed, projectId, 'admin');
        validateFields(value, ['email', 'role']);
        const address = email(value.email);
        if (!roles.includes(value.role)) fail(400);
        const row = {
          id: randomUUID(),
          email: address,
          role: value.role,
          expires_at: Date.now() + 7 * 86400000,
        };
        store.transaction(() => {
          db.prepare(
            'DELETE FROM auth_invitations WHERE project_id=? AND email=?',
          ).run(projectId, address);
          db.prepare('INSERT INTO auth_invitations VALUES (?,?,?,?,?)').run(
            row.id,
            projectId,
            address,
            row.role,
            row.expires_at,
          );
          audit(
            requestId,
            signed,
            'invite.create',
            'success',
            projectId,
            row.id,
          );
        });
        json(res, 201, inviteView(row));
        return true;
      }
      if (action === 'invitations' && method === 'DELETE' && targetId) {
        store.transaction(() => {
          if (
            !db
              .prepare(
                'DELETE FROM auth_invitations WHERE id=? AND project_id=?',
              )
              .run(targetId, projectId).changes
          )
            fail(404);
          audit(
            requestId,
            signed,
            'invite.cancel',
            'success',
            projectId,
            targetId,
          );
        });
        json(res, 200, { ok: true });
        return true;
      }
      if (
        action === 'members' &&
        targetId &&
        ['PATCH', 'DELETE'].includes(method)
      ) {
        const value = await body(req);
        signed = project(signed, projectId, 'admin');
        validateFields(value, method === 'PATCH' ? ['role'] : []);
        if (method === 'PATCH' && !roles.includes(value.role)) fail(400);
        if (
          !db
            .prepare(
              'SELECT 1 FROM auth_memberships WHERE project_id=? AND user_id=?',
            )
            .get(projectId, targetId)
        )
          fail(404);
        protectAdmin(
          projectId,
          targetId,
          method === 'PATCH' ? value.role : null,
        );
        store.transaction(() => {
          if (method === 'PATCH')
            db.prepare(
              'UPDATE auth_memberships SET role=? WHERE project_id=? AND user_id=?',
            ).run(value.role, projectId, targetId);
          else
            db.prepare(
              'DELETE FROM auth_memberships WHERE project_id=? AND user_id=?',
            ).run(projectId, targetId);
          audit(
            requestId,
            signed,
            'member.' + (method === 'PATCH' ? 'change' : 'remove'),
            'success',
            projectId,
            targetId,
          );
        });
        onChange(targetId);
        json(res, 200, { ok: true });
        return true;
      }
    }
    if (path.startsWith('/api/admin/')) {
      human(signed);
      if (!refresh(signed).user.siteAdmin) fail(403);
      if (path === '/api/admin/users' && method === 'GET') {
        json(res, 200, {
          users: db
            .prepare('SELECT * FROM auth_users')
            .all()
            .map((u) => ({ ...userView(u), disabled: Boolean(u.disabled) })),
        });
        return true;
      }
      if (path === '/api/admin/audit' && method === 'GET') {
        json(res, 200, {
          events: db
            .prepare(
              'SELECT * FROM auth_audit ORDER BY at DESC,rowid DESC LIMIT 100',
            )
            .all()
            .map((r) => ({
              id: r.id,
              at: new Date(r.at).toISOString(),
              requestId: r.request_id,
              actorId: r.actor_id,
              event: r.event,
              ...(r.project_id ? { projectId: r.project_id } : {}),
              ...(r.target_id ? { targetId: r.target_id } : {}),
              outcome: r.outcome,
            })),
        });
        return true;
      }
      if (
        (match = path.match(/^\/api\/admin\/users\/([^/]+)$/)) &&
        method === 'PATCH'
      ) {
        const value = await body(req);
        signed = refresh(signed);
        if (!signed.user.siteAdmin) fail(403);
        validateFields(value, ['disabled', 'siteAdmin']);
        if (
          !Object.keys(value).length ||
          Object.values(value).some((v) => typeof v !== 'boolean')
        )
          fail(400);
        const target = db
          .prepare('SELECT * FROM auth_users WHERE id=?')
          .get(match[1]);
        if (!target) fail(404);
        const disabled = value.disabled ?? Boolean(target.disabled),
          admin = value.siteAdmin ?? Boolean(target.site_admin);
        if (
          target.site_admin &&
          !target.disabled &&
          (disabled || !admin) &&
          db
            .prepare(
              'SELECT count(*) AS n FROM auth_users WHERE site_admin=1 AND disabled=0',
            )
            .get().n <= 1
        )
          fail(409, '마지막 사이트 관리자는 제거할 수 없습니다.');
        if (disabled && !target.disabled)
          for (const m of db
            .prepare(
              "SELECT project_id FROM auth_memberships WHERE user_id=? AND role='admin'",
            )
            .all(target.id))
            protectAdmin(m.project_id, target.id, null);
        store.transaction(() => {
          db.prepare(
            'UPDATE auth_users SET disabled=?,site_admin=? WHERE id=?',
          ).run(disabled ? 1 : 0, admin ? 1 : 0, target.id);
          if (disabled) {
            db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(
              target.id,
            );
            db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(
              target.id,
            );
          }
          audit(
            requestId,
            signed,
            'user.change',
            'success',
            undefined,
            target.id,
          );
        });
        onChange(target.id);
        json(res, 200, { ok: true });
        return true;
      }
    }
    return false;
  }
  return {
    session,
    credential,
    refresh,
    project,
    role,
    state,
    human,
    addAdmin,
    prune,
    audit,
    routes,
    revoke(raw) {
      db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(raw));
      onChange();
    },
  };
}
