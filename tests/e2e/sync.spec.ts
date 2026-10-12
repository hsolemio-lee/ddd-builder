import { test, expect, type Page } from '@playwright/test';

const user = {
  id: 'sync-user',
  name: '동기화 참여자',
  email: 'sync@example.test',
};
const project = {
  id: 'sync-project',
  name: '동기화 검증',
  description: '',
  role: 'viewer',
  revision: 1,
  createdAt: '2026-10-12T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
  updatedBy: '참여자',
};
const card = {
  id: 'sync-card',
  projectId: project.id,
  stage: 'events',
  kind: 'event',
  title: '처음 받은 상태',
  description: '',
  revision: 1,
  contextId: null,
  position: 0,
  data: {},
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  updatedBy: '참여자',
};
const state = { projects: [project], cards: [card] };

async function setup(page: Page) {
  await page.clock.install();
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  const counts = { session: 0, state: 0, events: 0 };
  await page.route('**/api/session', (route) => {
    counts.session++;
    return route.fulfill({ json: { user } });
  });
  await page.route('**/api/state', (route) => {
    counts.state++;
    return route.fulfill({ json: state });
  });
  return counts;
}

test('repeated SSE failure bounds REST snapshots and still displays a read-only board', async ({
  page,
}) => {
  const counts = await setup(page);
  await page.route('**/api/events', (route) => {
    counts.events++;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: ': disconnected\n\n',
    });
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: `카드 보기: ${card.title}` }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeDisabled();
  expect(counts.state).toBe(1);
  await page.clock.runFor(3_000);
  await expect.poll(() => counts.events).toBe(2);
  await page.clock.runFor(6_000);
  await expect.poll(() => counts.events).toBe(3);
  await page.clock.runFor(3_500);
  await expect.poll(() => counts.session).toBe(4);
  expect(counts).toEqual({ session: 4, state: 1, events: 3 });
});

test('reconnect uses the new SSE snapshot without a duplicate REST state request', async ({
  page,
}) => {
  const counts = await setup(page);
  await page.route('**/api/events', (route) => {
    counts.events++;
    const next =
      counts.events === 1
        ? state
        : {
            ...state,
            cards: [
              { ...card, title: '재연결에서 받은 최신 상태', revision: 2 },
            ],
          };
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `event: state\ndata: ${JSON.stringify(next)}\n\n`,
    });
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: `카드 보기: ${card.title}` }),
  ).toBeVisible();
  await page.clock.runFor(3_000);
  await expect(
    page.getByRole('button', { name: '카드 보기: 재연결에서 받은 최신 상태' }),
  ).toBeVisible();
  await expect.poll(() => counts.session).toBe(3);
  expect(counts).toEqual({ session: 3, state: 0, events: 2 });
});

test('hidden tabs pause retries and refresh the board after becoming visible', async ({
  page,
}) => {
  const counts = await setup(page);
  let resumed = false;
  await page.route('**/api/events', (route) => {
    counts.events++;
    return route.fulfill({
      contentType: 'text/event-stream',
      body: resumed
        ? `event: state\ndata: ${JSON.stringify({ ...state, cards: [{ ...card, title: '탭 복귀 후 최신 상태' }] })}\n\n`
        : ': disconnected\n\n',
    });
  });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: `카드 보기: ${card.title}` }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const paused = { ...counts };
  await page.clock.runFor(180_000);
  expect(counts).toEqual(paused);
  resumed = true;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(
    page.getByRole('button', { name: '카드 보기: 탭 복귀 후 최신 상태' }),
  ).toBeVisible();
  expect(counts.events).toBe(paused.events + 1);
  await expect.poll(() => counts.session).toBe(paused.session + 2);
  expect(counts.state).toBe(paused.state);
});
