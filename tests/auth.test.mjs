import test from 'node:test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';
import { createBoardClient } from '../mcp/api-client.mjs';
import { oidcFixture, login } from './fixtures/oidc.mjs';

async function setup(t, options = {}) {
  const fixture = await oidcFixture();
  t.after(() => fixture.close());
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-auth-'));
  const app = await createApp({
    dataDir,
    port,
    publicUrl: `http://127.0.0.1:${port}`,
    auth: {
      mode: 'oidc',
      issuer: fixture.issuer,
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      ownerEmail: 'owner@example.com',
      testOnlyAllowInsecureLoopback: true,
    },
    ...options,
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  // Bound callback is canonical even when port was chosen by the OS.
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const request = async (path, cookie, method = 'GET', body, token) => {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const value = await response.json();
    return { status: response.status, value, response };
  };
  return { fixture, dataDir, app, base, request };
}

test('production rejects legacy or incomplete OIDC before creating a store', async () => {
  await assert.rejects(
    createApp({ dataDir: '/invalid', code: 'code', serviceMode: 'production' }),
    /production|OIDC/i,
  );
  await assert.rejects(
    createApp({
      dataDir: '/invalid',
      serviceMode: 'production',
      auth: { mode: 'oidc' },
    }),
    /OIDC|issuer/i,
  );
});

test('signed OIDC bootstraps owner, preserves project rows, hashes sessions, and rejects replay', async (t) => {
  const s = await setup(t);
  const config = await s.request('/auth/config');
  assert.equal(config.value.mode, 'oidc');
  const result = await login(s.base, s.fixture);
  assert.equal(result.response.headers.get('location'), '/');
  assert.ok(result.cookie);
  assert.ok(s.fixture.requests[0].nonce);
  assert.equal(s.fixture.requests[0].code_challenge_method, 'S256');
  const state = await s.request('/state', result.cookie);
  assert.equal(state.status, 200);
  assert.equal(state.value.projects[0].role, 'admin');
  const session = await s.request('/session', result.cookie);
  assert.equal(session.value.user.siteAdmin, true);
  const replay = await fetch(result.callback, {
    headers: { cookie: result.flowCookie },
    redirect: 'manual',
  });
  assert.match(replay.headers.get('location'), /auth_failed/);
  const db = new DatabaseSync(join(s.dataDir, 'ddd-builder.sqlite'));
  const contents = db.prepare('SELECT * FROM auth_sessions').all();
  assert.equal(contents.length, 1);
  assert.ok(!JSON.stringify(contents).includes(result.cookie.split('=')[1]));
  db.close();
  assert.equal(
    (await s.request('/session', result.cookie, 'DELETE')).status,
    200,
  );
  assert.equal((await s.request('/state', result.cookie)).status, 401);
});

for (const fault of [
  'nonce',
  'issuer',
  'audience',
  'expiry',
  'signature',
  'pkce',
])
  test(`OIDC rejects ${fault}`, async (t) => {
    const s = await setup(t);
    const result = await login(s.base, s.fixture, {}, fault);
    assert.match(result.response.headers.get('location'), /auth_failed/);
    assert.equal((await s.request('/state', result.cookie)).status, 401);
  });

test('OIDC denies unverified and uninvited identities', async (t) => {
  const s = await setup(t);
  for (const claims of [
    { email_verified: false },
    { sub: 'stranger', email: 'stranger@example.com' },
  ]) {
    const result = await login(s.base, s.fixture, claims);
    assert.match(
      result.response.headers.get('location'),
      /auth_failed|not_invited/,
    );
    assert.equal((await s.request('/state', result.cookie)).status, 401);
  }
});

test('project roles, IDOR, personal MCP tokens and live revocation are server enforced', async (t) => {
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const state = (await s.request('/state', owner.cookie)).value;
  const project = state.projects[0];
  const card = state.cards[0];
  const invite = await s.request(
    `/projects/${project.id}/invitations`,
    owner.cookie,
    'POST',
    { email: 'viewer@example.com', role: 'viewer' },
  );
  assert.equal(invite.status, 201);
  const viewer = await login(s.base, s.fixture, {
    sub: 'viewer',
    email: 'viewer@example.com',
    name: 'Viewer',
  });
  assert.ok(viewer.cookie);
  const user = (await s.request('/session', viewer.cookie)).value.user;
  assert.equal(
    (
      await s.request(`/cards/${card.id}`, viewer.cookie, 'PATCH', {
        revision: 999,
        title: 'x',
      })
    ).status,
    403,
  );
  const hidden = (
    await s.request('/projects', owner.cookie, 'POST', { name: 'Hidden' })
  ).value;
  assert.equal(
    (await s.request(`/projects/${hidden.id}/export`, viewer.cookie)).status,
    404,
  );
  const hiddenCard = (
    await s.request(`/projects/${hidden.id}/cards`, owner.cookie, 'POST', {
      stage: 'discovery',
      kind: 'problem',
      title: 'Secret',
    })
  ).value;
  const denied = await s.request(
    `/cards/${hiddenCard.id}`,
    viewer.cookie,
    'PATCH',
    { revision: 999 },
  );
  assert.equal(denied.status, 404);
  assert.equal(denied.value.current, undefined);
  assert.equal(
    (await s.request('/state', viewer.cookie)).value.projects.length,
    1,
  );
  assert.equal(
    (
      await s.request('/tokens', viewer.cookie, 'POST', {
        name: 'Write',
        projectId: project.id,
        scope: 'write',
      })
    ).status,
    403,
  );
  const minted = await s.request('/tokens', viewer.cookie, 'POST', {
    name: 'Read',
    projectId: project.id,
    scope: 'read',
  });
  assert.equal(minted.status, 201);
  const board = createBoardClient({ url: s.base, token: minted.value.token });
  assert.equal((await board.request('/state')).projects.length, 1);
  await assert.rejects(
    board.request(`/projects/${project.id}/cards`, 'POST', {
      stage: 'discovery',
      kind: 'problem',
      title: 'Denied',
    }),
    (e) => e.status === 403,
  );
  assert.equal(
    (
      await s.request(
        '/admin/users',
        undefined,
        'GET',
        undefined,
        minted.value.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await s.request(
        `/projects/${project.id}/members/${user.id}`,
        owner.cookie,
        'PATCH',
        { role: 'editor' },
      )
    ).status,
    200,
  );
  const write = (
    await s.request('/tokens', viewer.cookie, 'POST', {
      name: 'Writer',
      projectId: project.id,
      scope: 'write',
      days: 1,
    })
  ).value;
  const writer = createBoardClient({ url: s.base, token: write.token });
  assert.ok(
    (
      await writer.request(`/projects/${project.id}/cards`, 'POST', {
        stage: 'discovery',
        kind: 'problem',
        title: 'Allowed',
      })
    ).id,
  );
  await assert.rejects(
    writer.request('/projects', 'POST', { name: 'Forbidden' }),
    (e) => e.status === 403,
  );
  await assert.rejects(
    writer.request(`/projects/${hidden.id}/cards`, 'POST', {
      stage: 'discovery',
      kind: 'problem',
      title: 'Denied',
    }),
    (e) => e.status === 404,
  );
  assert.equal(
    (
      await s.request(`/admin/users/${user.id}`, owner.cookie, 'PATCH', {
        disabled: true,
      })
    ).status,
    200,
  );
  await assert.rejects(writer.request('/state'), (e) => e.status === 401);
  assert.equal((await s.request('/state', viewer.cookie)).status, 401);
});

test('OIDC binds callback state to the browser cookie and rejects wrong state', async (t) => {
  const s = await setup(t);
  const start = await fetch(s.base + '/api/auth/login', { redirect: 'manual' });
  const authorize = await fetch(start.headers.get('location'), {
    redirect: 'manual',
  });
  const callback = authorize.headers.get('location');
  const denied = await fetch(callback, {
    headers: { cookie: 'ddd_oidc_flow=wrong-browser' },
    redirect: 'manual',
  });
  assert.match(denied.headers.get('location'), /auth_failed/);
  const replay = await fetch(callback, {
    headers: { cookie: start.headers.get('set-cookie').split(';')[0] },
    redirect: 'manual',
  });
  assert.match(replay.headers.get('location'), /auth_failed/);
  const result = await login(s.base, s.fixture);
  const wrong = new URL(result.callback);
  wrong.searchParams.set('state', 'wrong-state');
  const invalid = await fetch(wrong, {
    headers: { cookie: result.flowCookie },
    redirect: 'manual',
  });
  assert.match(invalid.headers.get('location'), /auth_failed/);
});

test('project revocation filters SSE and rejects a write whose body arrives after revocation', async (t) => {
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const project = (await s.request('/state', owner.cookie)).value.projects[0];
  await s.request(`/projects/${project.id}/invitations`, owner.cookie, 'POST', {
    email: 'editor@example.com',
    role: 'editor',
  });
  const editor = await login(s.base, s.fixture, {
    sub: 'editor',
    email: 'editor@example.com',
  });
  const user = (await s.request('/session', editor.cookie)).value.user;
  const events = await fetch(s.base + '/api/events', {
    headers: { cookie: editor.cookie },
  });
  const reader = events.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.ok(first.includes(project.id));
  const { request } = await import('node:http');
  const pending = request(s.base + `/api/projects/${project.id}/cards`, {
    method: 'POST',
    headers: { cookie: editor.cookie, 'content-type': 'application/json' },
  });
  const result = new Promise((resolve, reject) => {
    pending.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          value: JSON.parse(Buffer.concat(chunks)),
        }),
      );
    });
    pending.on('error', reject);
  });
  pending.write('{"stage":"events",');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    (
      await s.request(
        `/projects/${project.id}/members/${user.id}`,
        owner.cookie,
        'DELETE',
      )
    ).status,
    200,
  );
  pending.end('"kind":"event","title":"must never be saved"}');
  assert.equal((await result).status, 404);
  const deadline = AbortSignal.timeout(1000);
  try {
    while (!deadline.aborted) {
      if ((await reader.read()).done) break;
    }
  } catch (e) {
    assert.equal(e.cause?.code, 'UND_ERR_SOCKET');
  }
  assert.equal(
    (await s.request('/state', editor.cookie)).value.projects.length,
    0,
  );
  assert.ok(
    !(await s.request('/state', owner.cookie)).value.cards.some(
      (c) => c.title === 'must never be saved',
    ),
  );
});

test('tokens are hashed, scoped, expiring, revocable and reduced by live membership', async (t) => {
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const project = (await s.request('/state', owner.cookie)).value.projects[0];
  const minted = (
    await s.request('/tokens', owner.cookie, 'POST', {
      name: 'Read token',
      projectId: project.id,
      scope: 'read',
      days: 1,
    })
  ).value;
  const db = new DatabaseSync(join(s.dataDir, 'ddd-builder.sqlite'));
  t.after(() => db.close());
  assert.ok(
    !JSON.stringify(db.prepare('SELECT * FROM auth_tokens').all()).includes(
      minted.token,
    ),
  );
  const list = (await s.request('/tokens', owner.cookie)).value;
  assert.ok(!JSON.stringify(list).includes(minted.token));
  const info = (await s.request('/info', owner.cookie)).value;
  assert.equal(info.mcp.env.DDD_CODE, undefined);
  assert.equal(info.mcp.env.DDD_TOKEN, '');
  const state = await s.request(
    '/state',
    undefined,
    'GET',
    undefined,
    minted.token,
  );
  assert.equal(state.value.projects[0].role, 'viewer');
  assert.equal(
    (
      await s.request(
        `/projects/${project.id}`,
        undefined,
        'DELETE',
        { revision: 1 },
        minted.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await s.request(`/tokens/${minted.credential.id}`, owner.cookie, 'DELETE'))
      .status,
    200,
  );
  assert.equal(
    (await s.request('/state', undefined, 'GET', undefined, minted.token))
      .status,
    401,
  );
  const another = (
    await s.request('/tokens', owner.cookie, 'POST', {
      name: 'Expiring',
      projectId: project.id,
      scope: 'read',
    })
  ).value;
  db.prepare('UPDATE auth_tokens SET expires_at=? WHERE id=?').run(
    Date.now() - 1,
    another.credential.id,
  );
  assert.equal(
    (await s.request('/state', undefined, 'GET', undefined, another.token))
      .status,
    401,
  );
  await s.request(`/projects/${project.id}/invitations`, owner.cookie, 'POST', {
    email: 'editor@example.com',
    role: 'editor',
  });
  const editor = await login(s.base, s.fixture, {
    sub: 'editor',
    email: 'editor@example.com',
  });
  const user = (await s.request('/session', editor.cookie)).value.user;
  const write = (
    await s.request('/tokens', editor.cookie, 'POST', {
      name: 'Writer',
      projectId: project.id,
      scope: 'write',
    })
  ).value;
  await s.request(
    `/projects/${project.id}/members/${user.id}`,
    owner.cookie,
    'PATCH',
    { role: 'viewer' },
  );
  assert.equal(
    (
      await s.request(
        `/projects/${project.id}/cards`,
        undefined,
        'POST',
        { stage: 'events', kind: 'event', title: 'denied' },
        write.token,
      )
    ).status,
    403,
  );
});

test('sessions survive restart without regranting ownership and idle expiration is enforced', async (t) => {
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const original = (await s.request('/state', owner.cookie)).value;
  const project = original.projects[0],
    ownerId = (await s.request('/session', owner.cookie)).value.user.id;
  await s.request(`/projects/${project.id}/invitations`, owner.cookie, 'POST', {
    email: 'admin@example.com',
    role: 'admin',
  });
  const second = await login(s.base, s.fixture, {
    sub: 'admin',
    email: 'admin@example.com',
  });
  await s.request(
    `/projects/${project.id}/members/${ownerId}`,
    second.cookie,
    'PATCH',
    { role: 'viewer' },
  );
  await s.app.close();
  const app = await createApp({
    dataDir: s.dataDir,
    port: new URL(s.base).port * 1,
    publicUrl: s.base,
    auth: {
      mode: 'oidc',
      issuer: s.fixture.issuer,
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      ownerEmail: 'owner@example.com',
      testOnlyAllowInsecureLoopback: true,
    },
  });
  t.after(() => app.close());
  const continued = (await s.request('/state', owner.cookie)).value;
  assert.equal(continued.projects[0].role, 'viewer');
  assert.deepEqual(continued.cards, original.cards);
  const again = await login(s.base, s.fixture);
  assert.equal(
    (await s.request('/state', again.cookie)).value.projects[0].role,
    'viewer',
  );
  const impostor = await login(s.base, s.fixture, { sub: 'new-owner-sub' });
  assert.equal(impostor.cookie, undefined);
  const db = new DatabaseSync(join(s.dataDir, 'ddd-builder.sqlite'));
  db.prepare('UPDATE auth_sessions SET last_seen=? WHERE user_id=?').run(
    Date.now() - 1800001,
    ownerId,
  );
  assert.equal((await s.request('/state', again.cookie)).status, 401);
  db.close();
  await app.close();
});

test('MCP tool writes stay forbidden with a read token even when client write tools are enabled', async (t) => {
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const project = (await s.request('/state', owner.cookie)).value.projects[0];
  const minted = (
    await s.request('/tokens', owner.cookie, 'POST', {
      name: 'Read-only AI',
      projectId: project.id,
      scope: 'read',
    })
  ).value;
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } =
    await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createMcpServer } = await import('../mcp/server.mjs');
  const server = createMcpServer({
    url: s.base,
    token: minted.token,
    readOnly: false,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'permission-test', version: '1.0.0' });
  await server.connect(b);
  await client.connect(a);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const read = await client.callTool({ name: 'list_projects', arguments: {} });
  assert.notEqual(read.isError, true);
  const write = await client.callTool({
    name: 'create_card',
    arguments: {
      projectId: project.id,
      stage: 'events',
      kind: 'event',
      title: 'cannot save',
    },
  });
  assert.equal(write.isError, true);
  assert.ok(
    !(await s.request('/state', owner.cookie)).value.cards.some(
      (c) => c.title === 'cannot save',
    ),
  );
});

test('audit exposes bounded metadata without board content or authentication secrets', async (t) => {
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const project = (await s.request('/state', owner.cookie)).value.projects[0];
  const token = (
    await s.request('/tokens', owner.cookie, 'POST', {
      projectId: project.id,
      name: 'Audit read',
      scope: 'read',
    })
  ).value;
  await s.request(`/projects/${project.id}/cards`, owner.cookie, 'POST', {
    stage: 'events',
    kind: 'event',
    title: 'Sensitive title never logged',
    description: 'Sensitive body never logged',
  });
  await s.request(`/projects/${project.id}/export`, owner.cookie);
  await s.request(`/tokens/${token.credential.id}`, owner.cookie, 'DELETE');
  await s.request('/state');
  const audit = (await s.request('/admin/audit', owner.cookie)).value.events;
  assert.ok(audit.length <= 100);
  for (const event of [
    'auth.login',
    'token.create',
    'token.revoke',
    'card.change',
    'project.export',
    'request.denied',
  ])
    assert.ok(
      audit.some((row) => row.event === event),
      event,
    );
  const serialized = JSON.stringify(audit);
  for (const value of [
    owner.cookie.split('=')[1],
    token.token,
    'provider-access-secret',
    'Sensitive title never logged',
    'Sensitive body never logged',
  ])
    assert.ok(!serialized.includes(value));
});

test('sensitive changes roll back when their audit insert fails', async (t) => {
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const projectId = (await s.request('/state', owner.cookie)).value.projects[0]
    .id;
  await s.request(`/projects/${projectId}/invitations`, owner.cookie, 'POST', {
    email: 'member@example.com',
    role: 'viewer',
  });
  const member = await login(s.base, s.fixture, {
    sub: 'member',
    email: 'member@example.com',
  });
  const memberId = (await s.request('/session', member.cookie)).value.user.id;
  const invitation = await s.request(
    `/projects/${projectId}/invitations`,
    owner.cookie,
    'POST',
    { email: 'pending@example.com', role: 'viewer' },
  );
  const token = await s.request('/tokens', owner.cookie, 'POST', {
    name: 'Existing',
    projectId,
  });
  const db = new DatabaseSync(join(s.dataDir, 'ddd-builder.sqlite'));
  t.after(() => db.close());
  const snapshot = () =>
    JSON.stringify(
      [
        'auth_users',
        'auth_identities',
        'auth_memberships',
        'auth_invitations',
        'auth_tokens',
        'metadata',
      ]
        .map((table) =>
          db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        )
        .concat([
          db
            .prepare(
              'SELECT token_hash,user_id,expires_at FROM auth_sessions ORDER BY rowid',
            )
            .all(),
        ]),
    );
  const cases = [
    [
      'member.change',
      `/projects/${projectId}/members/${memberId}`,
      'PATCH',
      { role: 'editor' },
    ],
    [
      'member.remove',
      `/projects/${projectId}/members/${memberId}`,
      'DELETE',
      {},
    ],
    ['user.change', `/admin/users/${memberId}`, 'PATCH', { disabled: true }],
    ['token.create', '/tokens', 'POST', { name: 'Denied', projectId }],
    ['token.revoke', `/tokens/${token.value.credential.id}`, 'DELETE'],
    [
      'invite.create',
      `/projects/${projectId}/invitations`,
      'POST',
      { email: 'pending@example.com', role: 'editor' },
    ],
    [
      'invite.cancel',
      `/projects/${projectId}/invitations/${invitation.value.id}`,
      'DELETE',
    ],
    ['session.logout', '/session', 'DELETE'],
  ];
  for (const [event, path, method, body] of cases) {
    db.exec(
      `CREATE TRIGGER reject_audit BEFORE INSERT ON auth_audit WHEN NEW.event='${event}' AND NEW.outcome='success' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END`,
    );
    const before = snapshot();
    assert.equal(
      (await s.request(path, owner.cookie, method, body)).status,
      500,
      event,
    );
    assert.equal(snapshot(), before, `${event} must roll back`);
    db.exec('DROP TRIGGER reject_audit');
  }
  db.exec(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON auth_audit WHEN NEW.event='auth.login' AND NEW.outcome='success' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
  );
  const before = snapshot();
  const failed = await login(s.base, s.fixture);
  assert.match(failed.response.headers.get('location'), /auth_failed/);
  assert.equal(
    snapshot(),
    before,
    'failed login must not create a session or accept memberships',
  );
});

test('failed login audit rolls back first owner bootstrap and invitation acceptance', async (t) => {
  const s = await setup(t);
  const db = new DatabaseSync(join(s.dataDir, 'ddd-builder.sqlite'));
  t.after(() => db.close());
  const reject = () =>
    db.exec(
      "CREATE TRIGGER reject_login_audit BEFORE INSERT ON auth_audit WHEN NEW.event='auth.login' AND NEW.outcome='success' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
  reject();
  const failedOwner = await login(s.base, s.fixture);
  assert.match(failedOwner.response.headers.get('location'), /auth_failed/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_users').get().n, 0);
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM auth_memberships').get().n,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT value FROM metadata WHERE key='identity_owner_bootstrapped'",
      )
      .get(),
    undefined,
  );
  db.exec('DROP TRIGGER reject_login_audit');
  const owner = await login(s.base, s.fixture);
  const projectId = (await s.request('/state', owner.cookie)).value.projects[0]
    .id;
  const invitation = await s.request(
    `/projects/${projectId}/invitations`,
    owner.cookie,
    'POST',
    { email: 'new@example.com', role: 'editor' },
  );
  reject();
  const failedMember = await login(s.base, s.fixture, {
    sub: 'new-user',
    email: 'new@example.com',
  });
  assert.match(failedMember.response.headers.get('location'), /auth_failed/);
  assert.ok(
    db
      .prepare('SELECT id FROM auth_invitations WHERE id=?')
      .get(invitation.value.id),
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_users').get().n, 1);
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM auth_identities').get().n,
    1,
  );
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM auth_sessions').get().n,
    1,
  );
});

test('HTTP MCP isolates credentials, preserves tools and resources, and enforces revocation', async (t) => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const project = (await s.request('/state', owner.cookie)).value.projects[0];
  const other = (
    await s.request('/projects', owner.cookie, 'POST', { name: 'Other' })
  ).value;
  async function mint(projectId, scope) {
    return (
      await s.request('/tokens', owner.cookie, 'POST', {
        name: 'HTTP',
        projectId,
        scope,
      })
    ).value;
  }
  const read = await mint(project.id, 'read');
  const write = await mint(other.id, 'write');
  async function connect(token) {
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(s.base + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    t.after(() => client.close());
    return client;
  }
  const reader = await connect(read.token);
  const writer = await connect(write.token);
  assert.deepEqual(
    (await reader.listTools()).tools.map((x) => x.name),
    ['list_projects', 'get_project_board', 'review_design'],
  );
  assert.equal((await writer.listTools()).tools.length, 5);
  const [a, b] = await Promise.all([
    reader.callTool({ name: 'list_projects' }),
    writer.callTool({ name: 'list_projects' }),
  ]);
  assert.deepEqual(
    JSON.parse(a.content[0].text).map((x) => x.id),
    [project.id],
  );
  assert.deepEqual(
    JSON.parse(b.content[0].text).map((x) => x.id),
    [other.id],
  );
  const resource = await reader.readResource({ uri: 'ddd://projects' });
  assert.equal(JSON.parse(resource.contents[0].text)[0].id, project.id);
  assert.equal(
    (
      await reader.getPrompt({
        name: 'analyze_event_storming',
        arguments: { projectId: project.id },
      })
    ).messages.length,
    1,
  );
  const args = {
    projectId: other.id,
    stage: 'events',
    kind: 'event',
    title: 'HTTP created',
  };
  assert.equal(
    (await reader.callTool({ name: 'create_card', arguments: args })).isError,
    true,
  );
  const created = await writer.callTool({
    name: 'create_card',
    arguments: args,
  });
  assert.ok(!created.isError);
  const card = JSON.parse(created.content[0].text);
  const updated = await writer.callTool({
    name: 'update_card',
    arguments: {
      cardId: card.id,
      revision: card.revision,
      title: 'Updated via HTTP',
    },
  });
  assert.equal(JSON.parse(updated.content[0].text).title, 'Updated via HTTP');
  assert.equal(
    (
      await writer.callTool({
        name: 'create_card',
        arguments: { ...args, projectId: project.id },
      })
    ).isError,
    true,
  );
  assert.equal(
    (await s.request('/info', owner.cookie)).value.mcpHttp.url,
    s.base + '/mcp',
  );
  await s.request(`/tokens/${read.credential.id}`, owner.cookie, 'DELETE');
  await assert.rejects(reader.listTools());
  assert.equal((await writer.listTools()).tools.length, 5);
});

test('HTTP MCP rejects cookies, invalid origins, unsupported methods and oversized bodies', async (t) => {
  const s = await setup(t);
  const owner = await login(s.base, s.fixture);
  const project = (await s.request('/state', owner.cookie)).value.projects[0];
  const minted = (
    await s.request('/tokens', owner.cookie, 'POST', {
      name: 'HTTP',
      projectId: project.id,
      scope: 'read',
    })
  ).value;
  const headers = {
    authorization: `Bearer ${minted.token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  const request = (overrides = {}) =>
    fetch(s.base + '/mcp', {
      method: 'POST',
      headers,
      body: payload,
      ...overrides,
    });
  assert.equal(
    (
      await request({
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request({
        headers: { ...headers, authorization: 'Bearer invalid' },
      })
    ).status,
    401,
  );
  assert.equal(
    (await request({ headers: { ...headers, origin: 'https://evil.example' } }))
      .status,
    403,
  );
  assert.equal(
    (
      await request({
        method: 'GET',
        body: undefined,
        headers: { ...headers, origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request({ headers: { ...headers, origin: s.base } })).status,
    200,
  );
  assert.equal((await request({ method: 'GET', body: undefined })).status, 405);
  assert.equal(
    (await request({ headers: { ...headers, 'content-type': 'text/plain' } }))
      .status,
    415,
  );
  assert.equal((await request({ body: '{' })).status, 400);
  assert.equal(
    (
      await request({
        body: JSON.stringify({ padding: 'x'.repeat(129 * 1024) }),
      })
    ).status,
    400,
  );
});
