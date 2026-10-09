import { randomUUID } from 'node:crypto';

const fail = (status, message = '요청을 허용할 수 없습니다.') => {
  throw Object.assign(new Error(message), { status });
};
const fields = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail(400, '허용되지 않은 필드가 있습니다.');
};
const invitationView = (row) => ({
  id: row.id,
  name: row.name,
  role: row.role,
  createdAt: new Date(row.created_at).toISOString(),
  expiresAt: new Date(row.expires_at).toISOString(),
  usedAt: row.used_at === null ? null : new Date(row.used_at).toISOString(),
  revokedAt:
    row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
  maxUses: 1,
});

export function createGuestAccess({
  store,
  safeguards,
  audit,
  onChange,
  hash,
  secret,
  userView,
  sessionCookie,
  member,
  project,
}) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS auth_guest_settings(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
    CREATE TABLE IF NOT EXISTS auth_guest_invitations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,code_hash TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('viewer','editor')),created_by TEXT NOT NULL REFERENCES auth_users(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER,revoked_at INTEGER);
    CREATE INDEX IF NOT EXISTS auth_guest_invite_project ON auth_guest_invitations(project_id);
    CREATE TABLE IF NOT EXISTS auth_guests(user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,invitation_id TEXT REFERENCES auth_guest_invitations(id) ON DELETE SET NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);
    CREATE INDEX IF NOT EXISTS auth_guest_project ON auth_guests(project_id);`);
  const user = (userId) =>
    db.prepare('SELECT * FROM auth_guests WHERE user_id=?').get(userId);
  const enabled = (projectId) =>
    db
      .prepare('SELECT enabled FROM auth_guest_settings WHERE project_id=?')
      .get(projectId)?.enabled === 1;
  function valid(guest) {
    if (
      !guest ||
      !guest.project_id ||
      guest.revoked_at !== null ||
      guest.expires_at <= Date.now() ||
      !enabled(guest.project_id)
    )
      return false;
    const role = db
      .prepare(
        'SELECT role FROM auth_memberships WHERE project_id=? AND user_id=?',
      )
      .get(guest.project_id, guest.user_id)?.role;
    return (
      ['viewer', 'editor'].includes(role) &&
      Boolean(store.project(guest.project_id))
    );
  }
  function revoke(userId) {
    db.prepare(
      'UPDATE auth_guests SET revoked_at=coalesce(revoked_at,?) WHERE user_id=?',
    ).run(Date.now(), userId);
    db.prepare('DELETE FROM auth_memberships WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM auth_tokens WHERE user_id=?').run(userId);
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
    if (path === '/api/guest/session' && method === 'POST') {
      if (signed)
        fail(409, '현재 계정에서 로그아웃한 뒤 게스트로 참여해 주세요.');
      const value = await body(req);
      fields(value, ['name', 'code']);
      if (
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 60 ||
        typeof value.code !== 'string' ||
        value.code.length > 200
      )
        fail(400, '이름과 초대 코드를 확인해 주세요.');
      const result = store.transaction(() => {
        const now = Date.now();
        const invitation = db
          .prepare('SELECT * FROM auth_guest_invitations WHERE code_hash=?')
          .get(hash(value.code.trim()));
        if (
          !invitation ||
          invitation.used_at !== null ||
          invitation.revoked_at !== null ||
          invitation.expires_at <= now ||
          !enabled(invitation.project_id) ||
          !store.project(invitation.project_id)
        )
          fail(
            401,
            '초대 코드를 사용할 수 없습니다. 만료·사용·철회 여부를 관리자에게 확인해 주세요.',
          );
        db.prepare(
          'DELETE FROM auth_sessions WHERE expires_at<=? OR last_seen<=?',
        ).run(now, now - 1800000);
        if (
          db.prepare('SELECT count(*) AS n FROM auth_sessions').get().n >=
          safeguards.maxSessions
        )
          fail(
            429,
            '현재 참여 가능한 세션 수를 초과했습니다. 잠시 후 다시 시도해 주세요.',
          );
        const userId = randomUUID(),
          token = secret(),
          expiresAt = now + Math.min(safeguards.sessionLifetimeMs, 43200000);
        const profile = {
          id: userId,
          name: value.name.trim(),
          email: '',
          site_admin: 0,
          guest: true,
        };
        if (
          !db
            .prepare(
              'UPDATE auth_guest_invitations SET used_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL',
            )
            .run(now, invitation.id).changes
        )
          fail(401, '초대 코드를 사용할 수 없습니다.');
        db.prepare('INSERT INTO auth_users VALUES (?,?,?,?,?)').run(
          userId,
          profile.name,
          '',
          0,
          0,
        );
        db.prepare('INSERT INTO auth_guests VALUES (?,?,?,?,?,NULL)').run(
          userId,
          invitation.project_id,
          invitation.id,
          now,
          expiresAt,
        );
        db.prepare('INSERT INTO auth_memberships VALUES (?,?,?)').run(
          invitation.project_id,
          userId,
          invitation.role,
        );
        db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run(
          hash(token),
          userId,
          expiresAt,
          now,
        );
        audit(
          requestId,
          { user: profile },
          'guest.join',
          'success',
          invitation.project_id,
          invitation.id,
        );
        return {
          user: userView(profile),
          token,
          expiresAt,
          projectId: invitation.project_id,
        };
      });
      onChange();
      json(
        res,
        201,
        {
          user: result.user,
          projectId: result.projectId,
          expiresAt: new Date(result.expiresAt).toISOString(),
        },
        {
          'set-cookie': sessionCookie(
            result.token,
            Math.max(1, Math.floor((result.expiresAt - Date.now()) / 1000)),
          ),
        },
      );
      return true;
    }
    const match = path.match(
      /^\/api\/projects\/([^/]+)\/(guest-access|guest-invitations|guests)(?:\/([^/]+))?$/,
    );
    if (!match) return false;
    if (!signed) fail(401, '먼저 접속해 주세요.');
    member(signed);
    project(signed, match[1], 'admin');
    const [, projectId, action, target] = match;
    if (action === 'guest-access' && !target && method === 'GET') {
      json(res, 200, {
        enabled: enabled(projectId),
        invitations: db
          .prepare(
            'SELECT * FROM auth_guest_invitations WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',
          )
          .all(projectId)
          .map(invitationView),
        guests: db
          .prepare(
            'SELECT g.*,u.name,m.role FROM auth_guests g JOIN auth_users u ON u.id=g.user_id LEFT JOIN auth_memberships m ON m.project_id=g.project_id AND m.user_id=g.user_id WHERE g.project_id=? ORDER BY g.created_at DESC,g.user_id LIMIT 200',
          )
          .all(projectId)
          .map((row) => ({
            userId: row.user_id,
            name: row.name,
            guest: true,
            role: row.role ?? 'viewer',
            createdAt: new Date(row.created_at).toISOString(),
            expiresAt: new Date(row.expires_at).toISOString(),
            revokedAt:
              row.revoked_at === null
                ? null
                : new Date(row.revoked_at).toISOString(),
          })),
      });
      return true;
    }
    if (action === 'guest-access' && !target && method === 'PATCH') {
      const value = await body(req);
      member(signed);
      project(signed, projectId, 'admin');
      fields(value, ['enabled']);
      if (typeof value.enabled !== 'boolean') fail(400);
      store.transaction(() => {
        db.prepare(
          'INSERT INTO auth_guest_settings VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled',
        ).run(projectId, value.enabled ? 1 : 0);
        if (!value.enabled) {
          db.prepare(
            'UPDATE auth_guest_invitations SET revoked_at=coalesce(revoked_at,?) WHERE project_id=?',
          ).run(Date.now(), projectId);
          for (const row of db
            .prepare('SELECT user_id FROM auth_guests WHERE project_id=?')
            .all(projectId))
            revoke(row.user_id);
        }
        audit(requestId, signed, 'guest.access.change', 'success', projectId);
      });
      onChange();
      json(res, 200, { enabled: value.enabled });
      return true;
    }
    if (action === 'guest-invitations' && !target && method === 'POST') {
      const value = await body(req);
      member(signed);
      project(signed, projectId, 'admin');
      fields(value, ['name', 'role', 'days']);
      const name = value.name ?? '게스트 초대',
        role = value.role ?? 'viewer',
        days = value.days ?? 1;
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 80 ||
        !['viewer', 'editor'].includes(role) ||
        !Number.isInteger(days) ||
        days < 1 ||
        days > 7
      )
        fail(400, '초대 이름·권한·만료일을 확인해 주세요.');
      if (!enabled(projectId))
        fail(409, '먼저 이 프로젝트의 게스트 참여를 허용해 주세요.');
      const now = Date.now();
      if (
        db
          .prepare(
            'SELECT count(*) AS n FROM auth_guest_invitations WHERE project_id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?',
          )
          .get(projectId, now).n >= 100
      )
        fail(429, '대기 중인 게스트 초대는 프로젝트당 최대 100개입니다.');
      const code = secret(),
        row = {
          id: randomUUID(),
          project_id: projectId,
          name: name.trim(),
          role,
          created_at: now,
          expires_at: now + days * 86400000,
          used_at: null,
          revoked_at: null,
        };
      store.transaction(() => {
        db.prepare(
          'INSERT INTO auth_guest_invitations VALUES (?,?,?,?,?,?,?,?,?,?)',
        ).run(
          row.id,
          projectId,
          hash(code),
          row.name,
          row.role,
          signed.user.id,
          now,
          row.expires_at,
          null,
          null,
        );
        audit(
          requestId,
          signed,
          'guest.invite.create',
          'success',
          projectId,
          row.id,
        );
      });
      json(res, 201, { code, invitation: invitationView(row) });
      return true;
    }
    if (action === 'guest-invitations' && target && method === 'DELETE') {
      const row = db
        .prepare(
          'SELECT * FROM auth_guest_invitations WHERE id=? AND project_id=?',
        )
        .get(target, projectId);
      if (!row) fail(404);
      store.transaction(() => {
        db.prepare(
          'UPDATE auth_guest_invitations SET revoked_at=coalesce(revoked_at,?) WHERE id=?',
        ).run(Date.now(), row.id);
        for (const g of db
          .prepare('SELECT user_id FROM auth_guests WHERE invitation_id=?')
          .all(row.id))
          revoke(g.user_id);
        audit(
          requestId,
          signed,
          'guest.invite.revoke',
          'success',
          projectId,
          row.id,
        );
      });
      onChange();
      json(res, 200, { ok: true });
      return true;
    }
    if (action === 'guests' && target && method === 'DELETE') {
      const guest = user(target);
      if (!guest || guest.project_id !== projectId) fail(404);
      store.transaction(() => {
        revoke(target);
        audit(requestId, signed, 'guest.revoke', 'success', projectId, target);
      });
      onChange(target);
      json(res, 200, { ok: true });
      return true;
    }
    fail(405, '지원하지 않는 요청 방식입니다.');
  }
  return { user, valid, enabled, revoke, routes };
}
