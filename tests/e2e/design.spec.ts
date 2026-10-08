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
  await page.getByRole('button', { name: '카드 보기', exact: true }).click();
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
  await page.getByRole('button', { name: '카드 보기', exact: true }).click();
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
  await page.getByRole('button', { name: '카드 보기', exact: true }).click();
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

test('context boundaries group real members, reveal crossing flows and preserve reassignment after reload', async ({
  page,
}) => {
  await join(page);
  const p = await project(page);
  async function create(
    kind: string,
    title: string,
    stage = 'events',
    extra = {},
  ) {
    const r = await page.request.post(`/api/projects/${p.id}/cards`, {
      data: { stage, kind, title, ...extra },
    });
    expect(r.status()).toBe(201);
    return r.json();
  }
  const order = await create('context', '주문', 'contexts', {
    description: '주문 접수와 이행 판단',
    position: 0,
  });
  const stock = await create('context', '재고', 'contexts', {
    description: 'SKU별 확보와 해제',
    position: 1,
    links: [{ kind: 'related', targetId: order.id }],
  });
  await create('context', '배송', 'contexts', {
    description: '출고와 택배 인계',
    position: 2,
  });
  const reserved = await create('event', '재고 예약 완료', 'events', {
    contextId: stock.id,
  });
  const command = await create('command', '재고 예약', 'events', {
    contextId: stock.id,
    links: [{ kind: 'flow', targetId: reserved.id }],
  });
  await create('policy', '주문 접수 후 예약', 'events', {
    contextId: order.id,
    links: [{ kind: 'flow', targetId: command.id }],
  });
  await create('event', '주문 접수 완료', 'events', { contextId: order.id });
  await create('aggregate', 'Order', 'aggregates', {
    contextId: order.id,
    data: { root: 'Order', invariants: '항목이 한 개 이상이다' },
  });
  const question = await create('question', '예약 시간은 얼마인가?');
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '경계 보기', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const orderRegion = page.getByRole('region', {
    name: '컨텍스트 영역: 주문',
    exact: true,
  });
  await expect(
    orderRegion.getByRole('button', { name: '경계 카드: Order', exact: true }),
  ).toBeVisible();
  await expect(orderRegion).toContainText('이벤트 1');
  await expect(orderRegion).toContainText('애그리게이트 1');
  await expect(
    page.getByRole('region', { name: '컨텍스트 영역: 배송', exact: true }),
  ).toContainText('내부 카드 0개');
  await expect(page.locator('.context-map-lines > path')).toHaveCount(1);
  expect(
    await page
      .locator('.context-map-lines > path')
      .getAttribute('marker-start'),
  ).toBeNull();
  expect(
    await page.locator('.context-map-lines > path').getAttribute('marker-end'),
  ).toContain('url(#');
  await page
    .getByRole('button', {
      name: '경계 연결: 주문 · 재고, 흐름 1개',
      exact: true,
    })
    .click();
  const flows = page.getByRole('region', {
    name: '경계 연결 상세',
    exact: true,
  });
  await expect(flows).toContainText('주문 → 재고');
  await expect(flows).toContainText('주문 접수 후 예약');
  await expect(flows).toContainText('재고 예약');
  await page
    .getByRole('button', { name: '미분류 1개 보기', exact: true })
    .click();
  await page
    .getByLabel('경계 배치: 예약 시간은 얼마인가?', { exact: true })
    .selectOption(order.id);
  await expect
    .poll(async () => {
      const state = await (await page.request.get('/api/state')).json();
      return state.cards.find((c: { id: string }) => c.id === question.id)
        .contextId;
    })
    .toBe(order.id);
  await page.reload();
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await page
    .getByRole('button', { name: '주문 내부 카드 전체 보기', exact: true })
    .click();
  const inside = page.getByRole('region', {
    name: '주문 내부 카드',
    exact: true,
  });
  await expect(
    inside.getByLabel('경계 배치: 예약 시간은 얼마인가?', { exact: true }),
  ).toHaveValue(order.id);
  await page.getByLabel('카드 검색', { exact: true }).fill('예약 시간');
  await expect(
    page.getByRole('region', { name: '컨텍스트 영역: 배송', exact: true }),
  ).toBeVisible();
  await expect(
    inside.getByRole('button', {
      name: '경계 카드: 예약 시간은 얼마인가?',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('카드 검색', { exact: true }).fill('');
  await page
    .getByRole('button', { name: '경계 상세 닫기', exact: true })
    .click();
  await page.screenshot({
    path: 'test-results/context-boundaries.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('region', { name: '컨텍스트 영역: 주문', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/context-boundaries-mobile.png',
    fullPage: true,
  });
});
