import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDomainDocuments } from '../shared/documents.mjs';
import { documentArchive } from '../server/document-archive.mjs';
import {
  patchAggregateDesign,
  aggregateReview,
  removeAggregateReference,
} from '../shared/aggregate.mjs';
import { createApp } from '../server/app.mjs';

const project = {
  id: 'p1',
  name: '생산계획',
  description: '계획의 일관성 유지',
  revision: 3,
  updatedAt: '2026-10-09T00:00:00Z',
};
const card = (id, kind, more = {}) => ({
  id,
  projectId: project.id,
  kind,
  stage:
    kind === 'context'
      ? 'contexts'
      : kind === 'term'
        ? 'discovery'
        : kind === 'aggregate'
          ? 'aggregates'
          : 'events',
  title: id,
  description: '',
  data: {},
  contextId: null,
  links: [],
  status: 'proposed',
  decision: '',
  scenario: 'shared',
  position: 0,
  revision: 1,
  updatedAt: project.updatedAt,
  updatedBy: '업무 담당자',
  ...more,
});
const file = (bundle, suffix) =>
  bundle.files.find((f) => f.path.endsWith(suffix));

// Read the central directory as an independent consumer of the ZIP layout.
function unzipStored(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  let cursor = buffer.readUInt32LE(end + 16);
  const files = [];
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    assert.equal(buffer.readUInt16LE(cursor + 10), 0);
    assert.equal(buffer.readUInt16LE(cursor + 8), 0x800);
    const size = buffer.readUInt32LE(cursor + 24),
      length = buffer.readUInt16LE(cursor + 28);
    const offset = buffer.readUInt32LE(cursor + 42);
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    const start =
      offset +
      30 +
      buffer.readUInt16LE(offset + 26) +
      buffer.readUInt16LE(offset + 28);
    files.push({
      path: buffer.subarray(cursor + 46, cursor + 46 + length).toString('utf8'),
      content: buffer.subarray(start, start + size).toString('utf8'),
    });
    cursor +=
      46 +
      length +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
  }
  return files;
}

test('domain projection keeps context meanings, IDs, statuses and incomplete policy without inferring membership', () => {
  const cards = [
    card('c1', 'context', {
      title: '계획',
      data: {
        purpose: '계획 수립',
        outOfScope: '실적 집계',
        integrationContract: '계획 → 실행: 계획확정됨 v1 전달',
      },
    }),
    card('c2', 'context', { title: '계획' }),
    card('term1', 'term', {
      title: '수량',
      contextId: 'c1',
      description: '예정 수량',
      data: { codeName: 'PlannedQuantity', distinction: '실적 수량과 구분' },
    }),
    card('term2', 'term', {
      title: '수량',
      contextId: 'c2',
      description: '실적 수량',
    }),
    card('global', 'term', {
      title: '계획의 공통 용어',
      description: '소속 미결정',
    }),
    card('cmd', 'command', { contextId: 'c1', title: '계획 수량 변경' }),
    card('agg', 'aggregate', {
      contextId: 'c1',
      title: 'ProductionPlan',
      status: 'agreed',
      decision: '기본 경계 합의',
      data: {
        root: 'ProductionPlan',
        transactionBoundary: 'PlanLine과 함께 저장',
        invariants: '기존 규칙 설명',
      },
      aggregateDesign: {
        commandIds: ['cmd'],
        coordination: '',
        externalReferences: [],
        rules: [
          {
            id: 'PLAN-001',
            statement: '확정 계획 수량 직접 변경 금지',
            status: 'proposed',
            scope: '계획 수량',
            condition: 'CONFIRMED',
            violation: '거절, 기존 상태 유지',
            unresolved: '확정 취소 후 수정?',
            commandIds: ['cmd'],
            examples: [
              {
                id: 'CASE-1',
                title: '변경 거절',
                type: 'rejection',
                given: 'CONFIRMED, 수량 100',
                when: '120으로 변경',
                then: '100과 CONFIRMED 유지',
                testReferences: 'tests/plan.test.ts',
              },
            ],
          },
        ],
      },
    }),
    card('foreign', 'term', {
      projectId: 'other',
      contextId: 'c1',
      description: '다른 프로젝트 비밀',
    }),
  ];
  const before = JSON.stringify(cards),
    bundle = buildDomainDocuments(project, cards);
  assert.equal(JSON.stringify(cards), before);
  assert.deepEqual(bundle, buildDomainDocuments(project, [...cards].reverse()));
  assert.match(file(bundle, 'context-c1/glossary.md').content, /예정 수량/);
  assert.doesNotMatch(
    file(bundle, 'context-c1/glossary.md').content,
    /실적 수량\n|소속 미결정/,
  );
  assert.match(file(bundle, 'context-c2/glossary.md').content, /실적 수량/);
  assert.match(file(bundle, 'unassigned.md').content, /소속 미결정/);
  const rules = file(bundle, 'context-c1/rules.md').content;
  assert.match(rules, /PLAN-001/);
  assert.match(rules, /규칙 상태: 제안/);
  assert.match(rules, /CONFIRMED/);
  assert.match(rules, /기존 규칙 설명/);
  assert.match(rules, /확정 취소 후 수정/);
  assert.match(rules, /미작성/);
  assert.match(file(bundle, 'context-c1/scenarios.md').content, /CASE-1/);
  assert.match(
    file(bundle, 'context-c1/scenarios.md').content,
    /tests\/plan.test.ts/,
  );
  assert.match(
    file(bundle, 'context-c1/aggregates.md').content,
    /PlanLine과 함께 저장/,
  );
  assert.ok(!JSON.stringify(bundle).includes('다른 프로젝트 비밀'));
  assert.match(file(bundle, 'docs/adr/index.md').content, /ADR: 미작성/);
  assert.equal(
    JSON.parse(file(bundle, 'document-data.json').content).cards.length,
    cards.length - 1,
  );
  const scoped = buildDomainDocuments(project, cards, { contextId: 'c1' });
  assert.ok(
    !scoped.files.some(
      (f) => f.path.includes('context-c2') || f.path.endsWith('unassigned.md'),
    ),
  );
  assert.ok(
    JSON.parse(file(scoped, 'document-data.json').content).cards.every(
      (c) => c.id === 'c1' || c.contextId === 'c1',
    ),
  );
  assert.throws(
    () => buildDomainDocuments(project, cards, { contextId: 'missing' }),
    { status: 404 },
  );
  const renamed = cards.map((c) =>
    c.id === 'c1' ? { ...c, title: '새 이름' } : c,
  );
  assert.deepEqual(
    buildDomainDocuments(project, renamed).files.map((f) => f.path),
    bundle.files.map((f) => f.path),
  );
});

test('generated paths and Markdown remain safe for duplicate or hostile names', () => {
  const ctx = card('../outside', 'context', {
    title: '[evil](https://example.com) <script>bad</script>\n# injected',
  });
  const bundle = buildDomainDocuments(project, [ctx]);
  assert.ok(
    bundle.files.every(
      (f) => !f.path.includes('..') && !f.path.startsWith('/'),
    ),
  );
  assert.ok(
    bundle.files.every((f) => f.path.split('/').every((p) => p.length <= 255)),
  );
  assert.ok(
    !file(bundle, 'index.md').content.includes('[evil](https://example.com)'),
  );
  assert.ok(!file(bundle, 'index.md').content.includes('<script>'));
  assert.match(file(bundle, 'index.md').content, /\\# injected/);
});

test('ZIP preserves UTF-8 document content, valid CRC and reproducible paths', () => {
  const files = buildDomainDocuments(project, [card('c1', 'context')]).files;
  const archive = documentArchive(files);
  assert.deepEqual(
    unzipStored(archive),
    files.map(({ path, content }) => ({ path, content })),
  );
  assert.deepEqual(archive, documentArchive(files));
  assert.equal(
    documentArchive([{ path: '한글.md', content: '123456789' }]).readUInt32LE(
      14,
    ),
    0xcbf43926,
  );
  assert.deepEqual(
    unzipStored(documentArchive([{ path: '한글.md', content: '한글 본문' }])),
    [{ path: '한글.md', content: '한글 본문' }],
  );
});

test('document API validates new fields, filters contexts, serves single files and matches ZIP without modifying cards', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-documents-'));
  const app = await createApp({ dataDir, code: 'documents-code' });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'documents-code', name: '문서 검토자' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const req = async (path, method = 'GET', body) => {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const p = (await req('/projects', 'POST', { name: '생산계획 문서' })).data;
  const create = async (args) => {
    const result = await req(`/projects/${p.id}/cards`, 'POST', args);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  };
  const ctx = await create({
    stage: 'contexts',
    kind: 'context',
    title: '생산계획',
    data: {
      purpose: '계획 수립',
      outOfScope: '실적 집계',
      integrationContract: '실행에 계획확정됨 v1 전달',
    },
  });
  const term = await create({
    stage: 'discovery',
    kind: 'term',
    title: '생산계획',
    contextId: ctx.id,
    description: '예정 생산 수량',
    data: {
      codeName: 'ProductionPlan',
      distinction: '작업지시와 구분',
      source: '업무 담당자',
      confusedWith: '작업지시',
    },
  });
  const command = await create({
    stage: 'events',
    kind: 'command',
    title: '수량 변경',
    contextId: ctx.id,
  });
  const aggregate = await create({
    stage: 'aggregates',
    kind: 'aggregate',
    title: '계획',
    contextId: ctx.id,
    data: {
      root: 'ProductionPlan',
      stateTransitions: 'DRAFT → CONFIRMED',
      transactionBoundary: '계획과 항목',
    },
    aggregateDesign: {
      commandIds: [command.id],
      rules: [
        {
          id: 'PLAN-001',
          statement: '직접 변경 금지',
          status: 'proposed',
          condition: 'CONFIRMED',
          violation: '수량 유지',
          exceptions: '변경안 생성',
          unresolved: '확정 취소?',
          source: '운영 지침',
          commandIds: [command.id],
          examples: [
            {
              id: 'b1',
              title: '경계값',
              type: 'boundary',
              given: '수량 0',
              when: '확정',
              then: '거절',
              testReferences: 'tests/plan.test.ts',
            },
          ],
        },
      ],
    },
  });
  assert.equal(
    (
      await req(`/projects/${p.id}/cards`, 'POST', {
        stage: 'events',
        kind: 'event',
        title: '잘못된 상세',
        data: { codeName: 'Wrong' },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await req(`/cards/${term.id}`, 'PATCH', {
        revision: term.revision,
        data: { source: 'x'.repeat(20001) },
      })
    ).status,
    400,
  );
  const snapshot = (await req('/state')).data;
  const bundle = (await req(`/projects/${p.id}/documents`)).data;
  assert.deepEqual(bundle, buildDomainDocuments(p, snapshot.cards));
  const selected = (
    await req(
      `/projects/${p.id}/documents?contextId=${ctx.id}&path=${encodeURIComponent(`docs/domain/context-${ctx.id}/rules.md`)}`,
    )
  ).data;
  assert.equal(selected.files.length, 1);
  assert.match(selected.files[0].content, /PLAN-001/);
  assert.equal(
    (await req(`/projects/${p.id}/documents?contextId=missing`)).status,
    404,
  );
  assert.equal(
    (await req(`/projects/${p.id}/documents?path=../../server/app.mjs`)).status,
    404,
  );
  assert.equal(
    (await fetch(`${base}/api/projects/${p.id}/documents`)).status,
    401,
  );
  assert.equal(
    (await fetch(`${base}/api/projects/${p.id}/export?format=documents`))
      .status,
    401,
  );
  const response = await fetch(
    `${base}/api/projects/${p.id}/export?format=documents&contextId=${ctx.id}`,
    { headers: { cookie } },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  const archived = unzipStored(Buffer.from(await response.arrayBuffer()));
  const scoped = buildDomainDocuments(p, snapshot.cards, { contextId: ctx.id });
  assert.deepEqual(
    archived,
    scoped.files.map(({ path, content }) => ({ path, content })),
  );
  assert.deepEqual((await req('/state')).data, snapshot);
  const patch = await req(`/cards/${aggregate.id}/aggregate-design`, 'PATCH', {
    revision: aggregate.revision,
    upsertRules: [
      {
        id: 'PLAN-001',
        violation: '요청 거절과 수량 유지',
        upsertExamples: [{ id: 'b1', then: '수량과 상태 유지' }],
      },
    ],
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));
  const rule = patch.data.aggregateDesign.rules[0];
  assert.equal(rule.condition, 'CONFIRMED');
  assert.equal(rule.unresolved, '확정 취소?');
  assert.equal(rule.examples[0].testReferences, 'tests/plan.test.ts');
  assert.match(
    (
      await req(
        `/projects/${p.id}/documents?path=${encodeURIComponent(`docs/domain/context-${ctx.id}/scenarios.md`)}`,
      )
    ).data.files[0].content,
    /수량과 상태 유지/,
  );
});

test('rule approval returns to proposed on a partial behavior change and retired rules stay historical', () => {
  const aggregate = card('agg', 'aggregate', {
    contextId: 'ctx',
    data: { root: 'ProductionPlan' },
    aggregateDesign: {
      commandIds: ['cmd'],
      externalReferences: [],
      coordination: '',
      rules: [
        {
          id: 'r1',
          statement: '수량은 양수',
          status: 'agreed',
          condition: '확정 시',
          commandIds: ['cmd'],
          examples: [
            {
              id: 'e1',
              title: '정상',
              type: 'normal',
              given: '수량 1',
              when: '확정',
              then: '확정됨',
            },
          ],
        },
      ],
    },
  });
  assert.equal(
    patchAggregateDesign(aggregate, { upsertRules: [{ id: 'r1' }] }).rules[0]
      .status,
    'agreed',
  );
  assert.equal(
    patchAggregateDesign(aggregate, {
      upsertRules: [{ id: 'r1', condition: '접수 시' }],
    }).rules[0].status,
    'proposed',
  );
  assert.equal(
    patchAggregateDesign(aggregate, {
      upsertRules: [
        { id: 'r1', upsertExamples: [{ id: 'e1', then: '접수됨' }] },
      ],
    }).rules[0].status,
    'proposed',
  );
  assert.equal(
    patchAggregateDesign(aggregate, {
      upsertRules: [{ id: 'r1', condition: '접수 시', status: 'agreed' }],
    }).rules[0].status,
    'agreed',
  );
  assert.equal(
    removeAggregateReference(aggregate, 'cmd').rules[0].status,
    'proposed',
  );
  const retired = {
    ...aggregate,
    aggregateDesign: {
      ...aggregate.aggregateDesign,
      rules: [
        {
          ...aggregate.aggregateDesign.rules[0],
          status: 'retired',
          commandIds: [],
          examples: [],
        },
      ],
    },
  };
  const issues = aggregateReview(retired, [
    retired,
    card('cmd', 'command', { contextId: 'ctx' }),
  ]);
  assert.ok(
    !issues.some((i) =>
      [
        'aggregate-rule-command',
        'aggregate-normal-example',
        'aggregate-rejection-example',
      ].includes(i.code),
    ),
  );
  assert.ok(issues.some((i) => i.code === 'aggregate-structured-rules'));
  const rules = file(
    buildDomainDocuments(project, [card('ctx', 'context'), retired]),
    'context-ctx/rules.md',
  );
  assert.match(rules.content, /규칙 상태: 폐기/);
});

test('scoped context map preserves incoming links and directed flows with reference revisions', () => {
  const cards = [
    card('c1', 'context', { title: '계획' }),
    card('c2', 'context', {
      title: '실행',
      revision: 7,
      links: [{ kind: 'related', targetId: 'c1' }],
    }),
    card('event', 'event', {
      contextId: 'c1',
      links: [{ kind: 'flow', targetId: 'policy' }],
    }),
    card('policy', 'policy', { contextId: 'c2' }),
  ];
  const bundle = buildDomainDocuments(project, cards, { contextId: 'c1' });
  const map = file(bundle, 'context-map.md').content;
  assert.match(map, /들어오는 컨텍스트 연결/);
  assert.match(map, /실행 \(c2\) → 계획 \(c1\)/);
  assert.match(map, /```mermaid/);
  assert.match(map, /c0 -->\|기록한 업무 흐름\| c1/);
  assert.match(map, /c1 -\. 관련 \.-> c0/);
  assert.equal(
    bundle.generatedFrom.references.find((c) => c.id === 'c2').revision,
    7,
  );
  assert.ok(bundle.generatedFrom.references.some((c) => c.id === 'policy'));
});
