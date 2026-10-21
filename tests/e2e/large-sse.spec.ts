import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.mjs';
import { openStore, record } from '../../server/store.mjs';

test('a board over 1 MiB stays editable and receives saved changes through browser SSE', async ({
  page,
}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ddd-large-sse-browser-'));
  const store = openStore(dataDir);
  const project = record({ name: '큰 보드 검증', description: '' }, '검증');
  store.saveProject(project);
  let first;
  for (let i = 0; i < 55; i++) {
    const card = record(
      {
        projectId: project.id,
        stage: 'events',
        kind: 'event',
        title: `대용량 이벤트 ${i}`,
        description: '한글🎉'.repeat(2000),
        contextId: null,
        data: {},
        position: i,
      },
      '검증',
    );
    store.saveCard(card);
    first ??= card;
  }
  expect(Buffer.byteLength(JSON.stringify(store.state()))).toBeGreaterThan(
    1024 * 1024,
  );
  store.close();
  const app = await createApp({
    dataDir,
    code: 'large-board-test',
    staticDir: join(process.cwd(), 'dist'),
  });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  let fallbackReads = 0;
  const streamStatuses: number[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/state') fallbackReads++;
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/events')
      streamStatuses.push(response.status());
  });
  try {
    expect(
      (
        await page.request.post(`${url}/api/session`, {
          data: { name: '큰 보드 참여자', code: 'large-board-test' },
        })
      ).status(),
    ).toBe(200);
    await page.goto(url);
    await page.getByLabel('프로젝트 선택').selectOption(project.id);
    await page
      .getByRole('button', { name: '이벤트 정리 단계', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: '카드 추가', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', {
        name: `카드 편집: ${first.title}`,
        exact: true,
      }),
    ).toBeVisible();
    const updatedTitle = '큰 보드에서도 실시간 수정 완료 🎉';
    expect(
      (
        await page.request.patch(`${url}/api/cards/${first.id}`, {
          data: { revision: first.revision, title: updatedTitle },
        })
      ).status(),
    ).toBe(200);
    await expect(
      page.getByRole('button', {
        name: `카드 편집: ${updatedTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', {
        name: `카드 편집: ${updatedTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '카드 추가', exact: true }),
    ).toBeEnabled();
    expect(streamStatuses).toEqual([200, 200]);
    expect(fallbackReads).toBe(0);
  } finally {
    await page.goto('about:blank');
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
