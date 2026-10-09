import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';
import { oidcFixture, login } from './fixtures/oidc.mjs';

async function setup(t, extra = {}) {
  const fixture = await oidcFixture();
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-guests-'));
  const base = `http://127.0.0.1:${port}`;
  const options = {
    dataDir,
    port,
    publicUrl: base,
    auth: {
      mode: 'oidc',
      issuer: fixture.issuer,
      clientId: 'fixture-client',
      clientSecret: 'fixture-secret',
      ownerEmail: 'owner@example.com',
      testOnlyAllowInsecureLoopback: true,
    },
    ...extra,
  };
  let app = await createApp(options);
  t.after(async () => {
    await app.close();
    await fixture.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const req = async (path, cookie, method = 'GET', data, headers = {}) => {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(data === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      redirect: 'manual',
    });
    const contentType = response.headers.get('content-type');
    return {
      status: response.status,
      response,
      value: contentType?.includes('application/json')
        ? await response.json()
        : contentType === 'application/zip'
          ? Buffer.from(await response.arrayBuffer())
          : await response.text(),
    };
  };
  const owner = await login(base, fixture);
  assert.ok(owner.cookie);
  const project = (await req('/state', owner.cookie)).value.projects[0];
  const createInvite = async (
    role = 'viewer',
    cookie = owner.cookie,
    projectId = project.id,
  ) => {
    assert.equal(
      (
        await req(`/projects/${projectId}/guest-access`, cookie, 'PATCH', {
          enabled: true,
        })
      ).status,
      200,
    );
    const result = await req(
      `/projects/${projectId}/guest-invitations`,
      cookie,
      'POST',
      { role, name: '외부 검토자', days: 1 },
    );
    assert.equal(result.status, 201, JSON.stringify(result.value));
    return result.value;
  };
  const joinGuest = async (code, name = '게스트 팀원') => {
    const result = await req('/guest/session', undefined, 'POST', {
      code,
      name,
    });
    return {
      ...result,
      cookie: result.response.headers.get('set-cookie')?.split(';')[0],
    };
  };
  return {
    fixture,
    options,
    base,
    dataDir,
    owner,
    project,
    req,
    createInvite,
    joinGuest,
    async restart() {
      await app.close();
      app = await createApp(options);
    },
  };
}

test('OIDC and default viewer guest sessions coexist with strict project and management boundaries', async (t) => {
  const s = await setup(t);
  const config = (await s.req('/auth/config')).value;
  assert.equal(config.mode, 'oidc');
  assert.equal(config.guestLoginUrl, '/api/guest/session');
  assert.equal(
    (await s.req(`/projects/${s.project.id}/guest-access`, s.owner.cookie))
      .value.enabled,
    false,
  );
  assert.equal(
    (
      await s.req(
        `/projects/${s.project.id}/guest-invitations`,
        s.owner.cookie,
        'POST',
        {},
      )
    ).status,
    409,
  );
  const invite = await s.createInvite();
  assert.equal(invite.invitation.role, 'viewer');
  assert.equal(invite.invitation.maxUses, 1);
  assert.ok(invite.code.length >= 40);
  assert.equal(
    (
      await s.req('/session', undefined, 'POST', {
        name: 'Old',
        code: invite.code,
      })
    ).status,
    405,
  );
  const guest = await s.joinGuest(invite.code);
  assert.equal(guest.status, 201);
  assert.equal(guest.value.user.guest, true);
  assert.equal(guest.value.user.siteAdmin, false);
  assert.equal(guest.value.user.email, '');
  assert.match(
    guest.response.headers.get('set-cookie'),
    /HttpOnly; SameSite=Lax/,
  );
  const foreign = (
    await s.req('/projects', s.owner.cookie, 'POST', { name: '계정 전용' })
  ).value;
  const state = (await s.req('/state', guest.cookie)).value;
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].id, s.project.id);
  assert.equal(state.projects[0].role, 'viewer');
  assert.ok(state.cards.every((c) => c.projectId === s.project.id));
  for (const path of [
    `/projects/${s.project.id}/documents`,
    `/projects/${s.project.id}/review`,
    ...['json', 'markdown', 'documents'].map(
      (format) => `/projects/${s.project.id}/export?format=${format}`,
    ),
  ])
    assert.equal((await s.req(path, guest.cookie)).status, 200, path);
  for (const path of [
    `/projects/${foreign.id}/documents`,
    `/projects/${foreign.id}/export`,
    `/projects/${foreign.id}/review`,
  ])
    assert.equal((await s.req(path, guest.cookie)).status, 404);
  const aggregate = state.cards.find((c) => c.kind === 'aggregate');
  assert.equal(
    (await s.req(`/cards/${aggregate.id}/aggregate-design`, guest.cookie))
      .status,
    200,
  );
  const foreignCard = (
    await s.req(`/projects/${foreign.id}/cards`, s.owner.cookie, 'POST', {
      stage: 'events',
      kind: 'event',
      title: '비공개 사건',
    })
  ).value;
  for (const [path, method, data] of [
    [
      `/projects/${s.project.id}/cards`,
      'POST',
      { stage: 'events', kind: 'event', title: '불허' },
    ],
    [`/cards/${aggregate.id}`, 'PATCH', { revision: 999, title: '불허' }],
    [
      `/cards/${aggregate.id}/aggregate-design`,
      'PATCH',
      { revision: aggregate.revision, coordination: '불허' },
    ],
    ['/projects', 'POST', { name: '불허' }],
    [`/projects/${s.project.id}`, 'DELETE', { revision: s.project.revision }],
    [`/projects/${s.project.id}/access`, 'GET'],
    [`/projects/${s.project.id}/guest-access`, 'GET'],
    [`/projects/${s.project.id}/guest-invitations`, 'POST', { role: 'editor' }],
    [
      `/projects/${s.project.id}/invitations`,
      'POST',
      { email: 'a@test.example', role: 'admin' },
    ],
    ['/tokens', 'GET'],
    [
      '/tokens',
      'POST',
      { projectId: s.project.id, name: '불허', scope: 'read' },
    ],
    ['/tokens/missing', 'DELETE'],
    ['/info', 'GET'],
    ['/admin/users', 'GET'],
    ['/admin/audit', 'GET'],
  ])
    assert.equal(
      (await s.req(path, guest.cookie, method, data)).status,
      403,
      path,
    );
  assert.equal(
    (
      await s.req(`/cards/${foreignCard.id}`, guest.cookie, 'PATCH', {
        revision: 1,
        title: '불허',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await s.req(
        `/projects/${s.project.id}/members/${guest.value.user.id}`,
        s.owner.cookie,
        'PATCH',
        { role: 'admin' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await s.req(
        `/admin/users/${guest.value.user.id}`,
        s.owner.cookie,
        'PATCH',
        { siteAdmin: true },
      )
    ).status,
    403,
  );
  const mcp = await fetch(s.base + '/mcp', {
    method: 'POST',
    headers: { cookie: guest.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
  });
  assert.equal(mcp.status, 401);
  await mcp.arrayBuffer();
  const ownerAgain = await login(s.base, s.fixture);
  assert.ok(ownerAgain.cookie);
  assert.equal(
    (await s.req('/session', ownerAgain.cookie)).value.user.guest,
    undefined,
  );
  assert.equal(
    (await s.req('/state', ownerAgain.cookie)).value.projects.length,
    2,
  );
});

test('one-use guest codes resist concurrent redemption, expire and stay hashed with session secrets', async (t) => {
  const s = await setup(t);
  const invite = await s.createInvite();
  const attempts = await Promise.all([
    s.joinGuest(invite.code, '첫 참가자'),
    s.joinGuest(invite.code, '다른 참가자'),
  ]);
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 401]);
  assert.equal((await s.joinGuest(invite.code)).status, 401);
  const winner = attempts.find((r) => r.status === 201);
  const db = new DatabaseSync(join(s.dataDir, 'ddd-builder.sqlite'));
  const stored = db
    .prepare('SELECT * FROM auth_guest_invitations WHERE id=?')
    .get(invite.invitation.id);
  assert.equal(stored.code_hash.length, 64);
  assert.ok(stored.used_at);
  const dump = JSON.stringify(
    [
      'auth_guest_invitations',
      'auth_guests',
      'auth_users',
      'auth_sessions',
      'auth_audit',
    ].flatMap((table) => db.prepare(`SELECT * FROM ${table}`).all()),
  );
  assert.ok(!dump.includes(invite.code));
  assert.ok(!dump.includes(winner.cookie.split('=')[1]));
  const next = await s.createInvite();
  db.prepare('UPDATE auth_guest_invitations SET expires_at=? WHERE id=?').run(
    Date.now() - 1,
    next.invitation.id,
  );
  assert.equal((await s.joinGuest(next.code)).status, 401);
  for (const data of [
    { role: 'admin' },
    { days: 0 },
    { days: 8 },
    { days: '1' },
    { name: 'x'.repeat(81) },
    { maxUses: 999 },
  ])
    assert.equal(
      (
        await s.req(
          `/projects/${s.project.id}/guest-invitations`,
          s.owner.cookie,
          'POST',
          data,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await s.req('/guest/session', undefined, 'POST', {
        name: 'a',
        code: 'x',
        role: 'admin',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await s.req('/guest/session', s.owner.cookie, 'POST', {
        name: 'a',
        code: next.code,
      })
    ).status,
    409,
  );
  const audit = (await s.req('/admin/audit', s.owner.cookie)).value.events;
  assert.ok(
    audit.some(
      (e) => e.event === 'guest.join' && e.actorId === winner.value.user.id,
    ),
  );
  db.close();
});

test('guest editor changes are attributable, downgrade applies and individual revocation closes SSE and delayed writes', async (t) => {
  const s = await setup(t);
  const invite = await s.createInvite('editor');
  const guest = await s.joinGuest(invite.code, 'Owner');
  const card = (
    await s.req(`/projects/${s.project.id}/cards`, guest.cookie, 'POST', {
      stage: 'events',
      kind: 'event',
      title: '게스트가 제안한 사건',
    })
  ).value;
  assert.match(card.updatedBy, /Owner \(게스트 ·/);
  assert.ok(card.updatedBy.includes(guest.value.user.id.slice(0, 8)));
  const audit = (await s.req('/admin/audit', s.owner.cookie)).value.events;
  assert.ok(
    audit.some(
      (e) => e.event === 'card.change' && e.actorId === guest.value.user.id,
    ),
  );
  const members = (
    await s.req(`/projects/${s.project.id}/access`, s.owner.cookie)
  ).value.members;
  assert.ok(!members.some((m) => m.userId === guest.value.user.id));
  const stream = await fetch(s.base + '/api/events', {
    headers: { cookie: guest.cookie },
  });
  const reader = stream.body.getReader();
  t.after(() => reader.cancel().catch(() => {}));
  assert.match(
    new TextDecoder().decode((await reader.read()).value),
    /게스트가 제안한 사건/,
  );
  await s.req(
    `/projects/${s.project.id}/members/${guest.value.user.id}`,
    s.owner.cookie,
    'PATCH',
    { role: 'viewer' },
  );
  assert.equal(
    (
      await s.req(`/cards/${card.id}`, guest.cookie, 'PATCH', {
        revision: card.revision,
        title: '불허',
      })
    ).status,
    403,
  );
  await s.req(
    `/projects/${s.project.id}/members/${guest.value.user.id}`,
    s.owner.cookie,
    'PATCH',
    { role: 'editor' },
  );
  const activeStream = await fetch(s.base + '/api/events', {
    headers: { cookie: guest.cookie },
  });
  const activeReader = activeStream.body.getReader();
  t.after(() => activeReader.cancel().catch(() => {}));
  assert.equal((await activeReader.read()).done, false);
  const pending = httpRequest(s.base + `/api/projects/${s.project.id}/cards`, {
    method: 'POST',
    headers: { cookie: guest.cookie, 'content-type': 'application/json' },
  });
  const completed = new Promise((resolve, reject) => {
    pending.on('response', (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    pending.on('error', reject);
  });
  pending.write('{"stage":"events",');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    (
      await s.req(
        `/projects/${s.project.id}/guests/${guest.value.user.id}`,
        s.owner.cookie,
        'DELETE',
      )
    ).status,
    200,
  );
  pending.end('"kind":"event","title":"철회 후 저장 금지"}');
  assert.equal(await completed, 401);
  assert.equal((await s.req('/state', guest.cookie)).status, 401);
  assert.equal(
    (await s.req(`/projects/${s.project.id}/export`, guest.cookie)).status,
    401,
  );
  let closeTimeout;
  try {
    await Promise.race([
      (async () => {
        try {
          while (!(await activeReader.read()).done) {}
        } catch {
          /* socket destroyed on revoke */
        }
      })(),
      new Promise((_, reject) => {
        closeTimeout = setTimeout(
          () => reject(new Error('Revoked guest SSE remained open')),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(closeTimeout);
  }
  assert.ok(
    !(await s.req('/state', s.owner.cookie)).value.cards.some(
      (c) => c.title === '철회 후 저장 금지',
    ),
  );
});

test('disabling guest access or revoking used invitations stops active guests and old codes never revive', async (t) => {
  const s = await setup(t);
  const used = await s.createInvite(),
    pending = await s.createInvite();
  const guest = await s.joinGuest(used.code);
  assert.equal(
    (
      await s.req(
        `/projects/${s.project.id}/guest-invitations/${used.invitation.id}`,
        s.owner.cookie,
        'DELETE',
      )
    ).status,
    200,
  );
  assert.equal((await s.req('/session', guest.cookie)).status, 401);
  const another = await s.joinGuest(pending.code);
  const unused = await s.createInvite();
  assert.equal(
    (
      await s.req(
        `/projects/${s.project.id}/guest-access`,
        s.owner.cookie,
        'PATCH',
        { enabled: false },
      )
    ).status,
    200,
  );
  assert.equal((await s.req('/session', another.cookie)).status, 401);
  assert.equal((await s.joinGuest(unused.code)).status, 401);
  await s.req(
    `/projects/${s.project.id}/guest-access`,
    s.owner.cookie,
    'PATCH',
    { enabled: true },
  );
  assert.equal((await s.joinGuest(unused.code)).status, 401);
  assert.equal((await s.joinGuest(used.code)).status, 401);
  assert.equal((await s.req('/state', s.owner.cookie)).status, 200);
  const fresh = await s.createInvite();
  assert.equal((await s.joinGuest(fresh.code)).status, 201);
});

test('guest sessions survive restart, enforce idle/absolute expiry and remain invalid after project deletion', async (t) => {
  const s = await setup(t);
  const invitation = await s.createInvite();
  const guest = await s.joinGuest(invitation.code);
  await s.restart();
  assert.equal((await s.req('/state', guest.cookie)).status, 200);
  assert.equal((await s.joinGuest(invitation.code)).status, 401);
  const db = new DatabaseSync(join(s.dataDir, 'ddd-builder.sqlite'));
  db.prepare('UPDATE auth_sessions SET last_seen=? WHERE user_id=?').run(
    Date.now() - 1800001,
    guest.value.user.id,
  );
  assert.equal((await s.req('/session', guest.cookie)).status, 401);
  const expired = await s.joinGuest((await s.createInvite()).code);
  db.prepare('UPDATE auth_guests SET expires_at=? WHERE user_id=?').run(
    Date.now() - 1,
    expired.value.user.id,
  );
  assert.equal((await s.req('/state', expired.cookie)).status, 401);
  const active = await s.joinGuest((await s.createInvite()).code);
  assert.equal(
    (
      await s.req(`/projects/${s.project.id}`, s.owner.cookie, 'DELETE', {
        revision: s.project.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    db
      .prepare('SELECT project_id FROM auth_guests WHERE user_id=?')
      .get(active.value.user.id).project_id,
    null,
  );
  assert.equal((await s.req('/state', active.cookie)).status, 401);
  assert.equal(
    (
      await s.req(
        `/admin/users/${active.value.user.id}`,
        s.owner.cookie,
        'PATCH',
        { siteAdmin: true },
      )
    ).status,
    403,
  );
  db.close();
});

test('guest login consumes the common login rate limit and full session capacity does not spend the code', async (t) => {
  const s = await setup(t, { security: { loginRate: { limit: 4 } } });
  const invite = await s.createInvite();
  assert.equal((await s.joinGuest('invalid-one')).status, 401);
  assert.equal((await s.joinGuest('invalid-two')).status, 401);
  const blocked = await s.joinGuest(invite.code);
  assert.equal(blocked.status, 429);
  assert.ok(blocked.response.headers.get('retry-after'));
  const capped = await setup(t, { security: { maxSessions: 1 } });
  const code = await capped.createInvite();
  assert.equal((await capped.joinGuest(code.code)).status, 429);
  await capped.req('/session', capped.owner.cookie, 'DELETE');
  assert.equal((await capped.joinGuest(code.code)).status, 201);
});

test('a guest cannot impersonate an OAuth member with the same display name or obtain MCP access', async (t) => {
  const s = await setup(t);
  const guest = await s.joinGuest(
    (await s.createInvite('editor')).code,
    '협업자',
  );
  await s.req(`/projects/${s.project.id}/invitations`, s.owner.cookie, 'POST', {
    email: 'collaborator@example.com',
    role: 'editor',
  });
  const account = await login(s.base, s.fixture, {
    sub: 'collaborator',
    email: 'collaborator@example.com',
    name: '협업자',
  });
  const user = (await s.req('/session', account.cookie)).value.user;
  assert.notEqual(user.id, guest.value.user.id);
  assert.equal(user.guest, undefined);
  assert.equal(
    (
      await s.req('/tokens', account.cookie, 'POST', {
        projectId: s.project.id,
        name: '계정 AI',
      })
    ).status,
    201,
  );
  const db = new DatabaseSync(join(s.dataDir, 'ddd-builder.sqlite'));
  const raw = 'forged-guest-token',
    { createHash } = await import('node:crypto');
  db.prepare('INSERT INTO auth_tokens VALUES (?,?,?,?,?,?,?,?)').run(
    'forged',
    createHash('sha256').update(raw).digest('hex'),
    guest.value.user.id,
    s.project.id,
    'forged',
    'write',
    Date.now(),
    Date.now() + 60000,
  );
  assert.equal(
    (
      await s.req('/state', undefined, 'GET', undefined, {
        authorization: `Bearer ${raw}`,
      })
    ).status,
    401,
  );
  assert.equal(
    db
      .prepare('SELECT count(*) AS n FROM auth_identities WHERE user_id=?')
      .get(guest.value.user.id).n,
    0,
  );
  db.close();
});

test('guest invitation issuance rechecks project authority after a delayed body arrives', async (t) => {
  const s = await setup(t);
  await s.createInvite();
  await s.req(`/projects/${s.project.id}/invitations`, s.owner.cookie, 'POST', {
    email: 'second@example.com',
    role: 'admin',
  });
  const second = await login(s.base, s.fixture, {
    sub: 'second-admin',
    email: 'second@example.com',
  });
  const ownerId = (await s.req('/session', s.owner.cookie)).value.user.id;
  const pending = httpRequest(
    s.base + `/api/projects/${s.project.id}/guest-invitations`,
    {
      method: 'POST',
      headers: { cookie: s.owner.cookie, 'content-type': 'application/json' },
    },
  );
  const completed = new Promise((resolve, reject) => {
    pending.on('response', (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    pending.on('error', reject);
  });
  pending.write('{"name":"지연된');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    (
      await s.req(
        `/projects/${s.project.id}/members/${ownerId}`,
        second.cookie,
        'DELETE',
      )
    ).status,
    200,
  );
  pending.end(' 초대","role":"viewer"}');
  assert.equal(await completed, 404);
  const list = (
    await s.req(`/projects/${s.project.id}/guest-access`, second.cookie)
  ).value.invitations;
  assert.ok(!list.some((i) => i.name === '지연된 초대'));
});
