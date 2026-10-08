import { test, expect } from '@playwright/test';

const user = {
  id: 'viewer-id',
  name: '조회 팀원',
  email: 'viewer@example.test',
  siteAdmin: false,
};
const project = {
  id: 'private-project',
  name: '권한 확인 프로젝트',
  description: '',
  revision: 1,
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
  updatedBy: '관리자',
  role: 'viewer',
};
const card = {
  id: 'private-card',
  projectId: project.id,
  stage: 'events',
  kind: 'event',
  title: '검토할 도메인 이벤트',
  description: '조회자는 이 상세 내용을 읽을 수 있습니다.',
  revision: 1,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  updatedBy: '관리자',
  contextId: null,
  position: 0,
  data: {},
};

test('OIDC login uses the configured account provider without a shared code', async ({
  page,
}) => {
  await page.route('**/api/auth/config', (route) =>
    route.fulfill({ json: { mode: 'oidc', loginUrl: '/api/auth/login' } }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: '계정으로 로그인' }),
  ).toHaveAttribute('href', '/api/auth/login');
  await expect(page.getByLabel('접속 코드')).toHaveCount(0);
});

test('viewer can inspect cards but cannot edit, reorder, or manage project access', async ({
  page,
}) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { user } }),
  );
  await page.route('**/api/state', (route) =>
    route.fulfill({ json: { projects: [project], cards: [card] } }),
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: state\ndata: ${JSON.stringify({ projects: [project], cards: [card] })}\n\nevent: presence\ndata: []\n\n`,
    }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: '프로젝트 설정' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: `카드 보기: ${card.title}` }).click();
  await expect(
    page
      .getByRole('dialog', { name: card.title })
      .getByText(card.description, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '저장하기', exact: true }),
  ).toHaveCount(0);
});

test('official logout clears browser identity and selected project', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('ddd-name', '이전 이름');
    localStorage.setItem('ddd-project', 'private-project');
  });
  let signed = true;
  await page.route('**/api/auth/config', (route) =>
    route.fulfill({ json: { mode: 'oidc', loginUrl: '/api/auth/login' } }),
  );
  await page.route('**/api/session', (route) => {
    if (route.request().method() === 'DELETE') {
      signed = false;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill(
      signed
        ? { json: { user } }
        : { status: 401, json: { error: '먼저 접속해 주세요.' } },
    );
  });
  await page.route('**/api/state', (route) =>
    route.fulfill(
      signed
        ? { json: { projects: [project], cards: [] } }
        : { status: 401, json: { error: '먼저 접속해 주세요.' } },
    ),
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: state\ndata: ${JSON.stringify({ projects: [project], cards: [] })}\n\n`,
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '워크숍 나가기' }).click();
  await expect(
    page.getByRole('link', { name: '계정으로 로그인' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => [
      localStorage.getItem('ddd-name'),
      localStorage.getItem('ddd-project'),
    ]),
  ).toEqual([null, null]);
});

test('site-admin demotion clears the open admin dialog on stream reconnect', async ({
  page,
}) => {
  let demoted = false;
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { user: { ...user, siteAdmin: !demoted } } }),
  );
  await page.route('**/api/state', (route) =>
    route.fulfill({ json: { projects: [project], cards: [] } }),
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `retry: 50\n\nevent: state\ndata: ${JSON.stringify({ projects: [project], cards: [] })}\n\n`,
    }),
  );
  await page.route('**/api/admin/users', (route) =>
    route.fulfill(
      demoted
        ? { status: 403, json: { error: '권한이 없습니다.' } }
        : {
            json: {
              users: [
                {
                  ...user,
                  email: 'sensitive-admin@example.test',
                  siteAdmin: true,
                  disabled: false,
                },
              ],
            },
          },
    ),
  );
  await page.route('**/api/admin/audit', (route) =>
    route.fulfill({ json: { events: [] } }),
  );
  await page.goto('/');
  await page
    .getByRole('button', { name: '계정과 감사 기록', exact: true })
    .click();
  await expect(
    page.getByText('sensitive-admin@example.test', { exact: false }),
  ).toBeVisible();
  demoted = true;
  await expect(
    page.getByRole('dialog', { name: '계정과 감사 기록' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '계정과 감사 기록', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('sensitive-admin@example.test', { exact: false }),
  ).toHaveCount(0);
});

test('personal MCP setup offers HTTP and preserves stdio configuration', async ({
  page,
}) => {
  await page.route('**/api/auth/config', (route) =>
    route.fulfill({ json: { mode: 'oidc' } }),
  );
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { user } }),
  );
  await page.route('**/api/state', (route) =>
    route.fulfill({ json: { projects: [project], cards: [] } }),
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: state\ndata: ${JSON.stringify({ projects: [project], cards: [] })}\n\n`,
    }),
  );
  await page.route('**/api/info', (route) =>
    route.fulfill({
      json: {
        urls: ['https://ddd.example'],
        mcpHttp: { url: 'https://ddd.example/mcp' },
        mcp: {
          command: 'node',
          args: ['/app/mcp/index.mjs'],
          env: { DDD_URL: 'http://127.0.0.1:3210' },
        },
      },
    }),
  );
  await page.route('**/api/tokens', (route) =>
    route.fulfill({
      json:
        route.request().method() === 'POST'
          ? {
              token: 'test-personal-token',
              credential: { id: 'token-id', scope: 'read' },
            }
          : { tokens: [] },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'AI와 함께 설계하기' }).click();
  await expect(page.getByLabel('연결 방식')).toHaveValue('http');
  await page.getByRole('button', { name: '새 MCP 토큰 만들기' }).click();
  const config = page.locator('.config-block');
  await expect(config).toContainText('https://ddd.example/mcp');
  await expect(config).toContainText('Bearer test-personal-token');
  await page.getByLabel('연결 방식').selectOption('stdio');
  await expect(config).toContainText('/app/mcp/index.mjs');
  await expect(config).toContainText('DDD_READ_ONLY');
  await expect(config).not.toContainText('Authorization');
});
