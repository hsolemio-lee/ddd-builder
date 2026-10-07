import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { request } from 'node:http';

async function setup(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-security-'));
  const app = await createApp({ dataDir, code: 'test-secret', ...options });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function req(
    path,
    { method = 'GET', cookie, body, headers = {} } = {},
  ) {
    // fetch implementations may rewrite Host; use real HTTP for host routing.
    if (headers.host)
      return new Promise((resolve, reject) => {
        const outgoing = request(
          base + path,
          {
            method,
            headers: { ...(cookie ? { cookie } : {}), ...headers },
          },
          (incoming) => {
            incoming.resume();
            incoming.on('end', () =>
              resolve({
                status: incoming.statusCode,
                headers: new Headers(incoming.headers),
              }),
            );
          },
        );
        outgoing.on('error', reject);
        outgoing.end(body ? JSON.stringify(body) : undefined);
      });
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    await response.arrayBuffer();
    return response;
  }
  const login = async (cookie) => {
    const response = await req('/api/session', {
      method: 'POST',
      cookie,
      body: { name: 'Tester', code: 'test-secret' },
    });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  async function stream(cookie) {
    const controller = new AbortController();
    const response = await fetch(base + '/api/events', {
      headers: { cookie },
      signal: controller.signal,
    });
    t.after(() => controller.abort());
    return { response, controller };
  }
  return { app, req, login, stream, base, dataDir };
}

async function largeBoard(base, cookie, count = 30) {
  let project;
  for (let i = 0; i < count; i++) {
    const response = await fetch(base + '/api/projects', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `Large ${i}`,
        description: 'x'.repeat(20000),
      }),
    });
    assert.equal(response.status, 201);
    project = await response.json();
  }
  return project;
}

async function rawStream(t, base, cookie, { paused = false, onData } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      base + '/api/events',
      { headers: { cookie } },
      (response) => {
        response.on('error', () => {}); // Server forcibly disconnects slow/revoked streams.
        if (onData) response.on('data', onData);
        if (paused) response.pause();
        else response.resume();
        resolve(response);
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
    t.after(() => outgoing.destroy());
  });
}

async function drainClosed(reader) {
  try {
    while (!(await reader.read()).done) {}
  } catch (error) {
    assert.equal(
      error.cause?.code,
      'UND_ERR_SOCKET',
      'revocation terminates the transport',
    );
  }
}

test('paused SSE readers have bounded output and are disconnected while readers continue receiving broadcasts', async (t) => {
  const { app, req, login, base } = await setup(t, {
    security: { maxSseClients: 2, maxSsePerSession: 1 },
  });
  const writer = await login(),
    slow = await login(),
    active = await login();
  const project = await largeBoard(base, writer);
  const responses = [];
  app.server.on('request', (incoming, response) => {
    if (incoming.url === '/api/events') responses.push(response);
  });
  const paused = await rawStream(t, base, slow, { paused: true });
  assert.equal(paused.statusCode, 200);
  const slowResponse = responses[0];
  let pending = '',
    latestName;
  const activeStream = await rawStream(t, base, active, {
    onData(part) {
      pending += part.toString();
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        const event = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        if (!event.startsWith('event: state\n')) continue;
        const state = JSON.parse(event.slice('event: state\ndata: '.length));
        latestName = state.projects.find((p) => p.id === project.id)?.name;
      }
    },
  });
  assert.equal(activeStream.statusCode, 200);
  async function received(name) {
    const deadline = Date.now() + 10000;
    while (
      latestName !== name &&
      Date.now() < deadline &&
      !activeStream.destroyed
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(
      latestName,
      name,
      'active reader receives the complete state frame',
    );
  }
  await received(project.name);
  let maxQueued = slowResponse.writableLength;
  for (let i = 0; i < 60; i++) {
    assert.equal(
      (
        await req(`/api/projects/${project.id}`, {
          method: 'PATCH',
          cookie: writer,
          body: { revision: project.revision + i, name: `Broadcast ${i}` },
        })
      ).status,
      200,
    );
    maxQueued = Math.max(maxQueued, slowResponse.writableLength);
    // Pace the writer on actual consumption; a fast producer can overwhelm even
    // a reading peer on a loaded runner, which is correctly disconnected.
    await received(`Broadcast ${i}`);
  }
  assert.ok(
    maxQueued <= 1024 * 1024,
    `queued output exceeded cap: ${maxQueued}`,
  );
  assert.equal(
    slowResponse.destroyed,
    true,
    'slow reader must be disconnected',
  );
  assert.equal(
    responses[1].destroyed,
    false,
    'reading stream remains connected',
  );
  assert.equal(
    latestName,
    'Broadcast 59',
    'active reader receives final update',
  );
});

test('logout destroys a paused stream with queued bytes before releasing its capacity', async (t) => {
  const { app, req, login, base } = await setup(t, {
    security: { maxSseClients: 1, maxSsePerSession: 1 },
  });
  const writer = await login(),
    slow = await login(),
    replacement = await login();
  const project = await largeBoard(base, writer);
  let serverResponse;
  app.server.on('request', (incoming, response) => {
    if (incoming.url === '/api/events') serverResponse = response;
  });
  await rawStream(t, base, slow, { paused: true });
  const revoked = serverResponse,
    socket = revoked.socket;
  for (let i = 0; i < 40 && revoked.writableLength === 0; i++) {
    assert.equal(
      (
        await req(`/api/projects/${project.id}`, {
          method: 'PATCH',
          cookie: writer,
          body: { revision: project.revision + i, name: `Queued ${i}` },
        })
      ).status,
      200,
    );
  }
  assert.ok(revoked.writableLength > 0, 'real paused socket has queued output');
  assert.equal(
    (await req('/api/session', { method: 'DELETE', cookie: slow })).status,
    200,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(revoked.destroyed, true, 'revoked response must be destroyed');
  assert.equal(
    socket.destroyed,
    true,
    'revoked socket cannot remain as an orphan',
  );
  assert.equal((await req('/api/session', { cookie: slow })).status, 401);
  assert.equal((await rawStream(t, base, replacement)).statusCode, 200);
});

test('an initial SSE state larger than the output cap fails before stream headers or capacity allocation', async (t) => {
  const { req, login, base, stream } = await setup(t, {
    security: { maxSseClients: 1 },
  });
  const cookie = await login();
  await largeBoard(base, cookie, 55);
  const response = (await stream(cookie)).response;
  assert.equal(response.status, 413);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(
    (await stream(cookie)).response.status,
    413,
    'failed initial state does not consume capacity',
  );
  assert.equal((await req('/api/state', { cookie })).status, 200);
});

test('a configured SSE output cap permits a larger legitimate initial state', async (t) => {
  const { login, base } = await setup(t, {
    security: { maxSseBufferBytes: 2 * 1024 * 1024 },
  });
  const cookie = await login();
  await largeBoard(base, cookie, 55);
  assert.equal((await rawStream(t, base, cookie)).statusCode, 200);
});

test('security headers cover static files, API responses and errors on HTTP', async (t) => {
  const staticDir = await mkdtemp(join(tmpdir(), 'ddd-sec-static-'));
  t.after(() => rm(staticDir, { recursive: true, force: true }));
  await writeFile(join(staticDir, 'index.html'), '<h1>DDD</h1>');
  const { req } = await setup(t, { staticDir });
  for (const path of ['/', '/api/state', '/missing']) {
    const response = await req(path);
    const csp = response.headers.get('content-security-policy');
    for (const directive of [
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "connect-src 'self'",
    ])
      assert.ok(csp?.includes(directive), directive);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
    assert.equal(response.headers.get('strict-transport-security'), null);
  }
});

test('HSTS requires the configured HTTPS host; HTTPS and local origins retain safe cookies', async (t) => {
  const publicUrl = 'https://workshop.example';
  const { req, base } = await setup(t, { publicUrl });
  const canonical = await req('/api/session', {
    method: 'POST',
    body: { name: 'Tester', code: 'test-secret' },
    headers: { host: 'workshop.example', origin: publicUrl },
  });
  assert.equal(canonical.status, 200);
  assert.match(canonical.headers.get('strict-transport-security'), /max-age=/);
  assert.match(canonical.headers.get('set-cookie'), /; Secure/);
  const local = await req('/api/session', {
    method: 'POST',
    body: { name: 'Local', code: 'test-secret' },
    headers: { origin: base, 'x-forwarded-proto': 'https' },
  });
  assert.equal(local.status, 200);
  assert.equal(local.headers.get('strict-transport-security'), null);
  assert.doesNotMatch(local.headers.get('set-cookie'), /; Secure/);
  const mismatch = await req('/api/session', {
    method: 'POST',
    body: { name: 'Mismatch', code: 'test-secret' },
    headers: { host: 'workshop.example', origin: 'http://workshop.example' },
  });
  assert.equal(mismatch.status, 403);
  const originOnly = await req('/api/state', {
    headers: { origin: publicUrl },
  });
  assert.equal(originOnly.headers.get('strict-transport-security'), null);
});

test('total API requests are limited by socket peer despite forged forwarding headers and recover', async (t) => {
  const { req } = await setup(t, {
    security: { apiRate: { limit: 2, windowMs: 100 } },
  });
  assert.equal((await req('/api/state')).status, 401);
  assert.equal(
    (
      await req('/api/missing', {
        headers: { 'x-forwarded-for': '198.51.100.1' },
      })
    ).status,
    401,
  );
  const blocked = await req('/api/state', {
    headers: { 'x-forwarded-for': '198.51.100.2' },
  });
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers.get('retry-after'), /^[1-9]\d*$/);
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.equal((await req('/api/state')).status, 401);
});

test('login attempts are limited before authentication, including correct codes', async (t) => {
  const { req } = await setup(t, { security: { loginRate: { limit: 2 } } });
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await req('/api/session', {
          method: 'POST',
          body: { name: 'Tester', code: 'wrong' },
        })
      ).status,
      401,
    );
  const blocked = await req('/api/session', {
    method: 'POST',
    body: { name: 'Tester', code: 'test-secret' },
  });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
});

test('authenticated writes have a per-session limit and leave reads available', async (t) => {
  const { req, login } = await setup(t, {
    security: { writeRate: { limit: 1 } },
  });
  const alice = await login(),
    bob = await login();
  const create = (cookie) =>
    req('/api/projects', { method: 'POST', cookie, body: { name: 'Board' } });
  assert.equal((await create(alice)).status, 201);
  assert.equal((await create(alice)).status, 429);
  assert.equal((await req('/api/state', { cookie: alice })).status, 200);
  assert.equal((await create(bob)).status, 201);
});

test('authenticated logout bypasses exhausted write quota, revokes its session and closes SSE', async (t) => {
  const { req, login, stream, base } = await setup(t, {
    security: { writeRate: { limit: 1 } },
  });
  const cookie = await login();
  const events = await stream(cookie);
  assert.equal(events.response.status, 200);
  const reader = events.response.body.getReader();
  await reader.read();
  const create = () =>
    req('/api/projects', {
      method: 'POST',
      cookie,
      body: { name: 'Quota' },
    });
  assert.equal((await create()).status, 201);
  assert.equal((await create()).status, 429);
  assert.equal(
    (
      await req('/api/session', {
        method: 'DELETE',
        cookie,
        headers: { origin: 'https://foreign.example' },
      })
    ).status,
    403,
  );
  assert.equal((await req('/api/session', { cookie })).status, 200);
  const logout = await req('/api/session', {
    method: 'DELETE',
    cookie,
    headers: { origin: base },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /^ddd_session=;.*Max-Age=0/);
  assert.equal((await req('/api/session', { cookie })).status, 401);
  await drainClosed(reader);
});

test('authenticated same-origin logout also bypasses exhausted total API quota', async (t) => {
  const { req, login, stream, base } = await setup(t, {
    security: { apiRate: { limit: 3, windowMs: 500 } },
  });
  const cookie = await login();
  const events = await stream(cookie);
  assert.equal(events.response.status, 200);
  const reader = events.response.body.getReader();
  await reader.read();
  assert.equal((await req('/api/state', { cookie })).status, 200);
  assert.equal((await req('/api/state', { cookie })).status, 429);
  assert.equal((await req('/api/session', { method: 'DELETE' })).status, 429);
  assert.equal(
    (
      await req('/api/session', {
        method: 'DELETE',
        cookie,
        headers: { origin: 'https://foreign.example' },
      })
    ).status,
    429,
  );
  const logout = await req('/api/session', {
    method: 'DELETE',
    cookie,
    headers: { origin: base },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /^ddd_session=;.*Max-Age=0/);
  await drainClosed(reader);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal((await req('/api/session', { cookie })).status, 401);
});

test('a full limiter refuses new keys without evicting existing counters and reclaims expired keys', async (t) => {
  const { req, login } = await setup(t, {
    security: { writeRate: { limit: 1, maxKeys: 1, windowMs: 500 } },
  });
  const alice = await login(),
    bob = await login();
  const create = (cookie) =>
    req('/api/projects', {
      method: 'POST',
      cookie,
      body: { name: 'Bounded' },
    });
  assert.equal((await create(alice)).status, 201);
  assert.equal((await create(bob)).status, 429);
  assert.equal((await create(alice)).status, 429);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal((await create(bob)).status, 201);
});

test('session capacity refuses a new login without evicting live sessions and allows replacement/logout', async (t) => {
  const { req, login } = await setup(t, { security: { maxSessions: 1 } });
  const cookie = await login();
  assert.equal(
    (
      await req('/api/session', {
        method: 'POST',
        body: { name: 'New', code: 'test-secret' },
      })
    ).status,
    429,
  );
  assert.equal((await req('/api/state', { cookie })).status, 200);
  const replaced = await login(cookie);
  assert.equal((await req('/api/state', { cookie })).status, 401);
  assert.equal(
    (await req('/api/session', { method: 'DELETE', cookie: replaced })).status,
    200,
  );
  await login();
});

test('expired sessions release capacity immediately when a new login arrives', async (t) => {
  const { req, login } = await setup(t, {
    security: { maxSessions: 1, sessionLifetimeMs: 60 },
  });
  const expired = await login();
  await new Promise((resolve) => setTimeout(resolve, 80));
  const current = await login();
  assert.equal((await req('/api/state', { cookie: expired })).status, 401);
  assert.equal((await req('/api/state', { cookie: current })).status, 200);
});

test('SSE per-session and total caps refuse excess streams without closing existing streams', async (t) => {
  const { req, login, stream } = await setup(t, {
    security: { maxSseClients: 2, maxSsePerSession: 1 },
  });
  const alice = await login(),
    bob = await login(),
    carol = await login();
  const first = await stream(alice);
  assert.equal(first.response.status, 200);
  const duplicate = await stream(alice);
  assert.equal(duplicate.response.status, 429);
  assert.ok(duplicate.response.headers.get('retry-after'));
  const second = await stream(bob);
  assert.equal(second.response.status, 200);
  assert.equal((await stream(carol)).response.status, 429);
  const reader = first.response.body.getReader();
  await reader.read();
  assert.equal(
    (
      await req('/api/projects', {
        method: 'POST',
        cookie: alice,
        body: { name: 'Still live' },
      })
    ).status,
    201,
  );
  let observed = '';
  while (!observed.includes('Still live')) {
    const update = await reader.read();
    assert.equal(update.done, false);
    observed += new TextDecoder().decode(update.value);
  }
  await req('/api/session', { method: 'DELETE', cookie: bob });
  assert.equal((await stream(carol)).response.status, 200);
});

test('SSE disconnect releases capacity and expired sessions close their streams', async (t) => {
  const { login, stream } = await setup(t, {
    security: {
      maxSseClients: 1,
      maxSsePerSession: 1,
      sessionLifetimeMs: 1000,
    },
  });
  const cookie = await login();
  const first = await stream(cookie);
  first.controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await stream(cookie);
  assert.equal(second.response.status, 200);
  const reader = second.response.body.getReader();
  await reader.read();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await login(); // Reclaims expired sessions and their streams before admitting replacements.
  await drainClosed(reader);
});

test('invalid security options are rejected before creating a database', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ddd-sec-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const security of [
    { maxSessions: 0 },
    { maxSseClients: -1 },
    { maxSsePerSession: 1.5 },
    { maxSseBufferBytes: 0 },
    { maxSseBufferBytes: Infinity },
    { sessionLifetimeMs: Infinity },
    { apiRate: { limit: 0 } },
    { loginRate: { windowMs: -1 } },
    { writeRate: { maxKeys: 0 } },
    { unknown: true },
    { apiRate: { unknown: 1 } },
    null,
    { apiRate: null },
    { maxSessions: null },
    { constructor: 1 },
  ]) {
    const dataDir = join(root, 'untouched');
    let app;
    try {
      await assert.rejects(async () => {
        app = await createApp({ dataDir, code: 'test-secret', security });
      }, /security/i);
    } finally {
      await app?.close();
    }
    await assert.rejects(stat(dataDir), { code: 'ENOENT' });
  }
});
