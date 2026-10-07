import { test, expect, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('이름').fill(name);
  await page.getByLabel('접속 코드').fill('workshop-test-code');
  await page.getByRole('button', { name: '워크숍 참여하기' }).click();
  await expect(
    page.getByRole('button', { name: '이벤트 정리 단계', exact: true }),
  ).toBeVisible();
}

test('two participants see saved changes and stale editors cannot overwrite them', async ({
  browser,
}) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const first = await a.newPage();
  const second = await b.newPage();
  await join(first, '민지');
  await join(second, '준호');
  await first
    .getByRole('button', { name: '이벤트 정리 단계', exact: true })
    .click();
  await second
    .getByRole('button', { name: '이벤트 정리 단계', exact: true })
    .click();
  await first.getByRole('button', { name: '카드 추가', exact: true }).click();
  const title = `협업 이벤트 ${Date.now()}`;
  await first.getByLabel('제목').fill(title);
  await first.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(
    second.getByRole('button', { name: `카드 편집: ${title}`, exact: true }),
  ).toBeVisible();
  await first
    .getByRole('button', { name: `카드 편집: ${title}`, exact: true })
    .click();
  await second
    .getByRole('button', { name: `카드 편집: ${title}`, exact: true })
    .click();
  await first.getByLabel('설명').fill('민지의 최신 내용');
  await first.getByRole('button', { name: '카드 저장', exact: true }).click();
  await second.getByLabel('설명').fill('준호의 이전 버전');
  await second.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(
    second.getByText('다른 참여자가 먼저 수정했어요.'),
  ).toBeVisible();
  await second.getByRole('button', { name: '최신 내용 불러오기' }).click();
  await expect(second.getByLabel('설명')).toHaveValue('민지의 최신 내용');
  await a.close();
  await b.close();
});

test('workflow, project creation, task completion, export and small screen', async ({
  page,
}) => {
  await join(page, '소라');
  await page.getByRole('button', { name: '새 프로젝트', exact: true }).click();
  await page.getByLabel('프로젝트 이름').fill(`배송 워크숍 ${Date.now()}`);
  await page.getByLabel('예시 카드로 시작').check();
  await page.getByRole('button', { name: '프로젝트 만들기' }).click();
  await expect(
    page.getByRole('heading', { name: '우리가 풀고 싶은 문제는 무엇인가요?' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '함께 움직이는 것들의 경계를 찾아요.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '애그리게이트 설계 단계', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '함께 지켜야 할 규칙을 모아요.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '구현 체크리스트 단계', exact: true })
    .click();
  const tasks = page.getByRole('checkbox', { name: /^작업 완료:/ });
  await expect(tasks.first()).toBeVisible();
  const checked = await tasks.first().isChecked();
  await tasks.first().setChecked(!checked);
  await expect(tasks.first()).toBeChecked({ checked: !checked });
  await page
    .getByRole('button', { name: '결과 내보내기', exact: true })
    .click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Markdown 문서' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '단계 메뉴' }).click();
  await page
    .getByRole('button', { name: '도메인 탐색 단계', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeVisible();
});

test('AI can connect with the settings shown in the app and share a card live', async ({
  page,
}) => {
  await join(page, 'AI 협업 테스트');
  await page
    .getByRole('button', {
      name: 'AI와 함께 설계하기 MCP로 외부 AI를 연결해요',
    })
    .click();
  await page.getByRole('button', { name: '설정 보기' }).click();
  await expect(page.locator('.config-block')).toContainText('DDD_READ_ONLY');
  const readonlyConfig = JSON.parse(
    (await page.locator('.config-block').textContent())!,
  ).mcpServers['ddd-builder'];
  expect(readonlyConfig.env.DDD_READ_ONLY).toBe('true');
  await page
    .getByRole('checkbox', { name: /^AI가 보드를 수정하도록 허용/ })
    .check();
  const config = JSON.parse(
    (await page.locator('.config-block').textContent())!,
  ).mcpServers['ddd-builder'];
  expect(config.env.DDD_READ_ONLY).toBe('false');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  const client = new Client({ name: 'browser-ai-test', version: '1.0.0' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env },
        stderr: 'pipe',
      }),
    );
    const result = await client.callTool({
      name: 'list_projects',
      arguments: {},
    });
    const projects = JSON.parse(
      (result.content as { type: string; text: string }[])[0].text,
    );
    const title = `AI 분석에서 발견한 이벤트 ${Date.now()}`;
    const created = await client.callTool({
      name: 'create_card',
      arguments: {
        projectId: projects[0].id,
        stage: 'events',
        kind: 'event',
        title,
        description: '외부 MCP 클라이언트에서 작성한 카드',
      },
    });
    expect(created.isError).not.toBe(true);
    await expect(
      page.getByRole('button', { name: `카드 편집: ${title}`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: `카드 편집: ${title}`, exact: true })
      .click();
    await expect(page.getByText(/최근 수정: AI 도우미/)).toBeVisible();
  } finally {
    await client.close();
  }
});

test('a new draft stays with its original project if another client deletes that project', async ({
  page,
}) => {
  await join(page, '드래프트 테스트');
  const created = await page.request.post('/api/projects', {
    data: { name: `삭제 경합 ${Date.now()}`, description: '' },
  });
  const project = await created.json();
  await page.getByLabel('프로젝트 선택').selectOption(project.id);
  await page.getByRole('button', { name: '카드 추가', exact: true }).click();
  const title = `보존할 작성 내용 ${Date.now()}`;
  await page.getByLabel('제목').fill(title);
  const removed = await page.request.delete(`/api/projects/${project.id}`, {
    data: { revision: project.revision },
  });
  expect(removed.ok()).toBe(true);
  await expect(page.getByLabel('프로젝트 선택')).not.toHaveValue(project.id);
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(
    page.getByText('프로젝트를 찾을 수 없습니다.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('제목')).toHaveValue(title);
  const state = await (await page.request.get('/api/state')).json();
  expect(
    state.cards.some((card: { title: string }) => card.title === title),
  ).toBe(false);
});

test('pending saves cannot dismiss the editor and close a different draft later', async ({
  page,
}) => {
  await join(page, '저장 지연 테스트');
  await page
    .getByRole('button', { name: '카드 편집: 주문이 접수되었다', exact: true })
    .click();
  await page.getByLabel('설명').fill('응답이 늦는 저장');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/cards/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await held;
      await route.continue();
    } else await route.continue();
  });
  try {
    await page.getByRole('button', { name: '카드 저장', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '취소', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: '닫기', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('설명')).toHaveValue('응답이 늦는 저장');
  } finally {
    release();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('reauthentication preserves an unsaved card draft', async ({ page }) => {
  await join(page, '재접속 테스트');
  await page.getByRole('button', { name: '카드 추가', exact: true }).click();
  const title = `재입장 후 보존 ${Date.now()}`;
  await page.getByLabel('제목').fill(title);
  await page.getByLabel('설명').fill('세션이 만료되어도 유지할 내용');
  await page.request.delete('/api/session');
  const rejoin = page.getByRole('dialog', {
    name: '워크숍에 다시 참여하기',
    exact: true,
  });
  await expect(rejoin).toBeVisible();
  await rejoin.getByLabel('접속 코드').fill('workshop-test-code');
  await rejoin.getByRole('button', { name: '워크숍 참여하기' }).click();
  await expect(rejoin).toHaveCount(0);
  await expect(page.getByLabel('제목')).toHaveValue(title);
  await expect(page.getByLabel('설명')).toHaveValue(
    '세션이 만료되어도 유지할 내용',
  );
  await expect(
    page.getByRole('button', { name: '카드 저장', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `카드 편집: ${title}`, exact: true }),
  ).toBeVisible();
});

test('failed optimistic changes preserve a newer card already received from a teammate', async ({
  page,
}) => {
  await join(page, '롤백 테스트');
  const state = await (await page.request.get('/api/state')).json();
  const created = await page.request.post(
    `/api/projects/${state.projects[0].id}/cards`,
    {
      data: {
        stage: 'tasks',
        kind: 'task',
        title: `동시 수정 ${Date.now()}`,
        data: { done: false, assignee: '' },
      },
    },
  );
  const card = await created.json();
  await page
    .getByRole('button', { name: '구현 체크리스트 단계', exact: true })
    .click();
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(`**/api/cards/${card.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      started();
      await held;
      await route.abort();
    } else await route.continue();
  });
  await page.route('**/api/state', (route) => route.abort());
  try {
    await page
      .getByRole('checkbox', { name: `작업 완료: ${card.title}`, exact: true })
      .check();
    await requested;
    const newTitle = `${card.title} · 팀원의 최신 내용`;
    const edited = await page.request.patch(`/api/cards/${card.id}`, {
      data: { title: newTitle, revision: card.revision },
    });
    expect(edited.ok()).toBe(true);
    await expect(
      page.getByRole('button', { name: `카드 편집: ${newTitle}`, exact: true }),
    ).toBeVisible();
    release();
    await expect(
      page.locator('.card-kind').filter({ hasText: '저장 중…' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `카드 편집: ${newTitle}`, exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});
