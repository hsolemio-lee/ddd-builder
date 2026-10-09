import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.goto('/');
  await page.getByLabel('이름', { exact: true }).fill('애그리게이트 검토');
  await page.getByLabel('접속 코드').fill('workshop-test-code');
  await page
    .getByRole('button', { name: '워크숍 참여하기', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeVisible();
  const project = await (
    await page.request.post('/api/projects', {
      data: { name: `행동 설계 ${Date.now()}` },
    })
  ).json();
  const create = async (data: object) => {
    const response = await page.request.post(
      `/api/projects/${project.id}/cards`,
      { data },
    );
    expect(response.status()).toBe(201);
    return response.json();
  };
  const context = await create({
    stage: 'contexts',
    kind: 'context',
    title: '주문 관리',
  });
  const event = await create({
    stage: 'events',
    kind: 'event',
    title: '주문이 접수되었다',
    contextId: context.id,
  });
  const command = await create({
    stage: 'events',
    kind: 'command',
    title: '주문 접수',
    contextId: context.id,
    links: [{ kind: 'flow', targetId: event.id }],
  });
  await create({
    stage: 'aggregates',
    kind: 'aggregate',
    title: '결제 거래',
    data: { root: 'Payment' },
  });
  await expect(page.getByLabel('프로젝트 선택')).toContainText(project.name);
  await page.getByLabel('프로젝트 선택').selectOption(project.id);
  await page
    .getByRole('button', { name: '애그리게이트 설계 단계', exact: true })
    .click();
  return { project, command };
}

test('aggregate behavior, rules and examples persist and remain editable after an MCP-style partial patch', async ({
  page,
}) => {
  const { project } = await setup(page);
  await page.getByRole('button', { name: '카드 추가', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill('주문');
  await page.getByLabel('애그리게이트 루트', { exact: true }).fill('Order');
  await page.getByLabel('엔티티', { exact: true }).fill('OrderLine');
  await page
    .getByLabel('값 객체', { exact: true })
    .fill('Money\nShippingAddress');
  await page
    .getByLabel('항상 지켜야 할 규칙', { exact: true })
    .fill('기존 자유 입력 설명');
  await page
    .getByLabel('소속 컨텍스트', { exact: true })
    .selectOption({ label: '주문 관리' });
  await page
    .getByRole('checkbox', { name: '처리 명령: 주문 접수', exact: true })
    .check();
  await page
    .getByRole('button', { name: '업무 규칙 추가', exact: true })
    .click();
  await page
    .getByLabel('규칙 내용 1', { exact: true })
    .fill('항목이 하나 이상이어야 한다');
  await page
    .getByRole('checkbox', { name: '규칙 1 명령: 주문 접수', exact: true })
    .check();
  for (const i of [1, 2]) {
    await page
      .getByRole('button', { name: '규칙 1 검증 사례 추가', exact: true })
      .click();
    await page
      .getByLabel(`규칙 1 사례 ${i} 이름`, { exact: true })
      .fill(i === 1 ? '정상 주문' : '빈 주문 거절');
    await page
      .getByLabel(`규칙 1 사례 ${i} 구분`, { exact: true })
      .selectOption(i === 1 ? 'normal' : 'rejection');
    await page
      .getByLabel(`규칙 1 사례 ${i} given`, { exact: true })
      .fill(i === 1 ? '항목이 한 개 있다' : '항목이 없다');
    await page
      .getByLabel(`규칙 1 사례 ${i} when`, { exact: true })
      .fill('주문 접수를 요청한다');
    await page
      .getByLabel(`규칙 1 사례 ${i} then`, { exact: true })
      .fill(i === 1 ? '주문이 접수된다' : '거절하고 상태를 유지한다');
  }
  await page
    .getByLabel('외부 애그리게이트 선택')
    .selectOption({ label: '미분류 · 결제 거래' });
  await page.getByRole('button', { name: '참조 추가', exact: true }).click();
  await page
    .getByLabel('외부 참조 이유: 결제 거래')
    .fill('결제 거래 ID만 참조한다');
  await page
    .getByLabel('경계 밖 조정·실패 정책')
    .fill('승인 결과를 기다리고 중복 결과를 한 번 처리한다');
  await page.getByLabel('검토 상태', { exact: true }).selectOption('agreed');
  await page
    .getByLabel('검토 근거', { exact: true })
    .fill('주문 담당자와 정상·거절 사례를 검토했다');
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const boundary = page.getByRole('region', {
    name: '주문 일관성 경계',
    exact: true,
  });
  await expect(boundary).toContainText('OrderLine');
  await expect(boundary).toContainText('ShippingAddress');
  await expect(boundary).toContainText('기존 자유 입력 설명');
  await boundary
    .getByText('항목이 하나 이상이어야 한다', { exact: false })
    .click();
  await expect(boundary).toContainText('빈 주문 거절');
  await expect(boundary).toContainText('거절하고 상태를 유지한다');
  await page.reload();
  await page
    .getByRole('button', { name: '애그리게이트 설계 단계', exact: true })
    .click();
  await expect(boundary).toContainText('사례 2개');
  const state = await (await page.request.get('/api/state')).json();
  const aggregate = state.cards.find(
    (c: { title: string; projectId: string }) =>
      c.projectId === project.id && c.title === '주문',
  );
  const rule = aggregate.aggregateDesign.rules[0];
  const patched = await page.request.patch(
    `/api/cards/${aggregate.id}/aggregate-design`,
    {
      data: {
        revision: aggregate.revision,
        upsertRules: [
          {
            id: rule.id,
            upsertExamples: [
              { id: rule.examples[1].id, then: '접수 이벤트를 만들지 않는다' },
            ],
          },
        ],
      },
    },
  );
  expect(patched.status()).toBe(200);
  await expect(
    page.getByRole('article', { name: '애그리게이트: 주문', exact: true }),
  ).toContainText('제안');
  await page
    .getByRole('button', { name: '애그리게이트 편집: 주문', exact: true })
    .click();
  await expect(
    page.getByLabel('규칙 1 사례 2 then', { exact: true }),
  ).toHaveValue('접수 이벤트를 만들지 않는다');
  await expect(
    page.getByLabel('규칙 1 사례 1 then', { exact: true }),
  ).toHaveValue('주문이 접수된다');
  await expect(page.getByLabel('외부 참조 이유: 결제 거래')).toHaveValue(
    '결제 거래 ID만 참조한다',
  );
  await page.keyboard.press('Escape');
  await page
    .getByLabel('카드 검색', { exact: true })
    .fill('접수 이벤트를 만들지 않는다');
  await expect(
    page.getByRole('article', { name: '애그리게이트: 주문', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: '애그리게이트: 결제 거래', exact: true }),
  ).not.toBeVisible();
  await page.getByLabel('카드 검색', { exact: true }).fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page
        .locator('.sidebar')
        .evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({
    path: '/tmp/ddd-aggregate-mobile.png',
    fullPage: true,
  });
});

test('old aggregate text stays visible and incomplete designs provide review questions', async ({
  page,
}) => {
  await setup(page);
  const boundary = page.getByRole('region', {
    name: '결제 거래 일관성 경계',
    exact: true,
  });
  await expect(boundary).toContainText('Payment');
  await expect(boundary).toContainText('처리 명령을 연결해');
  await page.getByRole('button', { name: '설계 점검', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '설계 점검 결과' }),
  ).toContainText('변경 진입점');
  await page
    .getByRole('button', { name: '애그리게이트 편집: 결제 거래', exact: true })
    .click();
  await expect(
    page.getByLabel('애그리게이트 루트', { exact: true }),
  ).toHaveValue('Payment');
  await page
    .getByRole('button', { name: '업무 규칙 추가', exact: true })
    .click();
  await page.getByLabel('규칙 내용 1', { exact: true }).fill('검토할 가설');
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(boundary).toContainText('검토할 가설');
});

test('viewers can inspect aggregate rules and cases without editing the design', async ({
  page,
}) => {
  const project = {
    id: 'viewer-aggregate-project',
    name: '조회 설계',
    description: '',
    revision: 1,
    createdAt: '2026-10-09T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
    updatedBy: '관리자',
    role: 'viewer',
  };
  const card = {
    id: 'viewer-aggregate',
    projectId: project.id,
    stage: 'aggregates',
    kind: 'aggregate',
    title: '조회 모델',
    description: '',
    revision: 1,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    updatedBy: '관리자',
    contextId: null,
    position: 0,
    data: {
      root: 'Order',
      entities: 'OrderLine',
      valueObjects: 'Money',
      invariants: '기존 불변식',
    },
    aggregateDesign: {
      commandIds: [],
      externalReferences: [],
      coordination: '',
      rules: [
        {
          id: 'viewer-rule',
          statement: '항목 수량은 양수다',
          commandIds: [],
          examples: [
            {
              id: 'viewer-case',
              type: 'rejection',
              title: '수량 0 거절',
              given: '수량이 0이다',
              when: '항목을 추가한다',
              then: '거절한다',
            },
          ],
        },
      ],
    },
  };
  const state = { projects: [project], cards: [card] };
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'viewer',
          name: '조회자',
          email: 'viewer@example.test',
          siteAdmin: false,
        },
      },
    }),
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: state\ndata: ${JSON.stringify(state)}\n\n`,
    }),
  );
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.goto('/');
  await page
    .getByRole('button', { name: '애그리게이트 설계 단계', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: '애그리게이트 보기: 조회 모델', exact: true })
    .click();
  const details = page.getByRole('dialog', { name: '조회 모델', exact: true });
  await expect(details).toContainText('기존 불변식');
  await details.getByText('항목 수량은 양수다', { exact: false }).click();
  await expect(details).toContainText('수량 0 거절');
  await expect(details).toContainText('거절한다');
  await expect(details.getByRole('textbox')).toHaveCount(0);
  await expect(
    details.getByRole('button', { name: '카드 저장', exact: true }),
  ).toHaveCount(0);
});
