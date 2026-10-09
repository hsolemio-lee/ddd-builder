import { aggregateReview } from './aggregate.mjs';
export const statuses = {
  hypothesis: '가설',
  proposed: '제안',
  agreed: '합의',
};
export const scenarios = {
  shared: '공통',
  main: '정상 흐름',
  exception: '예외 흐름',
};
export const linkKinds = {
  flow: '흐름',
  related: '관련',
  dependsOn: '선행 조건',
};
export function flowAllowed(source, target) {
  return (
    source.stage === 'events' &&
    target.stage === 'events' &&
    {
      actor: ['command'],
      command: ['event'],
      event: ['policy', 'event'],
      policy: ['command'],
    }[source.kind]?.includes(target.kind) === true
  );
}
export function normalizeCard(card) {
  return {
    status: 'proposed',
    decision: '',
    scenario: 'shared',
    links: [],
    ...card,
  };
}
// These are review prompts, not a correctness score or a gate on exploratory modelling.
export function reviewBoard(cards) {
  const issues = [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const incoming = new Set();
  const duplicates = new Map();
  const roots = new Map();
  const add = (card, code, message) =>
    issues.push({ cardId: card.id, stage: card.stage, code, message });
  const hasContexts = cards.some((c) => c.kind === 'context');
  for (const card of cards) {
    for (const link of card.links || []) {
      const target = byId.get(link.targetId);
      if (!target)
        add(
          card,
          'missing-link',
          '연결 대상이 없습니다. 연결을 다시 확인해 주세요.',
        );
      else if (link.kind === 'flow') {
        incoming.add(target.id);
        if (!flowAllowed(card, target))
          add(card, 'flow-grammar', '흐름의 카드 유형과 방향을 검토해 주세요.');
      }
    }
    const key = `${card.stage}:${card.kind}:${card.contextId || ''}:${card.title.trim().replace(/\s+/g, ' ').toLowerCase()}`;
    if (duplicates.has(key))
      add(
        card,
        'duplicate-title',
        '같은 영역에 같은 이름의 카드가 있습니다. 중복인지 확인해 주세요.',
      );
    else duplicates.set(key, card.id);
    if (
      hasContexts &&
      ['event', 'command', 'policy'].includes(card.kind) &&
      !card.contextId
    )
      add(
        card,
        'unassigned',
        '이 사실·규칙을 소유하는 컨텍스트를 검토해 주세요.',
      );
    if (card.kind === 'aggregate') {
      issues.push(...aggregateReview(card, cards));
      const rootKey = `${card.contextId || ''}:${String(card.data.root || '')
        .trim()
        .toLowerCase()}`;
      if (card.data.root?.trim() && roots.has(rootKey))
        add(
          card,
          'duplicate-root',
          '같은 컨텍스트에 같은 루트 이름이 있습니다. 경계를 확인해 주세요.',
        );
      roots.set(rootKey, card.id);
    }
    if (card.kind === 'context' && !card.description.trim())
      add(
        card,
        'context-responsibility',
        '이 컨텍스트의 언어·책임과 소유하는 정보를 적어 주세요.',
      );
    if (card.status === 'agreed' && !card.decision?.trim())
      add(card, 'agreement-evidence', '합의 근거와 검토자를 기록해 주세요.');
  }
  for (const card of cards) {
    const flows = (card.links || []).filter((l) => l.kind === 'flow');
    if (
      card.kind === 'command' &&
      !flows.some((l) => byId.get(l.targetId)?.kind === 'event')
    )
      add(
        card,
        'command-result',
        '이 명령의 성공·거절 결과 사건을 연결해 주세요.',
      );
    if (
      card.kind === 'policy' &&
      (!incoming.has(card.id) ||
        !flows.some((l) => byId.get(l.targetId)?.kind === 'command'))
    )
      add(
        card,
        'policy-flow',
        '정책을 시작하는 사건과 정책이 요청하는 명령을 연결해 주세요.',
      );
  }
  return {
    issues,
    counts: Object.fromEntries(
      Object.keys(statuses).map((s) => [
        s,
        cards.filter((c) => (c.status || 'proposed') === s).length,
      ]),
    ),
    unansweredQuestions: cards.filter(
      (c) => c.kind === 'question' && c.status !== 'agreed',
    ).length,
    note: '연결과 입력의 빈틈을 찾는 검토 항목입니다. 도메인 모델의 타당성과 업무 규칙은 도메인 담당자와 확인해 주세요.',
  };
}
