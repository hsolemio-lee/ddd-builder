import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createApp } from '../server/app.mjs';

async function setup(t, options = {}) {
  assert.equal(typeof createApp, 'function', 'backend exports createApp');
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-test-'));
  const app = await createApp({ dataDir, code: 'test-secret', ...options });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function req(path, method = 'GET', body, cookie, extra = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = response.headers
      .get('content-type')
      ?.includes('application/json')
      ? await response.json()
      : await response.text();
    return { status: response.status, data, headers: response.headers };
  }
  const login = async (name = '지민') => {
    const r = await req('/api/session', 'POST', { name, code: 'test-secret' });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  };
  return { app, dataDir, base, req, login };
}
async function stream(base, cookie) {
  const controller = new AbortController();
  const response = await fetch(base + '/api/events', {
    headers: { cookie },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const events = [],
    waiters = [];
  let buffer = '';
  const pump = (async () => {
    try {
      for await (const part of response.body) {
        buffer += new TextDecoder().decode(part);
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = frame.match(/^event: (.+)$/m)?.[1],
            raw = frame.match(/^data: (.+)$/m)?.[1];
          if (name && raw) {
            events.push({ name, data: JSON.parse(raw) });
            for (const wake of waiters.splice(0)) wake();
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
  })();
  return {
    events,
    async next(name, predicate = () => true) {
      const deadline = Date.now() + 2500;
      for (;;) {
        const index = events.findIndex(
          (e) => e.name === name && predicate(e.data),
        );
        if (index >= 0) return events.splice(index, 1)[0].data;
        if (Date.now() >= deadline) throw Error(`SSE timeout: ${name}`);
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 40);
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
    async close() {
      controller.abort();
      await pump;
    },
  };
}

test('auth protects data, establishes HttpOnly session and rejects cross-origin writes', async (t) => {
  const { req, login } = await setup(t);
  assert.equal((await req('/api/state')).status, 401);
  assert.equal(
    (await req('/api/session', 'POST', { name: '지민', code: 'wrong' })).status,
    401,
  );
  assert.equal(
    (await req('/api/session', 'POST', { name: '', code: 'test-secret' }))
      .status,
    400,
  );
  const signed = await req('/api/session', 'POST', {
    name: '지민',
    code: 'test-secret',
  });
  assert.match(signed.headers.get('set-cookie'), /HttpOnly/);
  const cookie = await login();
  assert.equal(
    (await req('/api/session', 'GET', undefined, cookie)).data.user.name,
    '지민',
  );
  assert.equal(
    (
      await req('/api/projects', 'POST', { name: 'bad' }, cookie, {
        origin: 'https://evil.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (await req('/api/session', 'DELETE', undefined, cookie)).status,
    200,
  );
  assert.equal((await req('/api/state', 'GET', undefined, cookie)).status, 401);
});

test('project and card CRUD enforce revisions and persist after restart', async (t) => {
  const { app, dataDir, req, login } = await setup(t);
  const cookie = await login();
  let project = (
    await req(
      '/api/projects',
      'POST',
      { name: '팀', description: '공유' },
      cookie,
    )
  ).data;
  assert.equal(project.revision, 1);
  assert.equal(project.updatedBy, '지민');
  project = (
    await req(
      `/api/projects/${project.id}`,
      'PATCH',
      { name: '새 팀', revision: 1 },
      cookie,
    )
  ).data;
  assert.equal(project.revision, 2);
  const conflict = await req(
    `/api/projects/${project.id}`,
    'PATCH',
    { name: '낡은 팀', revision: 1 },
    cookie,
  );
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.data.current, project);
  let card = (
    await req(
      `/api/projects/${project.id}/cards`,
      'POST',
      {
        stage: 'tasks',
        kind: 'task',
        title: '작업',
        data: { assignee: '민수', done: false },
      },
      cookie,
    )
  ).data;
  card = (
    await req(
      `/api/cards/${card.id}`,
      'PATCH',
      { data: { assignee: '지민', done: true }, position: 42, revision: 1 },
      cookie,
    )
  ).data;
  assert.equal(card.revision, 2);
  assert.equal(card.data.done, true);
  assert.equal(
    (
      await req(
        `/api/cards/${card.id}`,
        'PATCH',
        { position: 3, revision: 1 },
        cookie,
      )
    ).status,
    409,
  );
  await app.close();
  const restarted = await createApp({ dataDir, code: 'test-secret' });
  t.after(() => restarted.close());
  const base = `http://127.0.0.1:${restarted.server.address().port}`;
  const logged = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '다시', code: 'test-secret' }),
  });
  const state = await (
    await fetch(base + '/api/state', {
      headers: { cookie: logged.headers.get('set-cookie').split(';')[0] },
    })
  ).json();
  assert.deepEqual(
    state.cards.find((c) => c.id === card.id),
    card,
  );
  assert.deepEqual(
    state.projects.find((p) => p.id === project.id),
    project,
  );
});

test('context removal clears references and increases affected revisions atomically; project deletion cascades', async (t) => {
  const { req, login } = await setup(t);
  const cookie = await login();
  const project = (
    await req('/api/projects', 'POST', { name: '컨텍스트' }, cookie)
  ).data;
  const context = (
    await req(
      `/api/projects/${project.id}/cards`,
      'POST',
      {
        stage: 'contexts',
        kind: 'context',
        title: '주문',
        data: { relationships: '결제' },
      },
      cookie,
    )
  ).data;
  const aggregate = (
    await req(
      `/api/projects/${project.id}/cards`,
      'POST',
      {
        stage: 'aggregates',
        kind: 'aggregate',
        title: '주문',
        contextId: context.id,
      },
      cookie,
    )
  ).data;
  assert.equal(
    (await req(`/api/cards/${context.id}`, 'DELETE', { revision: 2 }, cookie))
      .status,
    409,
  );
  assert.equal(
    (await req(`/api/cards/${context.id}`, 'DELETE', { revision: 1 }, cookie))
      .status,
    200,
  );
  const state = (await req('/api/state', 'GET', undefined, cookie)).data;
  const cleared = state.cards.find((c) => c.id === aggregate.id);
  assert.equal(cleared.contextId, null);
  assert.equal(cleared.revision, 2);
  assert.equal(
    (
      await req(
        `/api/projects/${project.id}`,
        'DELETE',
        { revision: 1 },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await req('/api/state', 'GET', undefined, cookie)).data.cards.some(
      (c) => c.projectId === project.id,
    ),
    false,
  );
});

test('validation rejects wrong kinds, immutable fields, foreign contexts, malformed and oversized data', async (t) => {
  const { req, base, login } = await setup(t);
  const cookie = await login();
  const project = (await req('/api/projects', 'POST', { name: 'A' }, cookie))
    .data;
  const second = (await req('/api/projects', 'POST', { name: 'B' }, cookie))
    .data;
  const context = (
    await req(
      `/api/projects/${second.id}/cards`,
      'POST',
      { stage: 'contexts', kind: 'context', title: 'B' },
      cookie,
    )
  ).data;
  const path = `/api/projects/${project.id}/cards`;
  for (const body of [
    { stage: 'tasks', kind: 'event', title: 'x' },
    { stage: 'tasks', kind: 'task', title: 'x', data: { done: 'yes' } },
    { stage: 'events', kind: 'event', title: 'x', contextId: context.id },
    {
      stage: 'tasks',
      kind: 'task',
      title: 'x',
      position: { x: Infinity, y: 0 },
    },
    { stage: 'events', kind: 'event', title: '' },
  ])
    assert.equal((await req(path, 'POST', body, cookie)).status, 400);
  const card = (
    await req(
      path,
      'POST',
      { stage: 'events', kind: 'event', title: '정상' },
      cookie,
    )
  ).data;
  for (const patch of [
    { id: 'changed' },
    { stage: 'tasks' },
    { projectId: second.id },
  ])
    assert.equal(
      (
        await req(
          `/api/cards/${card.id}`,
          'PATCH',
          { ...patch, revision: 1 },
          cookie,
        )
      ).status,
      400,
    );
  assert.equal(
    (await req(`/api/cards/${card.id}`, 'PATCH', { title: 'x' }, cookie))
      .status,
    400,
  );
  assert.equal(
    (await req('/api/projects/nope', 'PATCH', { revision: 1 }, cookie)).status,
    404,
  );
  assert.equal(
    (
      await fetch(base + '/api/projects', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{broken',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        '/api/projects',
        'POST',
        { name: 'x', description: 'x'.repeat(140000) },
        cookie,
      )
    ).status,
    400,
  );
});

test('SSE shares persisted changes with two clients, dedupes sessions, cleans presence, and reconnects to full state', async (t) => {
  const { req, base, login } = await setup(t);
  const alice = await login('Alice'),
    bob = await login('Bob');
  const a = await stream(base, alice);
  const b = await stream(base, bob);
  const duplicate = await stream(base, alice);
  t.after(async () => {
    await a.close();
    await b.close();
    await duplicate.close();
  });
  await a.next('state');
  await b.next('state');
  const presence = await b.next('presence', (people) => people.length === 2);
  assert.deepEqual(presence.map((p) => p.name).sort(), ['Alice', 'Bob']);
  const project = (
    await req('/api/projects', 'POST', { name: '실시간' }, alice)
  ).data;
  assert.equal(
    (
      await a.next('state', (s) => s.projects.some((p) => p.id === project.id))
    ).projects.find((p) => p.id === project.id).name,
    '실시간',
  );
  await b.next('state', (s) => s.projects.some((p) => p.id === project.id));
  await b.close();
  await a.next('presence', (people) => people.length === 1);
  const reconnect = await stream(base, bob);
  t.after(() => reconnect.close());
  assert.equal(
    (await reconnect.next('state')).projects.some((p) => p.id === project.id),
    true,
  );
});

test('exports are authenticated attachments, include all project content, and exclude secrets', async (t) => {
  const { req, login } = await setup(t);
  const cookie = await login();
  const state = (await req('/api/state', 'GET', undefined, cookie)).data;
  assert.equal(state.projects[0].name, '온라인 주문 서비스');
  const project = state.projects[0];
  for (const format of ['json', 'markdown']) {
    assert.equal(
      (await req(`/api/projects/${project.id}/export?format=${format}`)).status,
      401,
    );
    const exportResult = await req(
      `/api/projects/${project.id}/export?format=${format}`,
      'GET',
      undefined,
      cookie,
    );
    assert.equal(exportResult.status, 200);
    assert.match(exportResult.headers.get('content-disposition'), /attachment/);
    const content =
      typeof exportResult.data === 'string'
        ? exportResult.data
        : JSON.stringify(exportResult.data);
    assert.match(content, /온라인 주문 서비스/);
    assert.equal(content.includes('test-secret'), false);
    if (format === 'json')
      assert.equal(
        exportResult.data.cards.length,
        state.cards.filter((c) => c.projectId === project.id).length,
      );
  }
  assert.equal(
    (
      await req(
        `/api/projects/${project.id}/export?format=xml`,
        'GET',
        undefined,
        cookie,
      )
    ).status,
    400,
  );
  const info = await req('/api/info', 'GET', undefined, cookie);
  assert.equal(Array.isArray(info.data.urls), true);
});

test('static files are served safely and API misses do not return HTML', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ddd-static-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'index.html'), '<h1>DDD</h1>');
  await writeFile(join(dir, 'main.js'), 'const ready=true;');
  const { req } = await setup(t, { staticDir: dir });
  assert.match((await req('/')).data, /DDD/);
  assert.match(
    (await req('/main.js')).headers.get('content-type'),
    /javascript/,
  );
  assert.equal((await req('/api/not-found')).status, 401);
  assert.equal((await req('/%2e%2e%2fserver%2fapp.mjs')).status, 404);
});

test('concurrent writes resolve one revision once and preserve the winning fields', async (t) => {
  const { req, login } = await setup(t);
  const cookie = await login();
  const project = (
    await req('/api/projects', 'POST', { name: '동시 편집' }, cookie)
  ).data;
  const card = (
    await req(
      `/api/projects/${project.id}/cards`,
      'POST',
      {
        stage: 'tasks',
        kind: 'task',
        title: '작업',
        data: { assignee: '지민', done: false },
      },
      cookie,
    )
  ).data;
  const results = await Promise.all([
    req(
      `/api/cards/${card.id}`,
      'PATCH',
      { position: 11, revision: 1 },
      cookie,
    ),
    req(
      `/api/cards/${card.id}`,
      'PATCH',
      { data: { assignee: '지민', done: true }, revision: 1 },
      cookie,
    ),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const state = (await req('/api/state', 'GET', undefined, cookie)).data;
  assert.deepEqual(
    state.cards.find((c) => c.id === card.id),
    results.find((r) => r.status === 200).data,
  );
});

test('info provides a working local MCP launch configuration to authenticated users', async (t) => {
  const { req, login, base } = await setup(t);
  const cookie = await login();
  const info = (await req('/api/info', 'GET', undefined, cookie)).data;
  assert.equal(info.mcp.command, process.execPath);
  assert.equal(
    info.mcp.args[0],
    join(import.meta.dirname, '..', 'mcp', 'index.mjs'),
  );
  assert.equal(info.mcp.env.DDD_URL, base);
  assert.equal(info.mcp.env.DDD_CODE, 'test-secret');
});

test('CLI saves a private access code, respects ACCESS_CODE, and initializes demo only once', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-cli-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  async function run(env = {}) {
    const child = spawn(process.execPath, ['server/index.mjs'], {
      cwd: join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        HOST: '127.0.0.1',
        PORT: '0',
        ACCESS_CODE: '',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => child.kill('SIGTERM'));
    let output = '',
      errors = '';
    child.stdout.on('data', (part) => {
      output += part;
    });
    child.stderr.on('data', (part) => {
      errors += part;
    });
    const deadline = Date.now() + 3000;
    while (!output.match(/http:\/\/127\.0\.0\.1:\d+/)) {
      if (child.exitCode !== null) assert.fail(`CLI exited: ${errors}`);
      if (Date.now() > deadline) assert.fail(`CLI did not start: ${errors}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return {
      child,
      output,
      base: output.match(/http:\/\/127\.0\.0\.1:\d+/)[0],
      stop: () =>
        new Promise((resolve) => {
          child.once('exit', resolve);
          child.kill('SIGTERM');
        }),
    };
  }
  const first = await run();
  const code = (await readFile(join(dataDir, 'access-code'), 'utf8')).trim();
  assert.ok(code.length >= 20);
  assert.equal((await stat(join(dataDir, 'access-code'))).mode & 0o777, 0o600);
  assert.ok(first.output.includes(code));
  const loginResponse = await fetch(first.base + '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'CLI', code }),
  });
  const cookie = loginResponse.headers.get('set-cookie').split(';')[0];
  const state = await (
    await fetch(first.base + '/api/state', { headers: { cookie } })
  ).json();
  await fetch(first.base + `/api/projects/${state.projects[0].id}`, {
    method: 'DELETE',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ revision: state.projects[0].revision }),
  });
  await first.stop();
  const second = await run({ ACCESS_CODE: 'explicit-code' });
  const signed = await fetch(second.base + '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'CLI', code: 'explicit-code' }),
  });
  assert.equal(signed.status, 200);
  const after = await (
    await fetch(second.base + '/api/state', {
      headers: { cookie: signed.headers.get('set-cookie').split(';')[0] },
    })
  ).json();
  assert.equal(after.projects.length, 0);
  await second.stop();
});

test('a delayed request body cannot overwrite a newer committed revision', async (t) => {
  const { req, login, base } = await setup(t);
  const cookie = await login();
  const project = (await req('/api/projects', 'POST', { name: '충돌' }, cookie))
    .data;
  const card = (
    await req(
      `/api/projects/${project.id}/cards`,
      'POST',
      { stage: 'tasks', kind: 'task', title: '원본' },
      cookie,
    )
  ).data;
  const { request } = await import('node:http');
  let pending;
  const result = new Promise((resolve, reject) => {
    pending = request(
      base + `/api/cards/${card.id}`,
      {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode, data: JSON.parse(raw) }),
        );
      },
    );
    pending.on('error', reject);
    pending.write('{');
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const winner = await req(
    `/api/cards/${card.id}`,
    'PATCH',
    { title: '먼저 저장', revision: 1 },
    cookie,
  );
  assert.equal(winner.status, 200);
  pending.end('"title":"늦게 저장","revision":1}');
  const delayed = await result;
  assert.equal(delayed.status, 409);
  assert.equal(delayed.data.current.title, '먼저 저장');
});

test('explicit null and wrong field types never silently reuse prior project values', async (t) => {
  const { req, login } = await setup(t);
  const cookie = await login();
  assert.equal(
    (
      await req(
        '/api/projects',
        'POST',
        { name: '프로젝트', description: null },
        cookie,
      )
    ).status,
    400,
  );
  const project = (
    await req('/api/projects', 'POST', { name: '프로젝트' }, cookie)
  ).data;
  for (const patch of [
    { name: null },
    { description: null },
    { description: 42 },
  ])
    assert.equal(
      (
        await req(
          `/api/projects/${project.id}`,
          'PATCH',
          { ...patch, revision: 1 },
          cookie,
        )
      ).status,
      400,
    );
  assert.equal(
    (await req('/api/state', 'GET', undefined, cookie)).data.projects.find(
      (p) => p.id === project.id,
    ).revision,
    1,
  );
});

test('a project deleted while a card request arrives cannot receive orphan cards', async (t) => {
  const { req, login, base } = await setup(t);
  const cookie = await login();
  const project = (
    await req('/api/projects', 'POST', { name: '삭제 경쟁' }, cookie)
  ).data;
  const { request } = await import('node:http');
  let pending;
  const result = new Promise((resolve, reject) => {
    pending = request(
      base + `/api/projects/${project.id}/cards`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    pending.on('error', reject);
    pending.write('{');
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    (
      await req(
        `/api/projects/${project.id}`,
        'DELETE',
        { revision: 1 },
        cookie,
      )
    ).status,
    200,
  );
  pending.end('"stage":"events","kind":"event","title":"새 이벤트"}');
  assert.equal(await result, 404);
});

test('missing frontend build gives useful instructions while the API stays available', async (t) => {
  const { req, login } = await setup(t, {
    staticDir: join(tmpdir(), `ddd-unbuilt-${Date.now()}`),
  });
  const page = await req('/');
  assert.equal(page.status, 503);
  assert.match(page.data, /npm run build/);
  const cookie = await login();
  assert.equal((await req('/api/state', 'GET', undefined, cookie)).status, 200);
});

test('a stale edit after context removal receives the current card as a revision conflict', async (t) => {
  const { req, login } = await setup(t);
  const cookie = await login();
  const project = (
    await req('/api/projects', 'POST', { name: '컨텍스트 충돌' }, cookie)
  ).data;
  const context = (
    await req(
      `/api/projects/${project.id}/cards`,
      'POST',
      { stage: 'contexts', kind: 'context', title: '주문' },
      cookie,
    )
  ).data;
  const card = (
    await req(
      `/api/projects/${project.id}/cards`,
      'POST',
      {
        stage: 'aggregates',
        kind: 'aggregate',
        title: '주문',
        contextId: context.id,
      },
      cookie,
    )
  ).data;
  await req(`/api/cards/${context.id}`, 'DELETE', { revision: 1 }, cookie);
  const stale = await req(
    `/api/cards/${card.id}`,
    'PATCH',
    { title: '이전 편집', contextId: context.id, revision: 1 },
    cookie,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.data.current.contextId, null);
  assert.equal(stale.data.current.revision, 2);
});

test('expired sessions reject requests and also close their active event streams', async (t) => {
  const { req, login, base } = await setup(t);
  const cookie = await login();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(base + '/api/events', {
    headers: { cookie },
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  await reader.read();
  const future = Date.now() + 13 * 60 * 60 * 1000;
  t.mock.method(Date, 'now', () => future);
  assert.equal((await req('/api/state', 'GET', undefined, cookie)).status, 401);
  let timer;
  const closed = await Promise.race([
    (async () => {
      while (!(await reader.read()).done) {}
      return true;
    })(),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), 500);
    }),
  ]);
  clearTimeout(timer);
  assert.equal(closed, true, 'expired SSE stream must close');
});

test('card positions are finite numeric ordering values; canvas coordinates are rejected', async (t) => {
  const { req, login } = await setup(t);
  const cookie = await login();
  const project = (await req('/api/projects', 'POST', { name: '순서' }, cookie))
    .data;
  const path = `/api/projects/${project.id}/cards`;
  const created = await req(
    path,
    'POST',
    { stage: 'events', kind: 'event', title: '이벤트', position: 4 },
    cookie,
  );
  assert.equal(created.status, 201);
  assert.equal(created.data.position, 4);
  const updated = await req(
    `/api/cards/${created.data.id}`,
    'PATCH',
    { revision: 1, position: 2.5 },
    cookie,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.data.position, 2.5);
  const defaultCard = (
    await req(
      path,
      'POST',
      { stage: 'events', kind: 'command', title: '명령' },
      cookie,
    )
  ).data;
  assert.equal(defaultCard.position, 0);
  for (const position of [{ x: 2, y: 3 }, null, '4', 1000001])
    assert.equal(
      (
        await req(
          path,
          'POST',
          { stage: 'events', kind: 'event', title: '거부', position },
          cookie,
        )
      ).status,
      400,
    );
  const state = (await req('/api/state', 'GET', undefined, cookie)).data;
  for (const card of state.cards) assert.equal(typeof card.position, 'number');
});

test('markdown export follows numeric card positions with stable ID tie breaking', async (t) => {
  const { req, login } = await setup(t);
  const cookie = await login();
  const project = (
    await req('/api/projects', 'POST', { name: '내보내기 순서' }, cookie)
  ).data;
  await req(
    `/api/projects/${project.id}/cards`,
    'POST',
    { stage: 'events', kind: 'event', title: '둘째 항목', position: 2 },
    cookie,
  );
  await req(
    `/api/projects/${project.id}/cards`,
    'POST',
    { stage: 'events', kind: 'event', title: '첫째 항목', position: 1 },
    cookie,
  );
  const exported = (
    await req(
      `/api/projects/${project.id}/export?format=markdown`,
      'GET',
      undefined,
      cookie,
    )
  ).data;
  assert.ok(exported.indexOf('첫째 항목') < exported.indexOf('둘째 항목'));
});

test('atomic moves resolve tied positions, preserve unrelated cards and reject stale revisions', async (t) => {
  const { req, login } = await setup(t);
  const cookie = await login();
  const project = (
    await req('/api/projects', 'POST', { name: '이동 순서' }, cookie)
  ).data;
  const cards = [];
  for (const title of ['동점 가', '동점 나', '동점 다'])
    cards.push(
      (
        await req(
          `/api/projects/${project.id}/cards`,
          'POST',
          { stage: 'events', kind: 'event', title, position: 0 },
          cookie,
        )
      ).data,
    );
  const command = (
    await req(
      `/api/projects/${project.id}/cards`,
      'POST',
      { stage: 'events', kind: 'command', title: '다른 종류', position: 0 },
      cookie,
    )
  ).data;
  const ordered = cards.toSorted(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const moved = await req(
    `/api/cards/${ordered[0].id}/move`,
    'POST',
    { revision: 1, direction: 1 },
    cookie,
  );
  assert.equal(moved.status, 200);
  assert.deepEqual(
    moved.data.cards.map((c) => c.id),
    [ordered[1].id, ordered[0].id, ordered[2].id],
  );
  assert.deepEqual(
    moved.data.cards.map((c) => c.position),
    [0, 1, 2],
  );
  assert.deepEqual(
    moved.data.cards.map((c) => c.revision),
    [1, 2, 2],
  );
  assert.equal(moved.data.cards[1].updatedBy, '지민');
  const stale = await req(
    `/api/cards/${ordered[0].id}/move`,
    'POST',
    { revision: 1, direction: -1 },
    cookie,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.data.current.position, 1);
  assert.equal(
    (
      await req(
        `/api/cards/${ordered[2].id}`,
        'PATCH',
        { title: '낡은 제목', revision: 1 },
        cookie,
      )
    ).status,
    409,
  );
  const boundary = await req(
    `/api/cards/${ordered[1].id}/move`,
    'POST',
    { revision: 1, direction: -1 },
    cookie,
  );
  assert.equal(boundary.status, 200);
  assert.deepEqual(boundary.data.cards, moved.data.cards);
  const state = (await req('/api/state', 'GET', undefined, cookie)).data;
  assert.deepEqual(
    state.cards.find((c) => c.id === command.id),
    command,
  );
  const markdown = (
    await req(
      `/api/projects/${project.id}/export?format=markdown`,
      'GET',
      undefined,
      cookie,
    )
  ).data;
  const [first, second, third] = moved.data.cards.map((c) =>
    markdown.indexOf(c.title),
  );
  assert.ok(first < second && second < third);
  assert.equal(
    (
      await req(`/api/cards/${ordered[0].id}/move`, 'POST', {
        revision: 2,
        direction: 1,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await req(
        `/api/cards/${ordered[0].id}/move`,
        'POST',
        { revision: 2, direction: 1 },
        cookie,
        { origin: 'https://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        `/api/cards/${ordered[0].id}/move`,
        'POST',
        { revision: 2, direction: 0 },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        `/api/cards/${ordered[0].id}/move`,
        'POST',
        { direction: 1 },
        cookie,
      )
    ).status,
    400,
  );
});
