import { test, expect, type Page } from '@playwright/test';
async function join(page: Page) {
  await page.goto('/');
  await page.getByLabel('이름', { exact: true }).fill('설계 UI 검토');
  await page.getByLabel('접속 코드').fill('workshop-test-code');
  await page
    .getByRole('button', { name: '워크숍 참여하기', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeVisible();
}
async function project(page: Page) {
  const p = await (
    await page.request.post('/api/projects', {
      data: { name: `설계 검토 ${Date.now()}` },
    })
  ).json();
  await expect(page.getByLabel('프로젝트 선택')).toContainText(p.name);
  await page.getByLabel('프로젝트 선택').selectOption(p.id);
  return p;
}
test('human links, agreement, filters and review remain visible after reload', async ({
  page,
}) => {
  await join(page);
  const p = await project(page);
  const event = await (
    await page.request.post(`/api/projects/${p.id}/cards`, {
      data: {
        stage: 'events',
        kind: 'event',
        title: '결제가 승인되었다',
        scenario: 'main',
      },
    })
  ).json();
  await page.getByRole('button', { name: '카드 추가', exact: true }).click();
  await page.getByLabel('카드 유형', { exact: true }).selectOption('command');
  await page.getByLabel('제목', { exact: true }).fill('결제 승인 요청');
  await page.getByLabel('연결 대상').selectOption(event.id);
  await page.getByRole('button', { name: '연결 추가', exact: true }).click();
  await page.getByLabel('검토 상태', { exact: true }).selectOption('agreed');
  await page.getByLabel('검토 근거').fill('결제 담당자와 승인 결과를 합의했다');
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await page.getByRole('button', { name: '흐름 보기', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: '흐름 카드: 결제 승인 요청',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('.flow-canvas svg > path')).toHaveCount(1);
  await page.getByRole('button', { name: '설계 점검', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '설계 점검 결과' }),
  ).toContainText('합의 1');
  await page.getByRole('button', { name: '카드 보기', exact: true }).click();
  await page.getByLabel('검토 상태 필터').selectOption('agreed');
  await expect(
    page.getByRole('button', {
      name: '카드 편집: 결제 승인 요청',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: '카드 편집: 결제가 승인되었다',
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: '카드 편집: 결제 승인 요청', exact: true })
    .click();
  await page
    .getByLabel('설명', { exact: true })
    .fill('승인 결과를 다시 확인한다');
  await expect(page.getByLabel('검토 상태', { exact: true })).toHaveValue(
    'proposed',
  );
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await page.getByLabel('검토 상태 필터').selectOption('all');
  await page.reload();
  await expect(
    page.getByRole('button', {
      name: '카드 편집: 결제 승인 요청',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: '흐름 보기', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: '흐름 카드: 결제 승인 요청',
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('button', { name: '설계 점검', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/design-mobile.png',
    fullPage: true,
  });
});
test('text and Mermaid context sources persist independently and syntax errors preserve the draft', async ({
  page,
}) => {
  await join(page);
  const p = await project(page);
  const context = await (
    await page.request.post(`/api/projects/${p.id}/cards`, {
      data: {
        stage: 'contexts',
        kind: 'context',
        title: '주문',
        description: '접수와 취소',
        data: { relationships: '결제에 승인 요청을 전달한다.' },
      },
    })
  ).json();
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await page
    .getByRole('button', { name: '카드 편집: 주문', exact: true })
    .click();
  await page.getByLabel('컨텍스트 관계 형식').selectOption('mermaid');
  const source =
    'flowchart LR\n  Order[주문] -->|결제 요청| Payment[결제]\n  Payment -->|승인 결과| Order';
  await page.getByLabel('Mermaid 다이어그램', { exact: true }).fill(source);
  await expect(
    page.getByRole('img', { name: '컨텍스트 관계 다이어그램' }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByLabel('컨텍스트 관계 형식').selectOption('text');
  await expect(page.getByLabel('다른 컨텍스트와의 관계')).toHaveValue(
    '결제에 승인 요청을 전달한다.',
  );
  await page.getByLabel('컨텍스트 관계 형식').selectOption('mermaid');
  await expect(
    page.getByLabel('Mermaid 다이어그램', { exact: true }),
  ).toHaveValue(source);
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(
    page.getByRole('img', { name: '컨텍스트 관계 다이어그램' }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await expect(
    page.getByRole('img', { name: '컨텍스트 관계 다이어그램' }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/context-mermaid.png',
    fullPage: true,
  });
  await page
    .getByRole('button', { name: '카드 편집: 주문', exact: true })
    .click();
  await page
    .getByLabel('Mermaid 다이어그램', { exact: true })
    .fill('flowchart LR\n A --> [broken');
  await expect(
    page.getByText('Mermaid 문법을 확인해 주세요.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Mermaid 다이어그램', { exact: true }),
  ).toHaveValue('flowchart LR\n A --> [broken');
  await page
    .getByLabel('Mermaid 다이어그램', { exact: true })
    .fill('%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n A --> B');
  await expect(
    page.getByText('Mermaid 문법을 확인해 주세요.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  const state = await (await page.request.get('/api/state')).json();
  const saved = state.cards.find((c: { id: string }) => c.id === context.id);
  expect(saved.data.relationshipDiagram).toBe(source);
  expect(saved.data.relationships).toBe('결제에 승인 요청을 전달한다.');
  const md = await (
    await page.request.get(`/api/projects/${p.id}/export?format=markdown`)
  ).text();
  expect(md).toContain('```mermaid\n' + source + '\n```');
});
test('untrusted Mermaid renders without active HTML, navigation or external resources', async ({
  page,
}) => {
  await join(page);
  const p = await project(page);
  let external = 0;
  page.on('request', (request) => {
    if (
      !request.url().startsWith('http://127.0.0.1:3211/') &&
      !request.url().startsWith('data:')
    )
      external++;
  });
  await page.request.post(`/api/projects/${p.id}/cards`, {
    data: {
      stage: 'contexts',
      kind: 'context',
      title: '안전한 관계',
      data: {
        relationshipFormat: 'mermaid',
        relationshipDiagram:
          'flowchart LR\n A["<img src=x onerror=alert(1)>"] --> B[결제]\n click B "https://example.com"',
      },
    },
  });
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await expect(
    page.getByRole('img', { name: '컨텍스트 관계 다이어그램' }),
  ).toBeVisible({ timeout: 20000 });
  expect(
    await page
      .locator(
        '.mermaid-svg script, .mermaid-svg a, .mermaid-svg image, .mermaid-svg foreignObject',
      )
      .count(),
  ).toBe(0);
  expect(external).toBe(0);
});
