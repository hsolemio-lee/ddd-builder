import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, name = '사건 정리') {
  await page.goto('/');
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByLabel('접속 코드').fill('workshop-test-code');
  await page
    .getByRole('button', { name: '워크숍 참여하기', exact: true })
    .click();
  await expect(page.getByLabel('프로젝트 선택')).toBeVisible();
}
async function fixture(page: Page) {
  await setup(page);
  const project = await (
    await page.request.post('/api/projects', {
      data: { name: `이벤트 이야기 ${Date.now()}` },
    })
  ).json();
  const cards = [];
  for (const [i, title] of [
    '신청이 접수됨',
    '검토가 완료됨',
    '결과가 공유됨',
  ].entries()) {
    cards.push(
      await (
        await page.request.post(`/api/projects/${project.id}/cards`, {
          data: {
            stage: 'events',
            kind: 'event',
            title,
            position: i,
            scenario: i === 0 ? 'main' : i === 2 ? 'exception' : 'shared',
            status: i === 0 ? 'agreed' : 'proposed',
            decision: i === 0 ? '참여자 검토 기록' : '',
          },
        })
      ).json(),
    );
  }
  const command = await (
    await page.request.post(`/api/projects/${project.id}/cards`, {
      data: {
        stage: 'events',
        kind: 'command',
        title: '신청 검토',
        position: 30,
      },
    })
  ).json();
  await expect(page.getByLabel('프로젝트 선택')).toContainText(project.name);
  await page.getByLabel('프로젝트 선택').selectOption(project.id);
  await expect(page.locator('.event-story-list > li')).toHaveCount(3);
  return { project, cards, command };
}
const order = (page: Page) =>
  page
    .locator('.event-story-list > li')
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-event-id')),
    );
async function state(page: Page, projectId: string) {
  return (await (await page.request.get('/api/state')).json()).cards.filter(
    (c: { projectId: string }) => c.projectId === projectId,
  );
}
async function saveDraft(page: Page, title: string) {
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '새 카드 만들기' }),
  ).toHaveCount(0);
}

test('unlinked events are visible by default and keyboard/drag ordering is shared and persisted', async ({
  page,
  browser,
}) => {
  const { project, cards, command } = await fixture(page);
  const [a, b, c] = cards;
  await expect(
    page.getByRole('button', { name: '사건 순서', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const context = await browser.newContext();
  const peer = await context.newPage();
  try {
    await setup(peer, '함께 정리');
    await peer.getByLabel('프로젝트 선택').selectOption(project.id);
    await page
      .getByRole('button', { name: `순서 이동: ${c.title}`, exact: true })
      .focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => order(page)).toEqual([a.id, c.id, b.id]);
    await expect.poll(() => order(peer)).toEqual([a.id, c.id, b.id]);
    const handle = page.getByRole('button', {
      name: `순서 이동: ${b.title}`,
      exact: true,
    });
    await expect(handle).toBeEnabled();
    await handle.dragTo(page.locator(`[data-event-id="${a.id}"]`), {
      targetPosition: { x: 15, y: 80 },
    });
    await expect.poll(() => order(page)).toEqual([b.id, a.id, c.id]);
    await expect.poll(() => order(peer)).toEqual([b.id, a.id, c.id]);
    await page.reload();
    await expect.poll(() => order(page)).toEqual([b.id, a.id, c.id]);
    const saved = await state(page, project.id);
    expect(saved.find((x: { id: string }) => x.id === command.id)).toEqual(
      command,
    );
    expect(
      saved
        .filter((x: { kind: string }) => x.kind === 'event')
        .every((x: { links: unknown[] }) => x.links.length === 0),
    ).toBe(true);
    expect(saved.find((x: { id: string }) => x.id === a.id).status).toBe(
      'agreed',
    );
    await page.getByRole('button', { name: '흐름 보기', exact: true }).click();
    for (const card of [...cards, command])
      await expect(
        page.getByRole('button', {
          name: `흐름 카드: ${card.title}`,
          exact: true,
        }),
      ).toBeVisible();
    expect(await page.locator('.flow-unconnected').count()).toBe(4);
    await page.getByRole('button', { name: '사건 순서', exact: true }).click();
    await page.screenshot({
      path: 'test-results/event-story-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: 'test-results/event-story-mobile.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test('events can be inserted before/after an anchor and appended without inferred connections', async ({
  page,
}) => {
  const { project, cards } = await fixture(page);
  await page
    .getByRole('button', {
      name: `앞에 사건 추가: ${cards[1].title}`,
      exact: true,
    })
    .click();
  await expect(page.getByLabel('카드 유형', { exact: true })).toBeDisabled();
  await saveDraft(page, '사전 확인이 끝남');
  await page
    .getByRole('button', {
      name: `뒤에 사건 추가: ${cards[1].title}`,
      exact: true,
    })
    .click();
  await saveDraft(page, '후속 확인이 끝남');
  await page.getByRole('button', { name: '사건 추가', exact: true }).click();
  await saveDraft(page, '기록이 보관됨');
  const saved = (await state(page, project.id))
    .filter((c: { kind: string }) => c.kind === 'event')
    .sort(
      (a: { position: number }, b: { position: number }) =>
        a.position - b.position,
    );
  expect(saved.map((c: { title: string }) => c.title)).toEqual([
    '신청이 접수됨',
    '사전 확인이 끝남',
    '검토가 완료됨',
    '후속 확인이 끝남',
    '결과가 공유됨',
    '기록이 보관됨',
  ]);
  expect(saved.every((c: { links: unknown[] }) => c.links.length === 0)).toBe(
    true,
  );
});

test('direct connections preserve unrelated links, require review after concurrent edits and expose branches/loops', async ({
  page,
}) => {
  const { project, cards, command } = await fixture(page);
  const [a, b, c] = cards;
  await page.request.patch(`/api/cards/${a.id}`, {
    data: {
      revision: a.revision,
      status: 'agreed',
      links: [
        { kind: 'flow', targetId: b.id },
        { kind: 'related', targetId: command.id },
      ],
    },
  });
  await page
    .getByRole('button', { name: '흐름 연결 편집', exact: true })
    .click();
  await page.getByLabel('흐름 출발 카드').selectOption(a.id);
  const latest = (await state(page, project.id)).find(
    (x: { id: string }) => x.id === a.id,
  );
  await page.request.patch(`/api/cards/${a.id}`, {
    data: { revision: latest.revision, description: '동료가 수정한 설명' },
  });
  await expect(
    page.getByRole('button', { name: '최신 연결 불러오기', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '흐름 연결 추가', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: '최신 연결 불러오기', exact: true })
    .click();
  await page.getByLabel('흐름 대상 카드').selectOption(c.id);
  await page
    .getByRole('button', { name: '흐름 연결 추가', exact: true })
    .click();
  await expect(page.getByLabel('흐름 출발 카드')).toHaveValue('');
  for (const [from, to] of [
    [c, b],
    [b, a],
  ]) {
    await page.getByLabel('흐름 출발 카드').selectOption(from.id);
    await page.getByLabel('흐름 대상 카드').selectOption(to.id);
    await page
      .getByRole('button', { name: '흐름 연결 추가', exact: true })
      .click();
    await expect(page.getByLabel('흐름 출발 카드')).toHaveValue('');
  }
  await page.getByRole('button', { name: '흐름 보기', exact: true }).click();
  await expect(
    page.locator('.flow-canvas svg path[stroke="#668071"]'),
  ).toHaveCount(4);
  expect(
    await page.locator('.flow-canvas svg path[stroke-dasharray="5 4"]').count(),
  ).toBeGreaterThan(0);
  await page
    .getByRole('button', {
      name: `흐름 연결: ${a.title} → ${b.title}`,
      exact: true,
    })
    .focus();
  await page.keyboard.press('Enter');
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(`**/api/cards/${a.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      started();
      await held;
    }
    await route.continue();
  });
  try {
    await page
      .getByRole('button', {
        name: `흐름 연결 삭제: ${a.title} → ${b.title}`,
        exact: true,
      })
      .click();
    await requested;
    await expect(page.getByLabel('흐름 출발 카드')).toBeDisabled();
    await expect(
      page.getByRole('button', { name: '연결 편집 닫기', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('button', {
        name: `흐름 연결: ${c.title} → ${b.title}`,
        exact: true,
      })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('흐름 출발 카드')).toHaveValue(a.id);
  } finally {
    release();
  }
  await expect(page.getByLabel('흐름 출발 카드')).toHaveValue('');
  const result = (await state(page, project.id)).find(
    (x: { id: string }) => x.id === a.id,
  );
  expect(result.links).toEqual([
    { kind: 'related', targetId: command.id },
    { kind: 'flow', targetId: c.id },
  ]);
  expect(result.description).toBe('동료가 수정한 설명');
  expect(result.status).toBe('proposed');
});

test('a deleted insertion anchor keeps the draft and lets the author choose the end', async ({
  page,
}) => {
  const { project, cards } = await fixture(page);
  await page
    .getByRole('button', {
      name: `뒤에 사건 추가: ${cards[0].title}`,
      exact: true,
    })
    .click();
  await page.getByLabel('제목', { exact: true }).fill('유지할 초안 사건');
  await page.request.delete(`/api/cards/${cards[0].id}`, {
    data: { revision: cards[0].revision },
  });
  await expect(
    page.getByRole('region', { name: '사건 삽입 위치' }),
  ).toContainText('기준 사건을 확인할 수 없습니다.');
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('삽입 기준');
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue(
    '유지할 초안 사건',
  );
  await page
    .getByRole('button', { name: '끝에 추가로 변경', exact: true })
    .click();
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '새 카드 만들기' }),
  ).toHaveCount(0);
  const saved = (await state(page, project.id))
    .filter((c: { kind: string }) => c.kind === 'event')
    .sort(
      (a: { position: number }, b: { position: number }) =>
        a.position - b.position,
    );
  expect(saved.at(-1).title).toBe('유지할 초안 사건');
  expect(saved).toHaveLength(3);
});

test('filtered events cannot reorder hidden cards and non-event filters reveal auxiliary cards', async ({
  page,
}) => {
  const { cards, command } = await fixture(page);
  await page.getByLabel('흐름 필터').selectOption('main');
  await expect(page.locator('.event-story-list > li')).toHaveCount(2);
  await expect(
    page.getByRole('button', {
      name: `순서 이동: ${cards[0].title}`,
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', {
      name: `앞에 사건 추가: ${cards[0].title}`,
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByLabel('흐름 필터').selectOption('all');
  await page.getByLabel('카드 유형 필터').selectOption('command');
  await expect(
    page.getByRole('button', {
      name: `카드 편집: ${command.title}`,
      exact: true,
    }),
  ).toBeVisible();
});

test('viewers can read event order and links but cannot reorder, insert or mutate connections', async ({
  page,
}) => {
  const project = {
    id: 'viewer-story',
    name: '읽기 전용 이야기',
    description: '',
    revision: 1,
    role: 'viewer',
  };
  const cards = [
    {
      id: 'first',
      projectId: project.id,
      stage: 'events',
      kind: 'event',
      title: '첫 사건',
      description: '조회할 설명',
      revision: 1,
      position: 0,
      data: {},
      contextId: null,
      links: [{ kind: 'flow', targetId: 'last' }],
    },
    {
      id: 'last',
      projectId: project.id,
      stage: 'events',
      kind: 'event',
      title: '끝 사건',
      revision: 1,
      position: 1,
      data: {},
      links: [],
    },
  ];
  const snapshot = { projects: [project], cards };
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && !['GET', 'HEAD'].includes(r.method()))
      writes.push(r.url());
  });
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        user: { id: 'viewer', name: '조회자', email: 'viewer@example.test' },
      },
    }),
  );
  await page.route('**/api/state', (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: state\ndata: ${JSON.stringify(snapshot)}\n\n`,
    }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '순서 이동: 첫 사건', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '앞에 사건 추가: 첫 사건', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: '카드 보기: 첫 사건', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '첫 사건' })).toContainText(
    '조회할 설명',
  );
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page
    .getByRole('button', { name: '흐름 연결 편집', exact: true })
    .click();
  await page.getByLabel('흐름 출발 카드').selectOption('first');
  await expect(
    page.getByRole('region', { name: '흐름 연결 편집' }),
  ).toContainText('첫 사건 → 끝 사건');
  await expect(
    page.getByRole('button', { name: '흐름 연결 추가', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '연결 삭제', exact: true }),
  ).toHaveCount(0);
  expect(writes).toEqual([]);
});
