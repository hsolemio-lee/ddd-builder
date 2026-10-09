import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';
import { reviewBoard } from '../shared/design.mjs';
import { layoutFlow } from '../shared/flow.mjs';
import { buildContextMap, layoutContextMap } from '../shared/context-map.mjs';
async function setup(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-design-'));
  const app = await createApp({ dataDir, code: 'design-tests' });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '설계 검토자', code: 'design-tests' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const req = async (path, method = 'GET', data) => {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return {
      status: r.status,
      data: r.headers.get('content-type')?.includes('application/json')
        ? await r.json()
        : await r.text(),
    };
  };
  const project = (await req('/projects', 'POST', { name: '독립 설계 테스트' }))
    .data;
  const create = async (kind, title, extra = {}) => {
    const r = await req(`/projects/${project.id}/cards`, 'POST', {
      stage: 'events',
      kind,
      title,
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
  };
  return { req, project, create };
}
test('existing JSON cards load safely without rewriting or claiming agreement', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ddd-legacy-design-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let store = openStore(dir);
  const old = store.state().cards[0];
  delete old.status;
  delete old.decision;
  delete old.links;
  delete old.scenario;
  store.saveCard(old);
  store.close();
  store = openStore(dir);
  const card = store.card(old.id);
  assert.equal(card.status, 'proposed');
  assert.deepEqual(card.links, []);
  assert.equal(card.revision, old.revision);
  assert.equal(card.description, old.description);
  store.close();
});
test('links enforce ownership, direction and revisions; deleting a target cleans references', async (t) => {
  const { req, project, create } = await setup(t);
  const event = await create('event', '주문이 접수되었다');
  let command = await create('command', '주문 접수', {
    links: [{ kind: 'flow', targetId: event.id }],
  });
  const other = (await req('/projects', 'POST', { name: '다른 프로젝트' }))
    .data;
  const outside = (
    await req(`/projects/${other.id}/cards`, 'POST', {
      stage: 'events',
      kind: 'event',
      title: '외부 사건',
    })
  ).data;
  for (const links of [
    [{ kind: 'flow', targetId: outside.id }],
    [{ kind: 'related', targetId: command.id }],
    [
      { kind: 'flow', targetId: event.id },
      { kind: 'flow', targetId: event.id },
    ],
    [{ kind: 'related', targetId: 'missing' }],
  ])
    assert.equal(
      (
        await req(`/cards/${command.id}`, 'PATCH', {
          revision: command.revision,
          links,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await req(`/cards/${event.id}`, 'PATCH', {
        revision: 1,
        links: [{ kind: 'flow', targetId: command.id }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await req(`/cards/${event.id}`, 'PATCH', { revision: 1, kind: 'command' }))
      .status,
    400,
  );
  command = (
    await req(`/cards/${command.id}`, 'PATCH', {
      revision: 1,
      status: 'agreed',
      decision: '주문 담당자 민지와 결과 확인',
    })
  ).data;
  assert.equal(
    (await req(`/cards/${event.id}`, 'DELETE', { revision: 1 })).status,
    200,
  );
  const current = (await req('/state')).data.cards.find(
    (c) => c.id === command.id,
  );
  assert.deepEqual(current.links, []);
  assert.equal(current.status, 'proposed');
  assert.equal(current.revision, command.revision + 1);
  assert.equal(
    (
      await req(`/cards/${command.id}`, 'PATCH', {
        revision: command.revision,
        title: '낡은 수정',
      })
    ).status,
    409,
  );
  assert.equal((await req(`/projects/${project.id}/review`)).status, 200);
});
test('agreement needs evidence and implicit semantic changes require review again', async (t) => {
  const { req, create } = await setup(t);
  let card = await create('event', '결제가 승인되었다');
  assert.equal(
    (await req(`/cards/${card.id}`, 'PATCH', { revision: 1, status: 'agreed' }))
      .status,
    400,
  );
  card = (
    await req(`/cards/${card.id}`, 'PATCH', {
      revision: 1,
      status: 'agreed',
      decision: '결제 담당자와 승인·수납 의미 확인',
      scenario: 'main',
    })
  ).data;
  assert.equal(card.status, 'agreed');
  card = (
    await req(`/cards/${card.id}`, 'PATCH', {
      revision: card.revision,
      position: 20,
    })
  ).data;
  assert.equal(card.status, 'agreed');
  card = (
    await req(`/cards/${card.id}`, 'PATCH', {
      revision: card.revision,
      description: '승인의 새로운 의미',
    })
  ).data;
  assert.equal(card.status, 'proposed');
  assert.equal(card.scenario, 'main');
  assert.ok(card.decision);
});
test('context relations preserve text and Mermaid sources in persisted and exported designs', async (t) => {
  const { req, project } = await setup(t);
  let card = (
    await req(`/projects/${project.id}/cards`, 'POST', {
      stage: 'contexts',
      kind: 'context',
      title: '주문',
      data: { relationships: '결제에 요청' },
    })
  ).data;
  assert.equal(card.data.relationshipFormat, 'text');
  const source = 'flowchart LR\n  O["주문 ` 원문"] --> P[결제]';
  card = (
    await req(`/cards/${card.id}`, 'PATCH', {
      revision: card.revision,
      data: {
        relationships: '결제에 요청',
        relationshipDiagram: source,
        relationshipFormat: 'mermaid',
      },
    })
  ).data;
  assert.equal(card.data.relationshipDiagram, source);
  assert.equal(card.data.relationships, '결제에 요청');
  const md = (await req(`/projects/${project.id}/export?format=markdown`)).data;
  assert.ok(md.includes('```mermaid\n' + source + '\n```'));
  assert.ok(md.includes('검토 상태: 제안'));
  assert.equal(
    (
      await req(`/cards/${card.id}`, 'PATCH', {
        revision: card.revision,
        data: { relationships: source, relationshipFormat: 'html' },
      })
    ).status,
    400,
  );
  const restored = (await req('/state')).data.cards.find(
    (c) => c.id === card.id,
  );
  assert.deepEqual(restored.data, card.data);
});
test('review distinguishes unresolved flows from valid same terms in different contexts', () => {
  const c = (id, kind, extra = {}) => ({
    id,
    projectId: 'p',
    stage: 'events',
    kind,
    title: kind,
    description: '',
    data: {},
    status: 'proposed',
    links: [],
    ...extra,
  });
  const cards = [
    c('e', 'event'),
    c('cmd', 'command', { links: [{ kind: 'flow', targetId: 'e' }] }),
    c('policy', 'policy', { links: [{ kind: 'flow', targetId: 'cmd' }] }),
    c('agg', 'aggregate', {
      stage: 'aggregates',
      data: { root: '', invariants: '' },
    }),
    c('a', 'event', { contextId: 'one', title: '접수' }),
    c('b', 'event', { contextId: 'two', title: '접수' }),
  ];
  let result = reviewBoard(cards);
  assert.ok(result.issues.some((i) => i.code === 'policy-flow'));
  assert.ok(result.issues.some((i) => i.code === 'aggregate-root'));
  assert.ok(!result.issues.some((i) => i.code === 'duplicate-title'));
  cards[0].links = [{ kind: 'flow', targetId: 'policy' }];
  result = reviewBoard(cards);
  assert.ok(
    !result.issues.some((i) =>
      ['policy-flow', 'command-result'].includes(i.code),
    ),
  );
  assert.ok(result.note.includes('도메인 담당자'));
  assert.ok(!('score' in result));
});
test('flow layout supports retry loops and ignores targets outside the filtered graph', () => {
  const cards = [
    {
      id: 'c',
      stage: 'events',
      position: 0,
      links: [{ kind: 'flow', targetId: 'e' }],
    },
    {
      id: 'e',
      stage: 'events',
      position: 1,
      links: [{ kind: 'flow', targetId: 'p' }],
    },
    {
      id: 'p',
      stage: 'events',
      position: 2,
      links: [
        { kind: 'flow', targetId: 'c' },
        { kind: 'related', targetId: 'elsewhere' },
      ],
    },
  ];
  const graph = layoutFlow(cards);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 3);
  assert.equal(graph.edges.filter((e) => e.feedback).length, 1);
  assert.ok(
    graph.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
  );
  const filtered = layoutFlow(cards.slice(0, 2));
  assert.equal(filtered.edges.length, 1);
  assert.equal(filtered.nodes.length, 2);
});

test('context regions preserve ownership, empty boundaries and directional cross-boundary flows', () => {
  const contexts = ['주문', '결제', '재고', '배송'].map((title, i) => ({
    id: 'c' + i,
    title,
    kind: 'context',
    stage: 'contexts',
    position: i,
    links: [],
  }));
  contexts[0].links = [{ kind: 'related', targetId: 'c1' }];
  const members = [
    {
      id: 'a',
      stage: 'events',
      kind: 'command',
      contextId: 'c0',
      position: 1,
      links: [
        { kind: 'flow', targetId: 'b' },
        { kind: 'related', targetId: 'stock' },
      ],
    },
    {
      id: 'b',
      stage: 'events',
      kind: 'event',
      contextId: 'c1',
      position: 2,
      links: [{ kind: 'flow', targetId: 'a' }],
    },
    {
      id: 'local',
      stage: 'events',
      kind: 'event',
      contextId: 'c0',
      position: 3,
      links: [{ kind: 'flow', targetId: 'a' }],
    },
    {
      id: 'aggregate',
      stage: 'aggregates',
      kind: 'aggregate',
      contextId: 'c0',
      position: 4,
      links: [],
    },
    {
      id: 'stock',
      stage: 'events',
      kind: 'event',
      contextId: 'c2',
      position: 5,
      links: [],
    },
    {
      id: 'unknown',
      stage: 'events',
      kind: 'question',
      contextId: 'deleted',
      position: 6,
      links: [],
    },
    {
      id: 'unassigned',
      stage: 'events',
      kind: 'question',
      contextId: null,
      position: 7,
      links: [],
    },
  ];
  const map = buildContextMap(contexts, members);
  assert.equal(map.groups.length, 4);
  assert.deepEqual(
    map.groups[0].members.map((c) => c.id),
    ['a', 'local', 'aggregate'],
  );
  assert.equal(map.groups[3].members.length, 0);
  assert.deepEqual(
    map.unassigned.map((c) => c.id),
    ['unknown', 'unassigned'],
  );
  assert.equal(map.connections.length, 1);
  assert.equal(map.connections[0].forward.declared, true);
  assert.deepEqual(map.connections[0].forward.flows, [
    { source: 'a', target: 'b' },
  ]);
  assert.deepEqual(map.connections[0].reverse.flows, [
    { source: 'b', target: 'a' },
  ]);
  const filtered = buildContextMap(
    contexts,
    members.filter((c) => c.id !== 'b'),
  );
  assert.equal(filtered.groups.length, 4);
  assert.equal(filtered.connections[0].forward.flows.length, 0);
  assert.equal(filtered.connections[0].forward.declared, true);
  const layout = layoutContextMap(map.groups, map.connections);
  assert.equal(layout.nodes.length, 4);
  for (const node of layout.nodes) {
    assert.ok(node.x + 320 <= layout.width);
    assert.ok(node.y + 248 <= layout.height);
  }
  assert.equal(layout.edges.length, 1);
  assert.equal(layoutContextMap([], []).edges.length, 0);
});

test('context layout adapts to width and routes relationships around ownership regions', () => {
  const groups = Array.from({ length: 6 }, (_, i) => ({
    context: { id: `c${i}` },
    members: [],
  }));
  const lane = { flows: [], declared: true };
  const connections = [
    { id: 'near', source: 'c0', target: 'c1', forward: lane, reverse: lane },
    { id: 'far', source: 'c0', target: 'c5', forward: lane, reverse: lane },
    { id: 'middle', source: 'c1', target: 'c4', forward: lane, reverse: lane },
  ];
  const snapshot = structuredClone({ groups, connections });
  const wide = layoutContextMap(groups, connections, { width: 1600 });
  const narrow = layoutContextMap(groups, connections, { width: 700 });
  assert.ok(wide.width > narrow.width);
  assert.ok(wide.height < narrow.height);
  function verify(layout) {
    assert.equal(layout.edges.length, connections.length);
    for (const edge of layout.edges) {
      const numbers = edge.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const points = Array.from({ length: numbers.length / 2 }, (_, i) => ({
        x: numbers[i * 2],
        y: numbers[i * 2 + 1],
      }));
      assert.ok(
        points.every(
          (p) =>
            p.x >= 0 && p.y >= 0 && p.x <= layout.width && p.y <= layout.height,
        ),
      );
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        assert.ok(a.x === b.x || a.y === b.y);
        for (const node of layout.nodes) {
          const intersects =
            a.x === b.x
              ? a.x > node.x &&
                a.x < node.x + 320 &&
                Math.max(a.y, b.y) > node.y &&
                Math.min(a.y, b.y) < node.y + 248
              : a.y > node.y &&
                a.y < node.y + 248 &&
                Math.max(a.x, b.x) > node.x &&
                Math.min(a.x, b.x) < node.x + 320;
          assert.equal(intersects, false, `${edge.id} crosses ${node.id}`);
        }
      }
    }
  }
  verify(wide);
  verify(narrow);
  const moved = layoutContextMap(groups, connections, {
    width: 1600,
    positions: { c0: { x: 1480, y: 900 } },
  });
  assert.deepEqual(
    moved.nodes.find((n) => n.id === 'c0'),
    { id: 'c0', x: 1480, y: 900 },
  );
  verify(moved);
  assert.deepEqual({ groups, connections }, snapshot);
});

test('flow layout aligns separate stories and routes return edges outside the cards', () => {
  const card = (id, position, target) => ({
    id,
    position,
    stage: 'events',
    links: target ? [{ kind: 'flow', targetId: target }] : [],
  });
  const cards = [
    card('a', 0, 'b'),
    card('d', 1),
    card('c', 2, 'd'),
    card('b', 3, 'a'),
  ];
  const snapshot = structuredClone(cards);
  const graph = layoutFlow(cards, { direction: 'horizontal' });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('a').y, byId.get('b').y);
  assert.equal(byId.get('c').y, byId.get('d').y);
  assert.notEqual(byId.get('a').y, byId.get('c').y);
  assert.ok(byId.get('a').x < byId.get('b').x);
  assert.ok(byId.get('c').x < byId.get('d').x);
  const feedback = graph.edges.find((e) => e.feedback);
  assert.ok(feedback.path.includes('L'));
  assert.ok(
    graph.edges.every(
      (e) => !e.path.includes('NaN') && !e.path.includes('undefined'),
    ),
  );
  assert.deepEqual(cards, snapshot);
});

test('flow direction can change without losing branches or return edges', () => {
  const cards = Array.from({ length: 6 }, (_, i) => ({
    id: `n${i}`,
    stage: 'events',
    position: i,
    links: [{ kind: 'flow', targetId: `n${(i + 1) % 6}` }],
  }));
  const horizontal = layoutFlow(cards, { direction: 'horizontal' });
  const vertical = layoutFlow(cards, { direction: 'vertical' });
  assert.equal(horizontal.direction, 'horizontal');
  assert.equal(vertical.direction, 'vertical');
  assert.ok(horizontal.width > vertical.width);
  assert.ok(horizontal.height < vertical.height);
  assert.deepEqual(
    horizontal.edges.map(({ source, target, feedback }) => ({
      source,
      target,
      feedback,
    })),
    vertical.edges.map(({ source, target, feedback }) => ({
      source,
      target,
      feedback,
    })),
  );
  assert.equal(layoutFlow(cards, { width: 390 }).direction, 'vertical');
});
