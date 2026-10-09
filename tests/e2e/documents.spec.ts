import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.goto('/');
  await page.getByLabel('이름', { exact: true }).fill('문서 작성자');
  await page.getByLabel('접속 코드').fill('workshop-test-code');
  await page
    .getByRole('button', { name: '워크숍 참여하기', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '카드 추가', exact: true }),
  ).toBeVisible();
  const project = await (
    await page.request.post('/api/projects', {
      data: { name: `도메인 문서 ${Date.now()}` },
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
    title: '생산계획',
    description: '계획 수립과 확정',
  });
  const other = await create({
    stage: 'contexts',
    kind: 'context',
    title: '생산 실행 "v1"',
  });
  const command = await create({
    stage: 'events',
    kind: 'command',
    title: '계획 수량 변경',
    contextId: context.id,
  });
  const policy = await create({
    stage: 'events',
    kind: 'policy',
    title: '작업지시 준비',
    contextId: other.id,
  });
  await create({
    stage: 'events',
    kind: 'event',
    title: '계획이 확정되었다',
    contextId: context.id,
    links: [{ kind: 'flow', targetId: policy.id }],
  });
  await expect(page.getByLabel('프로젝트 선택')).toContainText(project.name);
  await page.getByLabel('프로젝트 선택').selectOption(project.id);
  return { project, context, other, command };
}

test('context details and scoped glossary persist into preview, downloads and shared API documents', async ({
  page,
}) => {
  const { project, context, other } = await setup(page);
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await page.getByRole('button', { name: '카드 보기', exact: true }).click();
  await page
    .getByRole('button', { name: '카드 편집: 생산계획', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '카드 편집' });
  await editor.getByText('구현 문서용 상세 항목', { exact: true }).click();
  await editor
    .getByLabel('컨텍스트 목적', { exact: true })
    .fill('실행 가능한 계획을 수립한다.');
  await editor
    .getByLabel('책임 밖의 일', { exact: true })
    .fill('현장 작업 실행');
  await editor
    .getByLabel('소유 데이터·규칙', { exact: true })
    .fill('계획 수량과 확정 상태');
  await editor
    .getByLabel('연동 계약', { exact: true })
    .fill('계획확정됨 v1을 생산 실행에 전달한다.');
  await editor.getByRole('button', { name: '카드 저장', exact: true }).click();
  await page
    .getByRole('button', { name: '도메인 탐색 단계', exact: true })
    .click();
  await page.getByRole('button', { name: '카드 추가', exact: true }).click();
  await page.getByLabel('카드 유형', { exact: true }).selectOption('term');
  await page.getByLabel('제목', { exact: true }).fill('생산계획 수량');
  await page.getByLabel('설명', { exact: true }).fill('생산하기로 계획한 수량');
  await page
    .getByLabel('소속 컨텍스트', { exact: true })
    .selectOption(context.id);
  await page.getByText('구현 문서용 상세 항목', { exact: true }).click();
  await page.getByLabel('코드명', { exact: true }).fill('PlannedQuantity');
  await page
    .getByLabel('구별 사례', { exact: true })
    .fill('실제 생산한 수량과 구분한다.');
  await page
    .getByLabel('혼동하면 안 되는 용어', { exact: true })
    .fill('실적 수량');
  await page
    .getByLabel('정의의 출처', { exact: true })
    .fill('계획 담당자 검토');
  await page.getByLabel('카드 유형', { exact: true }).selectOption('problem');
  await expect(page.getByLabel('코드명', { exact: true })).toHaveCount(0);
  await page.getByLabel('카드 유형', { exact: true }).selectOption('term');
  await expect(page.getByLabel('코드명', { exact: true })).toHaveValue(
    'PlannedQuantity',
  );
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  await page.reload();
  await page
    .getByRole('button', { name: '도메인 탐색 단계', exact: true })
    .click();
  await page
    .getByRole('button', { name: '카드 편집: 생산계획 수량', exact: true })
    .click();
  await page.getByText('구현 문서용 상세 항목', { exact: true }).click();
  await expect(page.getByLabel('구별 사례', { exact: true })).toHaveValue(
    '실제 생산한 수량과 구분한다.',
  );
  await page.keyboard.press('Escape');
  const documents = await (
    await page.request.get(`/api/projects/${project.id}/documents`)
  ).json();
  const map = documents.files.find((f: { path: string }) =>
    f.path.endsWith('context-map.md'),
  ).content;
  const diagram = map.match(/```mermaid\n([\s\S]*?)\n```/)[1];
  await page
    .getByRole('button', { name: '컨텍스트 나누기 단계', exact: true })
    .click();
  await page.getByRole('button', { name: '카드 보기', exact: true }).click();
  await page
    .getByRole('button', { name: '카드 편집: 생산계획', exact: true })
    .click();
  await page.getByLabel('컨텍스트 관계 형식').selectOption('mermaid');
  await page.getByLabel('Mermaid 다이어그램', { exact: true }).fill(diagram);
  await expect(
    page
      .getByRole('dialog')
      .getByRole('img', { name: '컨텍스트 관계 다이어그램' }),
  ).toBeVisible({ timeout: 20000 });
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: '결과 내보내기', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '결과 내보내기' });
  await dialog.getByLabel('문서 범위').selectOption(context.id);
  await dialog.getByText('생성 문서 미리보기', { exact: true }).click();
  const path = `docs/domain/context-${context.id}/glossary.md`;
  await expect(dialog.getByLabel('미리볼 문서')).toContainText(path);
  await dialog.getByLabel('미리볼 문서').selectOption(path);
  await expect(dialog.getByLabel('문서 내용')).toContainText('PlannedQuantity');
  await expect(dialog.getByLabel('문서 내용')).toContainText(
    '실제 생산한 수량과 구분한다.',
  );
  await expect(dialog.getByLabel('미리볼 문서')).not.toContainText(
    `context-${other.id}`,
  );
  await dialog
    .getByLabel('미리볼 문서')
    .selectOption(`docs/domain/context-${context.id}/context.md`);
  await expect(dialog.getByLabel('문서 내용')).toContainText(
    '실행 가능한 계획을 수립한다.',
  );
  await expect(dialog.getByLabel('문서 내용')).toContainText('미작성');
  await expect(
    dialog.getByRole('link', { name: /구현 문서 묶음 ZIP/ }),
  ).toHaveAttribute(
    'href',
    `/api/projects/${project.id}/export?format=documents&contextId=${context.id}`,
  );
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('link', { name: /구현 문서 묶음 ZIP/ }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.zip$/);
  const response = await page.request.get(
    `/api/projects/${project.id}/documents?contextId=${context.id}&path=${encodeURIComponent(`docs/domain/context-${context.id}/context.md`)}`,
  );
  const apiDocument = (await response.json()).files[0].content;
  expect(await dialog.getByLabel('문서 내용').textContent()).toBe(apiDocument);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '/tmp/ddd-documents-mobile.png',
    fullPage: true,
  });
});

test('rule detail, boundary scenarios and test references are saved without inserting instructional examples', async ({
  page,
}) => {
  const { project, context } = await setup(page);
  await page
    .getByRole('button', { name: '애그리게이트 설계 단계', exact: true })
    .click();
  await page.getByRole('button', { name: '카드 추가', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill('계획');
  await page
    .getByLabel('애그리게이트 루트', { exact: true })
    .fill('ProductionPlan');
  await page
    .getByLabel('소속 컨텍스트', { exact: true })
    .selectOption(context.id);
  await page.getByText('구현 문서용 상세 항목', { exact: true }).click();
  await page
    .getByLabel('트랜잭션 경계', { exact: true })
    .fill('계획과 항목을 함께 저장한다.');
  await page
    .getByRole('checkbox', { name: '처리 명령: 계획 수량 변경', exact: true })
    .check();
  await page
    .getByRole('button', { name: '업무 규칙 추가', exact: true })
    .click();
  await page
    .getByLabel('규칙 내용 1', { exact: true })
    .fill('확정 계획 수량을 직접 변경할 수 없다.');
  await page.getByText('규칙의 적용 조건·예외·근거', { exact: true }).click();
  await page
    .getByLabel('규칙 1 상태', { exact: true })
    .selectOption('proposed');
  await page.getByLabel('규칙 1 적용 조건', { exact: true }).fill('CONFIRMED');
  await page
    .getByLabel('규칙 1 위반 결과', { exact: true })
    .fill('요청 거절, 수량과 상태 유지');
  await page
    .getByLabel('규칙 1 미결정 사항', { exact: true })
    .fill('확정 취소 후 수정 가능한가?');
  await page
    .getByRole('checkbox', { name: '규칙 1 명령: 계획 수량 변경', exact: true })
    .check();
  await page
    .getByRole('button', { name: '규칙 1 검증 사례 추가', exact: true })
    .click();
  await page
    .getByLabel('규칙 1 사례 1 구분', { exact: true })
    .selectOption('boundary');
  await page
    .getByLabel('규칙 1 사례 1 given', { exact: true })
    .fill('계획 수량 0');
  await page
    .getByLabel('규칙 1 사례 1 when', { exact: true })
    .fill('수량 1로 변경 요청');
  await page
    .getByLabel('규칙 1 사례 1 then', { exact: true })
    .fill('기존 수량 유지');
  await page
    .getByLabel('규칙 1 사례 1 관련 테스트 위치', { exact: true })
    .fill('tests/domain/plan.test.ts');
  await page.getByRole('button', { name: '카드 저장', exact: true }).click();
  const bundle = await (
    await page.request.get(
      `/api/projects/${project.id}/documents?contextId=${context.id}`,
    )
  ).json();
  const rules = bundle.files.find((f: { path: string }) =>
    f.path.endsWith('/rules.md'),
  ).content;
  expect(rules).toContain('확정 취소 후 수정 가능한가?');
  expect(rules).toContain('규칙 상태: 제안');
  expect(rules).not.toContain(
    '원본 계획을 참조하는 변경안을 별도로 생성할 수 있다.',
  );
  const cases = bundle.files.find((f: { path: string }) =>
    f.path.endsWith('/scenarios.md'),
  ).content;
  expect(cases).toContain('경계값');
  expect(cases).toContain('tests/domain/plan.test.ts');
  await page
    .getByRole('button', { name: '이 단계 이론과 실습', exact: true })
    .click();
  const guide = page.getByRole('dialog', { name: 'DDD 학습 가이드' });
  await guide
    .getByText('애그리게이트 항목별 작성 예시', { exact: true })
    .click();
  await expect(
    guide.getByRole('heading', { name: '트랜잭션 경계', exact: true }),
  ).toBeVisible();
  await guide
    .getByText('AI 구현을 위한 문서 작성과 운영', { exact: true })
    .click();
  await expect(guide.getByText(/PLAN-001 · 제안/)).toBeVisible();
  await expect(
    guide.getByText(/실제 요구사항이나 확정된 정책이 아닙니다/),
  ).toBeVisible();
});
