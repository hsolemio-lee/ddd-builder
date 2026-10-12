import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.mjs';

async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-event-order-'));
  const app = await createApp({ dataDir, code: 'event-order-test' });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(url + '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '순서 검증', code: 'event-order-test' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  async function request(path, method = 'GET', body) {
    const response = await fetch(url + '/api' + path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  }
  const project = (await request('/projects', 'POST', { name: '사건 순서' }))
    .value;
  const cards = async () =>
    (await request('/state')).value.cards.filter(
      (c) => c.projectId === project.id,
    );
  const event = async (title, position, fields = {}) =>
    (
      await request(`/projects/${project.id}/cards`, 'POST', {
        stage: 'events',
        kind: 'event',
        title,
        position,
        ...fields,
      })
    ).value;
  const order = (cards) =>
    request(`/projects/${project.id}/event-order`, 'POST', {
      cards: cards.map(({ id, revision }) => ({ id, revision })),
    });
  const insert = (title, placement, extra = {}) =>
    request(`/projects/${project.id}/cards`, 'POST', {
      stage: 'events',
      kind: 'event',
      title,
      placement,
      ...extra,
    });
  return { request, project, cards, event, order, insert };
}

test('event reorder preserves links, agreement, IDs and non-event positions', async (t) => {
  const s = await setup(t);
  const b = await s.event('결과가 확인됨', 1, {
    status: 'agreed',
    decision: '검토 기록',
  });
  const a = await s.event('요청이 접수됨', 0, {
    status: 'agreed',
    decision: '검토 기록',
    links: [{ kind: 'flow', targetId: b.id }],
  });
  const command = (
    await s.request(`/projects/${s.project.id}/cards`, 'POST', {
      stage: 'events',
      kind: 'command',
      title: '요청 확인',
      position: 100,
    })
  ).value;
  const result = await s.order([b, a]);
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.value.cards.map((c) => c.id),
    [b.id, a.id],
  );
  assert.deepEqual(
    result.value.cards.map((c) => c.position),
    [0, 1],
  );
  const saved = await s.cards();
  assert.equal(saved.find((c) => c.id === a.id).status, 'agreed');
  assert.deepEqual(saved.find((c) => c.id === a.id).links, a.links);
  assert.deepEqual(
    saved.find((c) => c.id === command.id),
    command,
  );
});

test('stale revisions and added events reject reorders without partial writes', async (t) => {
  const s = await setup(t);
  const a = await s.event('사건 A', 0),
    b = await s.event('사건 B', 1);
  await s.request(`/cards/${b.id}`, 'PATCH', {
    revision: b.revision,
    description: '동료 변경',
  });
  const before = await s.cards();
  assert.equal((await s.order([b, a])).status, 409);
  assert.deepEqual(await s.cards(), before);
  const stale = await s.cards();
  await s.event('추가 사건', 2);
  const afterAdd = await s.cards();
  assert.equal((await s.order(stale)).status, 409);
  assert.deepEqual(await s.cards(), afterAdd);
});

test('missing, duplicate and foreign IDs cannot reorder the event set', async (t) => {
  const s = await setup(t);
  const a = await s.event('A', 0),
    b = await s.event('B', 1);
  const other = (
    await s.request('/projects', 'POST', { name: '다른 프로젝트' })
  ).value;
  const foreign = (
    await s.request(`/projects/${other.id}/cards`, 'POST', {
      stage: 'events',
      kind: 'event',
      title: '외부 사건',
    })
  ).value;
  const before = await s.cards();
  for (const values of [[a], [a, a], [a, foreign]])
    assert.equal((await s.order(values)).status, 409);
  assert.deepEqual(await s.cards(), before);
  assert.equal((await s.order([b, { ...a, revision: undefined }])).status, 400);
  assert.deepEqual(await s.cards(), before);
});

test('before, after and end insertion save the ordered events without inventing flow links', async (t) => {
  const s = await setup(t);
  const a = await s.event('기준 사건', 0),
    b = await s.event('마지막 사건', 1);
  await s.request(`/cards/${a.id}`, 'PATCH', {
    revision: a.revision,
    links: [{ kind: 'flow', targetId: b.id }],
  });
  let anchor = (await s.cards()).find((c) => c.id === a.id);
  assert.equal(
    (
      await s.insert('앞 사건', {
        anchorId: a.id,
        anchorRevision: anchor.revision,
        side: 'before',
      })
    ).status,
    201,
  );
  anchor = (await s.cards()).find((c) => c.id === a.id);
  assert.equal(
    (
      await s.insert('뒤 사건', {
        anchorId: a.id,
        anchorRevision: anchor.revision,
        side: 'after',
      })
    ).status,
    201,
  );
  assert.equal((await s.insert('끝 사건', { side: 'end' })).status, 201);
  const events = (await s.cards()).sort((x, y) => x.position - y.position);
  assert.deepEqual(
    events.map((c) => c.title),
    ['앞 사건', '기준 사건', '뒤 사건', '마지막 사건', '끝 사건'],
  );
  assert.deepEqual(events.find((c) => c.id === a.id).links, [
    { kind: 'flow', targetId: b.id },
  ]);
  assert.ok(
    events.filter((c) => c.id !== a.id).every((c) => c.links.length === 0),
  );
  assert.ok(events.every((c) => !Object.hasOwn(c, 'placement')));
});

test('deleted or edited anchors reject insertion and preserve the current board', async (t) => {
  const s = await setup(t);
  const a = await s.event('기준', 0);
  await s.request(`/cards/${a.id}`, 'PATCH', {
    revision: a.revision,
    title: '수정 기준',
  });
  const before = await s.cards();
  assert.equal(
    (
      await s.insert('새 초안', {
        anchorId: a.id,
        anchorRevision: a.revision,
        side: 'after',
      })
    ).status,
    409,
  );
  assert.deepEqual(await s.cards(), before);
  await s.request(`/cards/${a.id}`, 'DELETE', { revision: before[0].revision });
  assert.equal(
    (
      await s.insert('새 초안', {
        anchorId: a.id,
        anchorRevision: before[0].revision,
        side: 'after',
      })
    ).status,
    409,
  );
  assert.deepEqual(await s.cards(), []);
});

test('placement validates event kind, project ownership and envelope shape', async (t) => {
  const s = await setup(t);
  const a = await s.event('기준', 0);
  for (const placement of [
    null,
    { side: 'sideways' },
    { side: 'end', anchorId: a.id },
    { side: 'before', anchorId: a.id, anchorRevision: 0 },
  ])
    assert.equal((await s.insert('거절할 사건', placement)).status, 400);
  assert.equal(
    (await s.insert('명령', { side: 'end' }, { kind: 'command' })).status,
    400,
  );
  assert.equal(
    (
      await s.insert('거절할 사건', {
        side: 'before',
        anchorId: 'foreign-event',
        anchorRevision: 1,
      })
    ).status,
    409,
  );
  assert.equal((await s.cards()).length, 1);
});
