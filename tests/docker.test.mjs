import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

test(
  'Compose serves the app, supports copied Docker MCP settings and preserves data on recreation',
  { timeout: 180000 },
  async (t) => {
    const listener = createServer();
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const project = `ddd-builder-smoke-${process.pid}`;
    const container = project;
    const base = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      DDD_PORT: String(port),
      DDD_BIND_ADDRESS: '127.0.0.1',
      DDD_CONTAINER_NAME: container,
      PUBLIC_URL: base,
      ACCESS_CODE: '',
    };
    const compose = (...args) =>
      run('docker', ['compose', '-p', project, ...args], {
        cwd: root,
        env,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      });
    t.after(() => compose('down', '--volumes', '--remove-orphans'));
    await compose('up', '-d', '--build', '--wait');
    assert.equal((await fetch(base)).status, 200);
    const { stdout: codeOutput } = await run('docker', [
      'exec',
      container,
      'cat',
      '/app/data/access-code',
    ]);
    const code = codeOutput.trim();
    assert.ok(code.length >= 20);
    async function login() {
      const response = await fetch(`${base}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Docker 검증', code }),
      });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    }
    let cookie = await login();
    const info = await (
      await fetch(`${base}/api/info`, { headers: { cookie } })
    ).json();
    assert.equal(info.runtime, 'docker');
    assert.deepEqual(info.urls, [base]);
    async function connect(readOnly) {
      const client = new Client({ name: 'docker-smoke', version: '1.0.0' });
      t.after(() => client.close());
      await client.connect(
        new StdioClientTransport({
          command: info.mcp.command,
          args: info.mcp.args,
          env: {
            ...process.env,
            ...info.mcp.env,
            DDD_READ_ONLY: String(readOnly),
          },
          stderr: 'pipe',
        }),
      );
      return client;
    }
    const readClient = await connect(true);
    assert.deepEqual(
      (await readClient.listTools()).tools.map((tool) => tool.name).sort(),
      ['get_project_board', 'list_projects'],
    );
    const list = await readClient.callTool({
      name: 'list_projects',
      arguments: {},
    });
    assert.notEqual(list.isError, true);
    const projectId = JSON.parse(list.content[0].text)[0].id;
    await readClient.close();
    const writeClient = await connect(false);
    const result = await writeClient.callTool({
      name: 'create_card',
      arguments: {
        projectId,
        stage: 'events',
        kind: 'event',
        title: '컨테이너에서 공유된 이벤트',
      },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const card = JSON.parse(result.content[0].text);
    assert.equal(card.updatedBy, 'AI 도우미');
    await writeClient.close();
    await compose('up', '-d', '--no-build', '--force-recreate', '--wait');
    assert.equal(
      (
        await run('docker', ['exec', container, 'cat', '/app/data/access-code'])
      ).stdout.trim(),
      code,
    );
    cookie = await login();
    const state = await (
      await fetch(`${base}/api/state`, { headers: { cookie } })
    ).json();
    assert.deepEqual(
      state.cards.find((c) => c.id === card.id),
      card,
    );
  },
);
