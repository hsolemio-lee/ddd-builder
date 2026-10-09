import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.goto('/');
  await page.getByLabel('이름', { exact: true }).fill('배치 검토');
  await page.getByLabel('접속 코드').fill('workshop-test-code');
  await page
    .getByRole('button', { name: '워크숍 참여하기', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeVisible();
  const p = await (
    await page.request.post('/api/projects', {
      data: { name: `유연한 배치 ${Date.now()}` },
    })
  ).json();
  const contexts = [];
  for (const title of ['주문', '결제', '재고', '배송']) {
    const context = await (
      await page.request.post(`/api/projects/${p.id}/cards`, {
        data: {
          stage: 'contexts',
          kind: 'context',
          title,
          position: contexts.length,
          description: `${title} 모델의 책임`,
        },
      })
    ).json();
    contexts.push(context);
  }
  await page.request.patch(`/api/cards/${contexts[0].id}`, {
    data: {
      revision: 1,
      links: contexts
        .slice(1)
        .map((c) => ({ kind: 'related', targetId: c.id })),
    },
  });
  let previous;
  for (const [i, kind] of [
    'command',
    'event',
    'policy',
    'command',
    'event',
    'policy',
  ].entries()) {
    const card = await (
      await page.request.post(`/api/projects/${p.id}/cards`, {
        data: {
          stage: 'events',
          kind,
          title: `흐름 ${i + 1}`,
          contextId: contexts[Math.floor(i / 2)].id,
          position: i,
        },
      })
    ).json();
    if (previous)
      await page.request.patch(`/api/cards/${previous.id}`, {
        data: { revision: 1, links: [{ kind: 'flow', targetId: card.id }] },
      });
    previous = card;
  }
  await expect(page.getByLabel('프로젝트 선택')).toContainText(p.name);
  await page.getByLabel('프로젝트 선택').selectOption(p.id);
  return p;
}

test('context regions can move, reset, zoom and expand without changing model data', async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  const before = await (await page.request.get('/api/state')).json();
  const region = page.getByRole('region', {
    name: '컨텍스트 영역: 주문',
    exact: true,
  });
  const start = await region.evaluate((el) => ({
    x: (el as HTMLElement).style.left,
    y: (el as HTMLElement).style.top,
  }));
  await page
    .getByRole('button', { name: '영역 이동: 주문', exact: true })
    .focus();
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => region.evaluate((el) => (el as HTMLElement).style.top))
    .not.toBe(start.y);
  await page.getByRole('button', { name: '자동 배치', exact: true }).click();
  await expect
    .poll(() => region.evaluate((el) => (el as HTMLElement).style.top))
    .toBe(start.y);
  const percent = page.getByLabel('확대 비율');
  await page.getByRole('button', { name: '기본 크기', exact: true }).click();
  await expect(percent).toHaveText('100%');
  await page.getByRole('button', { name: '축소', exact: true }).click();
  await expect(percent).toHaveText('90%');
  await page.getByRole('button', { name: '넓게 보기', exact: true }).click();
  const expanded = page.getByRole('dialog', {
    name: '컨텍스트 경계 지도 넓게 보기',
  });
  await expect(expanded).toBeVisible();
  await expanded
    .getByRole('button', { name: '자동 배치', exact: true })
    .click();
  await expanded
    .getByRole('button', { name: '화면 맞춤', exact: true })
    .click();
  await expect
    .poll(() =>
      expanded
        .locator('.graph-scroll')
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    )
    .toBeLessThanOrEqual(1);
  await expanded
    .getByRole('button', { name: /경계 연결: 주문 · 결제/ })
    .click();
  await expect(expanded).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: '경계 연결 상세', exact: true }),
  ).toContainText('주문');
  await page
    .getByRole('button', { name: '경계 상세 닫기', exact: true })
    .click();
  await page.screenshot({
    path: '/tmp/ddd-context-flexible.png',
    fullPage: true,
  });
  const handle = page.getByRole('button', {
    name: '영역 이동: 주문',
    exact: true,
  });
  const box = await handle.boundingBox();
  const oldTop = await region.evaluate((el) => (el as HTMLElement).style.top);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 30,
    box!.y + box!.height / 2 + 30,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(() => region.evaluate((el) => (el as HTMLElement).style.top))
    .not.toBe(oldTop);
  const after = await (await page.request.get('/api/state')).json();
  expect(after).toEqual(before);
});

test('flow layout switches direction, fits the screen and stays usable on mobile', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '흐름 보기', exact: true }).click();
  await page.getByLabel('흐름 배치 방향').selectOption('horizontal');
  const horizontal = await page
    .locator('.flow-canvas')
    .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  await page.getByLabel('흐름 배치 방향').selectOption('vertical');
  await expect
    .poll(() => page.locator('.flow-canvas').evaluate((el) => el.clientWidth))
    .toBeLessThan(horizontal.width);
  await page.getByRole('button', { name: '넓게 보기', exact: true }).click();
  const expanded = page.getByRole('dialog', { name: '설계 흐름 넓게 보기' });
  await expanded.getByLabel('흐름 배치 방향').selectOption('horizontal');
  await expanded
    .getByRole('button', { name: '화면 맞춤', exact: true })
    .click();
  await expect(expanded.locator('.flow-node')).toHaveCount(6);
  await expect
    .poll(() =>
      expanded
        .locator('.graph-scroll')
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    )
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/ddd-flow-expanded.png' });
  await expanded
    .getByRole('button', { name: '흐름 카드: 흐름 1', exact: true })
    .click();
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('흐름 1');
  await page.keyboard.press('Escape');
  await expect(expanded).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(expanded).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: '넓게 보기', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('흐름 배치 방향').selectOption('auto');
  await page.getByRole('button', { name: '기본 크기', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '흐름 카드: 흐름 1', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '단계 메뉴', exact: true }).click();
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await expect(page.locator('.context-map-lines')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
