import { ruleFields } from './documentation-fields.mjs';
import { z } from 'zod';

const id = z.string().min(1).max(100);
const text = z.string().max(2000);
export const exampleSchema = z
  .object({
    id,
    title: z.string().max(200).default(''),
    type: z
      .enum(['normal', 'rejection', 'boundary', 'concurrency'])
      .default('normal'),
    given: text.default(''),
    when: text.default(''),
    then: text.default(''),
    testReferences: text.optional(),
  })
  .strict();
export const ruleSchema = z
  .object({
    id,
    statement: text.default(''),
    status: z.enum(['hypothesis', 'proposed', 'agreed', 'retired']).optional(),
    ...Object.fromEntries(ruleFields.map((f) => [f.key, text.optional()])),
    commandIds: z.array(id).max(100).default([]),
    examples: z.array(exampleSchema).max(20).default([]),
  })
  .strict();
export const aggregateDesignSchema = z
  .object({
    commandIds: z.array(id).max(100).default([]),
    rules: z.array(ruleSchema).max(40).default([]),
    externalReferences: z
      .array(z.object({ aggregateId: id, reason: text.default('') }).strict())
      .max(40)
      .default([]),
    coordination: z.string().max(20000).default(''),
  })
  .strict();
const examplePatch = z
  .object({
    id,
    title: z.string().max(200).optional(),
    type: z.enum(['normal', 'rejection', 'boundary', 'concurrency']).optional(),
    given: text.optional(),
    when: text.optional(),
    then: text.optional(),
    testReferences: text.optional(),
  })
  .strict();
export const aggregatePatchSchema = z
  .object({
    commandIds: z.array(id).max(100).optional(),
    externalReferences: z
      .array(z.object({ aggregateId: id, reason: text.default('') }).strict())
      .max(40)
      .optional(),
    coordination: z.string().max(20000).optional(),
    upsertRules: z
      .array(
        z
          .object({
            id,
            statement: text.optional(),
            status: z
              .enum(['hypothesis', 'proposed', 'agreed', 'retired'])
              .optional(),
            ...Object.fromEntries(
              ruleFields.map((f) => [f.key, text.optional()]),
            ),
            commandIds: z.array(id).max(100).optional(),
            upsertExamples: z.array(examplePatch).max(20).optional(),
            removeExampleIds: z.array(id).max(20).optional(),
          })
          .strict(),
      )
      .max(40)
      .optional(),
    removeRuleIds: z.array(id).max(40).optional(),
  })
  .strict();
function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success)
    invalid(
      `애그리게이트 설계 형식이 올바르지 않습니다: ${result.error.issues[0].path.join('.') || '설계'}`,
    );
  return result.data;
}
function unique(ids, label) {
  if (new Set(ids).size !== ids.length)
    invalid(`${label} ID를 중복 지정할 수 없습니다.`);
}
export function aggregateDesignOf(card) {
  return (
    card.aggregateDesign || {
      commandIds: [],
      rules: [],
      externalReferences: [],
      coordination: '',
    }
  );
}
export function validateAggregateDesign(raw, card, cards) {
  const design = parse(aggregateDesignSchema, raw);
  unique(design.commandIds, '명령');
  unique(
    design.rules.map((r) => r.id),
    '규칙',
  );
  unique(
    design.externalReferences.map((r) => r.aggregateId),
    '외부 참조',
  );
  const byId = new Map(
    cards.filter((c) => c.projectId === card.projectId).map((c) => [c.id, c]),
  );
  for (const commandId of design.commandIds) {
    const command = byId.get(commandId);
    if (
      !command ||
      command.kind !== 'command' ||
      command.stage !== 'events' ||
      command.contextId !== card.contextId
    )
      invalid('처리 명령은 같은 프로젝트·컨텍스트의 명령 카드여야 합니다.');
    if (
      cards.some(
        (c) =>
          c.projectId === card.projectId &&
          c.id !== card.id &&
          c.kind === 'aggregate' &&
          aggregateDesignOf(c).commandIds.includes(commandId),
      )
    )
      invalid(
        '하나의 명령을 처리하는 애그리게이트가 이미 있습니다. 처리 책임을 검토해 주세요.',
      );
  }
  for (const rule of design.rules) {
    unique(rule.commandIds, '규칙의 명령');
    unique(
      rule.examples.map((e) => e.id),
      '검증 사례',
    );
    if (rule.commandIds.some((id) => !design.commandIds.includes(id)))
      invalid(
        '규칙의 명령은 이 애그리게이트가 처리하는 명령에서 선택해 주세요.',
      );
  }
  for (const ref of design.externalReferences) {
    const target = byId.get(ref.aggregateId);
    if (!target || target.kind !== 'aggregate' || target.id === card.id)
      invalid('외부 참조는 같은 프로젝트의 다른 애그리게이트여야 합니다.');
  }
  return design;
}
function mergeEntries(existing, upserts = [], removes = [], merge) {
  unique(
    upserts.map((item) => item.id),
    '수정 항목',
  );
  unique(removes, '삭제 항목');
  if (removes.some((id) => upserts.some((item) => item.id === id)))
    invalid('같은 항목을 동시에 수정하고 삭제할 수 없습니다.');
  if (removes.some((id) => !existing.some((item) => item.id === id)))
    invalid('삭제할 항목을 찾을 수 없습니다. 최신 설계를 확인해 주세요.');
  const result = existing.filter((item) => !removes.includes(item.id));
  for (const patch of upserts) {
    const index = result.findIndex((item) => item.id === patch.id);
    const item = merge(index < 0 ? undefined : result[index], patch);
    if (index < 0) result.push(item);
    else result[index] = item;
  }
  return result;
}
export function patchAggregateDesign(current, raw) {
  const patch = parse(aggregatePatchSchema, raw);
  if (!Object.keys(patch).length) invalid('수정할 설계 항목이 필요합니다.');
  const result = { ...aggregateDesignOf(current) };
  for (const key of ['commandIds', 'externalReferences', 'coordination'])
    if (patch[key] !== undefined) result[key] = patch[key];
  result.rules = mergeEntries(
    result.rules,
    patch.upsertRules,
    patch.removeRuleIds,
    (existing, update) => {
      const { upsertExamples, removeExampleIds, ...fields } = update;
      const rule = {
        id: update.id,
        statement: '',
        commandIds: [],
        ...existing,
        ...fields,
      };
      rule.examples = mergeEntries(
        existing?.examples || [],
        upsertExamples,
        removeExampleIds,
        (example, values) => ({
          title: '',
          type: 'normal',
          given: '',
          when: '',
          then: '',
          ...example,
          ...values,
        }),
      );
      if (
        existing?.status === 'agreed' &&
        fields.status === undefined &&
        [
          'statement',
          'commandIds',
          'examples',
          ...ruleFields.map((f) => f.key),
        ].some(
          (key) => JSON.stringify(rule[key]) !== JSON.stringify(existing[key]),
        )
      )
        rule.status = 'proposed';
      return rule;
    },
  );
  return result;
}
export function removeAggregateReference(card, removedId) {
  const design = aggregateDesignOf(card);
  const updated = {
    ...design,
    commandIds: design.commandIds.filter((id) => id !== removedId),
    rules: design.rules.map((r) => ({
      ...r,
      commandIds: r.commandIds.filter((id) => id !== removedId),
      ...(r.status === 'agreed' && r.commandIds.includes(removedId)
        ? { status: 'proposed' }
        : {}),
    })),
    externalReferences: design.externalReferences.filter(
      (r) => r.aggregateId !== removedId,
    ),
  };
  return JSON.stringify(design) === JSON.stringify(updated)
    ? undefined
    : updated;
}
export function aggregateReview(card, cards) {
  const design = aggregateDesignOf(card),
    issues = [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const add = (code, message) =>
    issues.push({ cardId: card.id, stage: card.stage, code, message });
  const activeRules = design.rules.filter((rule) => rule.status !== 'retired');
  if (!card.data.root?.trim())
    add('aggregate-root', '애그리게이트 루트를 정해 주세요.');
  if (
    !card.data.invariants?.trim() &&
    !activeRules.some((rule) => rule.statement.trim())
  )
    add(
      'aggregate-invariants',
      '같은 트랜잭션 안에서 지킬 업무 불변식을 적어 주세요.',
    );
  if (!card.contextId && cards.some((c) => c.kind === 'context'))
    add('unassigned', '이 사실·규칙을 소유하는 컨텍스트를 검토해 주세요.');
  if (!design.commandIds.length)
    add(
      'aggregate-commands',
      '애그리게이트가 처리하는 명령과 변경 진입점을 검토해 주세요.',
    );
  for (const id of design.commandIds) {
    const command = byId.get(id);
    if (
      !command ||
      command.kind !== 'command' ||
      command.contextId !== card.contextId
    )
      add(
        'aggregate-command-reference',
        '처리 명령의 존재와 컨텍스트 경계를 확인해 주세요.',
      );
    if (
      cards.some(
        (other) =>
          other.id !== card.id &&
          other.kind === 'aggregate' &&
          aggregateDesignOf(other).commandIds.includes(id),
      )
    )
      add(
        'aggregate-command-owner',
        '명령을 처리하는 애그리게이트의 책임이 중복되어 있습니다.',
      );
  }
  if (!activeRules.length)
    add(
      'aggregate-structured-rules',
      '기존 규칙 설명을 보존하면서 규칙별 명령과 검증 사례를 구체화해 주세요.',
    );
  for (const rule of activeRules) {
    const label = rule.statement.trim() || '이름 없는 규칙';
    if (!rule.statement.trim())
      add('aggregate-rule-statement', '업무 불변식의 내용을 적어 주세요.');
    if (
      !rule.commandIds.length ||
      rule.commandIds.some((id) => !design.commandIds.includes(id))
    )
      add(
        'aggregate-rule-command',
        `“${label}”을 보장하는 처리 명령을 연결해 주세요.`,
      );
    if (!rule.examples.some((e) => e.type === 'normal'))
      add(
        'aggregate-normal-example',
        `“${label}”의 정상 사례를 검토해 주세요.`,
      );
    if (!rule.examples.some((e) => e.type === 'rejection'))
      add(
        'aggregate-rejection-example',
        `“${label}”이 위반될 때의 거절·실패 사례를 검토해 주세요.`,
      );
    for (const example of rule.examples)
      if (![example.given, example.when, example.then].every((s) => s.trim()))
        add(
          'aggregate-example-detail',
          `“${label}”의 검증 사례에 Given·When·Then을 적어 주세요.`,
        );
  }
  for (const ref of design.externalReferences) {
    const target = byId.get(ref.aggregateId);
    if (!target || target.kind !== 'aggregate' || target.id === card.id)
      add(
        'aggregate-external-reference',
        '경계 밖 애그리게이트 참조를 확인해 주세요.',
      );
    if (!ref.reason.trim())
      add(
        'aggregate-reference-reason',
        '외부 애그리게이트를 참조하는 이유와 전달할 식별자를 적어 주세요.',
      );
  }
  if (design.externalReferences.length && !design.coordination.trim())
    add(
      'aggregate-coordination',
      '경계 밖 처리의 지연·중복·재시도·보상 정책을 검토해 주세요.',
    );
  return issues;
}
export function buildAggregateDesign(card, cards) {
  const design = aggregateDesignOf(card),
    byId = new Map(cards.map((c) => [c.id, c]));
  return {
    aggregate: card,
    context: byId.get(card.contextId) || null,
    design,
    commands: design.commandIds.map((id) => {
      const command = byId.get(id);
      return {
        id,
        card: command || null,
        ruleIds: design.rules
          .filter((r) => r.commandIds.includes(id))
          .map((r) => r.id),
        resultEvents: (command?.links || [])
          .filter(
            (l) => l.kind === 'flow' && byId.get(l.targetId)?.kind === 'event',
          )
          .map((l) => byId.get(l.targetId)),
      };
    }),
    externalReferences: design.externalReferences.map((ref) => ({
      ...ref,
      aggregate: byId.get(ref.aggregateId) || null,
    })),
    incomingReferences: cards
      .filter(
        (c) =>
          c.kind === 'aggregate' &&
          aggregateDesignOf(c).externalReferences.some(
            (r) => r.aggregateId === card.id,
          ),
      )
      .map((c) => ({ id: c.id, title: c.title, contextId: c.contextId })),
    issues: aggregateReview(card, cards),
    note: '검증 사례는 설계상의 기대 결과입니다. 구현 테스트를 실행했다는 뜻은 아니며, 업무 규칙의 타당성은 도메인 담당자와 확인하세요.',
  };
}
