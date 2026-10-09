import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from '../server/app.mjs';

async function setup(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ddd-mcp-'));
  const app = await createApp({ dataDir: dir, code: 'mcp-test-code' });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const { createMcpServer } = await import('../mcp/server.mjs');
  const server = createMcpServer({ url, code: 'mcp-test-code', ...options });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'ddd-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return { client, url };
}
function value(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

test('MCP lists projects and exposes one project as tools, resources and an analysis prompt', async (t) => {
  const { client } = await setup(t);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.deepEqual(names.sort(), [
    'get_aggregate_design',
    'get_project_board',
    'list_projects',
    'review_design',
  ]);
  const projects = value(
    await client.callTool({ name: 'list_projects', arguments: {} }),
  );
  assert.ok(projects.length > 0);
  const projectId = projects[0].id;
  const board = value(
    await client.callTool({
      name: 'get_project_board',
      arguments: { projectId, stage: 'events' },
    }),
  );
  assert.equal(board.project.id, projectId);
  assert.ok(board.cards.length > 0);
  assert.ok(board.cards.every((c) => c.stage === 'events'));
  const resource = await client.readResource({
    uri: `ddd://projects/${projectId}`,
  });
  assert.equal(JSON.parse(resource.contents[0].text).project.id, projectId);
  const workspaceResource = await client.readResource({
    uri: 'ddd://projects',
  });
  assert.ok(!workspaceResource.contents[0].text.includes('mcp-test-code'));
  const prompt = await client.getPrompt({
    name: 'analyze_event_storming',
    arguments: { projectId },
  });
  assert.ok(prompt.messages[0].content.text.includes('바운디드 컨텍스트'));
  assert.ok(prompt.messages[0].content.text.includes(projectId));
});

test('MCP writable tools persist cards as AI and protect stale versions', async (t) => {
  const { client } = await setup(t, { readOnly: false });
  const projectId = value(
    await client.callTool({ name: 'list_projects', arguments: {} }),
  )[0].id;
  const card = value(
    await client.callTool({
      name: 'create_card',
      arguments: {
        projectId,
        stage: 'events',
        kind: 'event',
        title: 'AI가 발견한 이벤트',
      },
    }),
  );
  assert.equal(card.updatedBy, 'AI 도우미');
  const updated = value(
    await client.callTool({
      name: 'update_card',
      arguments: {
        cardId: card.id,
        revision: card.revision,
        title: 'AI가 정리한 이벤트',
      },
    }),
  );
  assert.equal(updated.revision, card.revision + 1);
  const stale = await client.callTool({
    name: 'update_card',
    arguments: {
      cardId: card.id,
      revision: card.revision,
      title: '덮어쓰면 안 됨',
    },
  });
  assert.equal(stale.isError, true);
  const error = JSON.parse(stale.content[0].text);
  assert.equal(error.status, 409);
  assert.equal(error.current.title, updated.title);
  const board = value(
    await client.callTool({
      name: 'get_project_board',
      arguments: { projectId },
    }),
  );
  assert.equal(board.cards.find((c) => c.id === card.id).title, updated.title);
});

test('MCP returns actionable authentication and missing-project errors', async (t) => {
  const { client } = await setup(t, { code: 'wrong-code' });
  const result = await client.callTool({
    name: 'list_projects',
    arguments: {},
  });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).status, 401);
});

test('real stdio MCP initializes and reads the HTTP board without stdout noise', async (t) => {
  const { url } = await setup(t);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('mcp/index.mjs')],
    env: {
      ...process.env,
      DDD_URL: url,
      DDD_CODE: 'mcp-test-code',
      DDD_READ_ONLY: 'true',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const projects = value(
    await client.callTool({ name: 'list_projects', arguments: {} }),
  );
  assert.equal(projects[0].name, '온라인 주문 서비스');
});

test('MCP exposes review and structured design metadata with Mermaid context relations', async (t) => {
  const { client } = await setup(t, { readOnly: false });
  const projectId = value(
    await client.callTool({ name: 'list_projects', arguments: {} }),
  )[0].id;
  const context = value(
    await client.callTool({
      name: 'create_card',
      arguments: {
        projectId,
        stage: 'contexts',
        kind: 'context',
        title: 'MCP 컨텍스트',
        status: 'hypothesis',
        data: {
          relationships: '주문과 결제',
          relationshipDiagram: 'flowchart LR\n A --> B',
          relationshipFormat: 'mermaid',
        },
      },
    }),
  );
  assert.equal(context.data.relationshipFormat, 'mermaid');
  assert.equal(context.status, 'hypothesis');
  const event = value(
    await client.callTool({
      name: 'create_card',
      arguments: {
        projectId,
        stage: 'events',
        kind: 'event',
        title: 'MCP 사건',
        scenario: 'exception',
        contextId: context.id,
      },
    }),
  );
  const cmd = value(
    await client.callTool({
      name: 'create_card',
      arguments: {
        projectId,
        stage: 'events',
        kind: 'command',
        title: 'MCP 명령',
        links: [{ kind: 'flow', targetId: event.id }],
        status: 'agreed',
        decision: '담당자와 명령 결과 합의',
        contextId: context.id,
      },
    }),
  );
  assert.equal(cmd.links[0].targetId, event.id);
  const review = value(
    await client.callTool({ name: 'review_design', arguments: { projectId } }),
  );
  assert.ok(
    !review.issues.some(
      (i) => i.cardId === cmd.id && i.code === 'command-result',
    ),
  );
});

test('MCP reads aggregate behavior and safely patches one rule, resources and learning prompts', async (t) => {
  const { client } = await setup(t, { readOnly: false });
  const projectId = value(
    await client.callTool({ name: 'list_projects', arguments: {} }),
  )[0].id;
  const create = (args) =>
    client
      .callTool({ name: 'create_card', arguments: { projectId, ...args } })
      .then(value);
  const command = await create({
    stage: 'events',
    kind: 'command',
    title: '새 명령',
  });
  let aggregate = await create({
    stage: 'aggregates',
    kind: 'aggregate',
    title: '새 경계',
    data: { root: 'Root', invariants: '기존 업무 설명' },
    aggregateDesign: {
      commandIds: [command.id],
      rules: [
        {
          id: 'r1',
          statement: '규칙 하나',
          commandIds: [command.id],
          examples: [
            {
              id: 'e1',
              given: '초기 상태',
              when: '명령 실행',
              then: '기대 결과',
            },
          ],
        },
        { id: 'r2', statement: '규칙 둘' },
      ],
    },
  });
  const read = value(
    await client.callTool({
      name: 'get_aggregate_design',
      arguments: { aggregateId: aggregate.id },
    }),
  );
  assert.equal(read.commands[0].card.id, command.id);
  aggregate = value(
    await client.callTool({
      name: 'patch_aggregate_design',
      arguments: {
        aggregateId: aggregate.id,
        revision: aggregate.revision,
        upsertRules: [{ id: 'r1', statement: '수정한 규칙' }],
      },
    }),
  );
  assert.equal(
    aggregate.aggregateDesign.rules[0].examples[0].given,
    '초기 상태',
  );
  assert.equal(aggregate.aggregateDesign.rules[1].statement, '규칙 둘');
  assert.equal(aggregate.data.invariants, '기존 업무 설명');
  const stale = await client.callTool({
    name: 'patch_aggregate_design',
    arguments: {
      aggregateId: aggregate.id,
      revision: 1,
      coordination: '낡은 쓰기',
    },
  });
  assert.equal(stale.isError, true);
  assert.equal(JSON.parse(stale.content[0].text).status, 409);
  const resource = await client.readResource({
    uri: `ddd://aggregates/${aggregate.id}`,
  });
  assert.equal(
    JSON.parse(resource.contents[0].text).aggregate.revision,
    aggregate.revision,
  );
  const learning = await client.readResource({
    uri: 'ddd://learning/aggregates',
  });
  assert.ok(
    JSON.parse(learning.contents[0].text).lesson.concepts.some((c) =>
      c.title.includes('애그리게이트'),
    ),
  );
  const prompt = await client.getPrompt({
    name: 'analyze_aggregate_design',
    arguments: { aggregateId: aggregate.id },
  });
  assert.ok(
    prompt.messages[0].content.text.includes('사례는 실행한 테스트가 아닙니다'),
  );
  assert.ok(prompt.messages[0].content.text.includes('수정한 규칙'));
});
