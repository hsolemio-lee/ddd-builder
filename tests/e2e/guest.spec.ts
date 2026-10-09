import { test as base, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app.mjs';
import { oidcFixture } from '../fixtures/oidc.mjs';

type Service = { url: string };
const test = base.extend<{ service: Service }>({
  service: async ({}, use) => {
    const fixture = await oidcFixture();
    const reserve = createServer();
    await new Promise<void>((resolve) =>
      reserve.listen(0, '127.0.0.1', resolve),
    );
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const dataDir = await mkdtemp(join(tmpdir(), 'ddd-guest-browser-'));
    const url = `http://127.0.0.1:${port}`;
    const app = await createApp({
      dataDir,
      staticDir: join(process.cwd(), 'dist'),
      host: '127.0.0.1',
      port,
      publicUrl: url,
      auth: {
        mode: 'oidc',
        issuer: fixture.issuer,
        clientId: 'fixture-client',
        clientSecret: 'fixture-secret',
        ownerEmail: 'owner@example.com',
        testOnlyAllowInsecureLoopback: true,
      },
    });
    try {
      await use({ url });
    } finally {
      await app.close();
      await fixture.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  },
});

async function accountLogin(page: Page, service: Service) {
  await page.goto(service.url);
  await page.getByRole('link', { name: '계정으로 로그인' }).click();
  await expect(
    page.getByRole('button', { name: '멤버 관리', exact: true }),
  ).toBeVisible();
  return (await (await page.request.get(`${service.url}/api/state`)).json())
    .projects[0];
}
async function issue(page: Page, role: 'viewer' | 'editor' = 'viewer') {
  await page.getByRole('button', { name: '멤버 관리', exact: true }).click();
  const panel = page.getByRole('region', { name: '게스트 초대 관리' });
  await panel
    .getByRole('checkbox', { name: '이 프로젝트의 게스트 참여 허용' })
    .click();
  await expect(panel.getByRole('checkbox')).toBeChecked();
  await expect(panel.getByLabel('게스트 권한', { exact: true })).toHaveValue(
    'viewer',
  );
  await panel.getByLabel('게스트 초대 이름').fill('외부 검토');
  await panel.getByLabel('게스트 권한', { exact: true }).selectOption(role);
  await panel.getByRole('button', { name: '게스트 초대 코드 발급' }).click();
  const result = panel.getByLabel('발급된 게스트 초대 코드');
  await expect(result).toHaveValue(/.{40,}/);
  const code = await result.inputValue();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  return code;
}
async function guestLogin(
  page: Page,
  service: Service,
  code: string,
  name = '외부 검토자',
) {
  await page.goto(service.url);
  await expect(
    page.getByRole('link', { name: '계정으로 로그인' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '초대 코드로 게스트 참여' }).click();
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByLabel('게스트 초대 코드', { exact: true }).fill(code);
  await page
    .getByRole('button', { name: '게스트로 참여하기', exact: true })
    .click();
  await expect(page.locator('.sidebar-user')).toContainText(`${name} · 게스트`);
}

test('OAuth administrator issues a default viewer invitation and revocation clears the guest workspace', async ({
  page,
  browser,
  service,
}) => {
  const project = await accountLogin(page, service);
  const privateProject = await (
    await page.request.post(`${service.url}/api/projects`, {
      data: { name: '계정 전용 프로젝트' },
    })
  ).json();
  const code = await issue(page);
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  try {
    await guestLogin(guest, service, code);
    await expect(
      guest.getByLabel('프로젝트 선택').locator('option'),
    ).toHaveCount(1);
    await expect(guest.getByLabel('프로젝트 선택')).toHaveValue(project.id);
    await expect(
      guest.getByRole('button', { name: '카드 추가', exact: true }),
    ).toBeDisabled();
    for (const label of [
      '새 프로젝트',
      '프로젝트 설정',
      '멤버 관리',
      '접속 주소',
      'AI와 함께 설계하기',
      '계정과 감사 기록',
    ])
      await expect(
        guest.getByRole('button', { name: label, exact: true }),
      ).toHaveCount(0);
    expect(
      (
        await guest.request.get(
          `${service.url}/api/projects/${privateProject.id}/documents`,
        )
      ).status(),
    ).toBe(404);
    await guest
      .getByRole('button', { name: '결과 내보내기', exact: true })
      .click();
    await expect(
      guest.getByRole('link', { name: /구현 문서 묶음 ZIP/ }),
    ).toBeVisible();
    await guest.getByRole('button', { name: '닫기', exact: true }).click();
    await guest.reload();
    await expect(guest.locator('.sidebar-user')).toContainText('게스트');
    await page.getByRole('button', { name: '멤버 관리', exact: true }).click();
    const panel = page.getByRole('region', { name: '게스트 초대 관리' });
    await expect(panel.getByLabel('발급된 게스트 초대 코드')).toHaveCount(0);
    await expect(
      panel.getByText('외부 검토자 · 게스트', { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole('button', {
        name: '게스트 접근 철회: 외부 검토자',
        exact: true,
      })
      .click();
    await expect(
      guest.getByRole('link', { name: '계정으로 로그인' }),
    ).toBeVisible();
    await expect(guest.getByLabel('프로젝트 선택')).toHaveCount(0);
    expect(
      await guest.evaluate(() => [
        localStorage.getItem('ddd-name'),
        localStorage.getItem('ddd-project'),
      ]),
    ).toEqual([null, null]);
    await guest
      .getByRole('button', { name: '초대 코드로 게스트 참여' })
      .click();
    await guest.getByLabel('이름', { exact: true }).fill('다시 참여');
    await guest.getByLabel('게스트 초대 코드', { exact: true }).fill(code);
    await guest.getByRole('button', { name: '게스트로 참여하기' }).click();
    await expect(guest.getByRole('alert')).toContainText(
      '초대 코드를 사용할 수 없습니다.',
    );
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '멤버 관리', exact: true }),
    ).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test('guest editor collaborates live, loses editing after downgrade and all sessions stop when guests are disabled', async ({
  page,
  browser,
  service,
}) => {
  await accountLogin(page, service);
  const code = await issue(page, 'editor');
  const context = await browser.newContext();
  const guest = await context.newPage();
  try {
    await guestLogin(guest, service, code, '외부 편집자');
    await guest.getByRole('button', { name: '카드 추가', exact: true }).click();
    await guest
      .getByLabel('제목', { exact: true })
      .fill('외부 검토에서 발견한 사건');
    await guest.getByRole('button', { name: '카드 저장', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: '카드 편집: 외부 검토에서 발견한 사건',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: '멤버 관리', exact: true }).click();
    const panel = page.getByRole('region', { name: '게스트 초대 관리' });
    await expect(panel.getByLabel('게스트 권한: 외부 편집자')).toHaveValue(
      'editor',
    );
    await guest
      .getByRole('button', {
        name: '카드 편집: 외부 검토에서 발견한 사건',
        exact: true,
      })
      .click();
    await guest
      .getByLabel('설명', { exact: true })
      .fill('권한 변경 시 제거할 미저장 내용');
    await panel.getByLabel('게스트 권한: 외부 편집자').selectOption('viewer');
    await expect(guest.getByRole('dialog', { name: '카드 편집' })).toHaveCount(
      0,
    );
    await expect(
      guest.getByRole('button', { name: '카드 추가', exact: true }),
    ).toBeDisabled();
    await guest
      .getByRole('button', {
        name: '카드 보기: 외부 검토에서 발견한 사건',
        exact: true,
      })
      .click();
    await expect(
      guest.getByRole('dialog', { name: '외부 검토에서 발견한 사건' }),
    ).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await panel
      .getByRole('checkbox', { name: '이 프로젝트의 게스트 참여 허용' })
      .click();
    await expect(panel.getByRole('checkbox')).not.toBeChecked();
    await expect(
      guest.getByRole('link', { name: '계정으로 로그인' }),
    ).toBeVisible();
    await expect(
      guest.getByRole('dialog', { name: '외부 검토에서 발견한 사건' }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole('button', { name: '게스트 초대 코드 발급' }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('guest login and invitation controls fit narrow screens while the account login remains available', async ({
  page,
  browser,
  service,
}) => {
  await accountLogin(page, service);
  await page.getByRole('button', { name: '멤버 관리', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByRole('region', { name: '게스트 초대 관리' });
  await panel
    .getByRole('checkbox', { name: '이 프로젝트의 게스트 참여 허용' })
    .click();
  await expect(panel.getByRole('checkbox')).toBeChecked();
  await panel.getByRole('button', { name: '게스트 초대 코드 발급' }).click();
  await expect(panel.getByLabel('발급된 게스트 초대 코드')).toHaveValue(
    /.{40,}/,
  );
  expect(
    await page
      .getByRole('dialog')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '/tmp/ddd-guest-management-mobile.png',
    fullPage: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const guest = await context.newPage();
  try {
    await guest.goto(service.url + '/#guest');
    await expect(
      guest.getByLabel('게스트 초대 코드', { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole('link', { name: '계정으로 로그인' }),
    ).toBeVisible();
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.screenshot({
      path: '/tmp/ddd-guest-login-mobile.png',
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
