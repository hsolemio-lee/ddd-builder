import { test, expect, type Page } from '@playwright/test';

async function join(page: Page) {
  await page.goto('/');
  await page.getByLabel('이름', { exact: true }).fill('DDD 학습');
  await page.getByLabel('접속 코드').fill('workshop-test-code');
  await page
    .getByRole('button', { name: '워크숍 참여하기', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeVisible();
}

test('stage learning, quiz explanations and practice navigation preserve the board', async ({
  page,
}) => {
  await join(page);
  const before = await (await page.request.get('/api/state')).json();
  await page.getByRole('button', { name: '이 단계 이론과 실습' }).click();
  const guide = page.getByRole('dialog', { name: 'DDD 학습 가이드' });
  await expect(
    guide.getByRole('article', { name: '이벤트 정리 학습' }),
  ).toBeVisible();
  await guide.getByText('처음이라면: DDD와 이 보드의 전체 흐름').click();
  await expect(guide.getByText(/전략적 설계는 중요한 업무 영역/)).toBeVisible();
  await guide
    .getByRole('radio', {
      name: '명령과 이벤트는 이름만 다르고 항상 동시에 발생한다',
    })
    .check();
  await expect(guide.getByRole('status')).toContainText('다시 생각해 보세요.');
  await guide
    .getByRole('radio', {
      name: '명령은 요청이며 실패할 수 있고, 이벤트는 발생한 사실이다',
    })
    .check();
  await expect(guide.getByRole('status')).toContainText('맞아요.');
  const nav = guide.getByRole('navigation', { name: '학습 단계' });
  await nav.getByRole('button', { name: '03 컨텍스트 나누기' }).click();
  await expect(guide.getByRole('article')).toHaveAccessibleName(
    '컨텍스트 나누기 학습',
  );
  await expect(guide.getByRole('radio').first()).not.toBeChecked();
  await nav.getByRole('button', { name: '02 이벤트 정리' }).click();
  await expect(
    guide.getByRole('radio', {
      name: '명령은 요청이며 실패할 수 있고, 이벤트는 발생한 사실이다',
    }),
  ).toBeChecked();
  for (const title of [
    '01 도메인 탐색',
    '02 이벤트 정리',
    '03 컨텍스트 나누기',
    '04 애그리게이트 설계',
    '05 구현 체크리스트',
  ]) {
    await nav.getByRole('button', { name: title }).click();
    await expect(
      guide.getByRole('heading', { name: '핵심 이론', exact: true }),
    ).toBeVisible();
    await expect(
      guide.getByRole('heading', { name: '보드에서 실습하기', exact: true }),
    ).toBeVisible();
  }
  await guide.getByRole('button', { name: '이 단계 보드에서 실습' }).click();
  await expect(guide).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: '우리의 설계를 다음 행동으로.' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'DDD 학습 가이드', exact: true })
    .click();
  await expect(guide.getByRole('article')).toHaveAccessibleName(
    '구현 체크리스트 학습',
  );
  await expect(guide.getByRole('radio').first()).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(guide).not.toBeVisible();
  const after = await (await page.request.get('/api/state')).json();
  expect(after).toEqual(before);
});

test('learning guide works on a narrow screen and returns focus on close', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await join(page);
  const trigger = page.getByRole('button', { name: '이 단계 이론과 실습' });
  await trigger.click();
  const guide = page.getByRole('dialog', { name: 'DDD 학습 가이드' });
  await guide
    .getByRole('navigation', { name: '학습 단계' })
    .getByRole('button', { name: '04 애그리게이트 설계' })
    .click();
  await guide
    .getByRole('radio', {
      name: '한 번의 변경에서 반드시 함께 지켜야 하는 업무 불변식',
    })
    .check();
  await expect(guide.getByRole('status')).toContainText('맞아요.');
  expect(
    await guide.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  const link = guide.getByRole('link', { name: /Eric Evans/ });
  await expect(link).toHaveAttribute(
    'href',
    'https://www.domainlanguage.com/ddd/reference/',
  );
  await page.screenshot({ path: '/tmp/ddd-learning-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(guide).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
