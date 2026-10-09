import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  AggregateDesign,
  AggregateExample,
  AggregateRule,
  Card,
} from '../types';
import { aggregateDesignOf } from '../../shared/aggregate.mjs';

export default function AggregateDesignEditor({
  design,
  cards,
  contextId,
  id,
  onChange,
}: {
  design: AggregateDesign;
  cards: Card[];
  contextId: string | null;
  id?: string;
  onChange: (design: AggregateDesign) => void;
}) {
  const [referenceId, setReferenceId] = useState('');
  const commands = cards.filter(
    (c) => c.kind === 'command' && c.contextId === contextId,
  );
  const selected = cards.filter((c) => design.commandIds.includes(c.id));
  const external = cards.filter(
    (c) =>
      c.kind === 'aggregate' &&
      c.id !== id &&
      !design.externalReferences.some((r) => r.aggregateId === c.id),
  );
  function ruleChange(ruleId: string, change: Partial<AggregateRule>) {
    onChange({
      ...design,
      rules: design.rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...change } : rule,
      ),
    });
  }
  function exampleChange(
    rule: AggregateRule,
    exampleId: string,
    change: Partial<AggregateExample>,
  ) {
    ruleChange(rule.id, {
      examples: rule.examples.map((e) =>
        e.id === exampleId ? { ...e, ...change } : e,
      ),
    });
  }
  return (
    <section
      className="aggregate-editor"
      aria-label="애그리게이트 행동과 규칙 설계"
    >
      <h3>명령·규칙·검증 사례</h3>
      <p className="field-help">
        루트를 통해 처리할 명령을 연결하고, 각 규칙을 정상·거절·동시성 사례로
        검토하세요. 사례 작성은 테스트 실행 결과가 아닙니다.
      </p>
      <fieldset className="aggregate-command-picker">
        <legend>처리하는 명령</legend>
        {commands.map((command) => {
          const owner = cards.find(
            (c) =>
              c.kind === 'aggregate' &&
              c.id !== id &&
              aggregateDesignOf(c).commandIds.includes(command.id),
          );
          return (
            <label className="check-label" key={command.id}>
              <input
                type="checkbox"
                aria-label={`처리 명령: ${command.title}`}
                checked={design.commandIds.includes(command.id)}
                disabled={Boolean(owner)}
                onChange={(event) => {
                  const commandIds = event.target.checked
                    ? [...design.commandIds, command.id]
                    : design.commandIds.filter((value) => value !== command.id);
                  onChange({
                    ...design,
                    commandIds,
                    rules: design.rules.map((rule) => ({
                      ...rule,
                      commandIds: rule.commandIds.filter((value) =>
                        commandIds.includes(value),
                      ),
                    })),
                  });
                }}
              />
              <span>
                {command.title}
                {owner && ` · ${owner.title}에서 처리`}
              </span>
            </label>
          );
        })}
        {!commands.length && (
          <p className="field-help">
            이 컨텍스트의 명령 카드가 없어요. 이벤트 정리에서 명령을 만들고 같은
            컨텍스트에 배치하세요.
          </p>
        )}
        {design.commandIds
          .filter((value) => !commands.some((c) => c.id === value))
          .map((value) => (
            <div key={value} className="aggregate-stale-reference">
              <span>
                현재 경계에 없는 명령:{' '}
                {cards.find((c) => c.id === value)?.title || value}
              </span>
              <button
                type="button"
                className="button small"
                onClick={() =>
                  onChange({
                    ...design,
                    commandIds: design.commandIds.filter((id) => id !== value),
                    rules: design.rules.map((r) => ({
                      ...r,
                      commandIds: r.commandIds.filter((id) => id !== value),
                    })),
                  })
                }
              >
                연결 해제
              </button>
            </div>
          ))}
      </fieldset>
      {design.rules.map((rule, i) => (
        <fieldset className="aggregate-rule-editor" key={rule.id}>
          <legend>업무 규칙 {i + 1}</legend>
          <label>
            규칙 내용
            <textarea
              aria-label={`규칙 내용 ${i + 1}`}
              rows={2}
              maxLength={2000}
              value={rule.statement}
              placeholder="예: 접수된 주문에는 주문 항목이 하나 이상 있어야 한다."
              onChange={(event) =>
                ruleChange(rule.id, { statement: event.target.value })
              }
            />
          </label>
          <fieldset className="aggregate-command-picker">
            <legend>이 규칙을 보장하는 명령</legend>
            {selected.map((command) => (
              <label className="check-label" key={command.id}>
                <input
                  type="checkbox"
                  aria-label={`규칙 ${i + 1} 명령: ${command.title}`}
                  checked={rule.commandIds.includes(command.id)}
                  onChange={(event) =>
                    ruleChange(rule.id, {
                      commandIds: event.target.checked
                        ? [...rule.commandIds, command.id]
                        : rule.commandIds.filter((id) => id !== command.id),
                    })
                  }
                />
                <span>{command.title}</span>
              </label>
            ))}
            {!selected.length && (
              <p className="field-help">위에서 처리 명령을 먼저 선택하세요.</p>
            )}
          </fieldset>
          {rule.examples.map((example, j) => (
            <fieldset className="aggregate-example-editor" key={example.id}>
              <legend>
                규칙 {i + 1} 검증 사례 {j + 1}
              </legend>
              <label>
                사례 이름
                <input
                  aria-label={`규칙 ${i + 1} 사례 ${j + 1} 이름`}
                  maxLength={200}
                  value={example.title}
                  placeholder="예: 빈 주문은 접수할 수 없다"
                  onChange={(event) =>
                    exampleChange(rule, example.id, {
                      title: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                사례 구분
                <select
                  aria-label={`규칙 ${i + 1} 사례 ${j + 1} 구분`}
                  value={example.type}
                  onChange={(event) =>
                    exampleChange(rule, example.id, {
                      type: event.target.value as AggregateExample['type'],
                    })
                  }
                >
                  <option value="normal">정상</option>
                  <option value="rejection">거절·실패</option>
                  <option value="concurrency">동시성·중복 요청</option>
                </select>
              </label>
              {(['given', 'when', 'then'] as const).map((key) => (
                <label key={key}>
                  {key === 'given'
                    ? 'Given · 주어진 상태'
                    : key === 'when'
                      ? 'When · 수행할 행동'
                      : 'Then · 기대 결과'}
                  <textarea
                    aria-label={`규칙 ${i + 1} 사례 ${j + 1} ${key}`}
                    rows={2}
                    maxLength={2000}
                    value={example[key]}
                    onChange={(event) =>
                      exampleChange(rule, example.id, {
                        [key]: event.target.value,
                      })
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                className="button small"
                aria-label={`규칙 ${i + 1} 사례 ${j + 1} 삭제`}
                onClick={() =>
                  ruleChange(rule.id, {
                    examples: rule.examples.filter((e) => e.id !== example.id),
                  })
                }
              >
                <Trash2 size={14} />
                사례 삭제
              </button>
            </fieldset>
          ))}
          <div className="aggregate-editor-actions">
            <button
              type="button"
              className="button small"
              disabled={rule.examples.length >= 20}
              aria-label={`규칙 ${i + 1} 검증 사례 추가`}
              onClick={() =>
                ruleChange(rule.id, {
                  examples: [
                    ...rule.examples,
                    {
                      id: crypto.randomUUID(),
                      title: '',
                      type: 'normal',
                      given: '',
                      when: '',
                      then: '',
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              검증 사례 추가
            </button>
            <button
              type="button"
              className="button small"
              aria-label={`규칙 ${i + 1} 삭제`}
              onClick={() => {
                if (
                  confirm(
                    '이 규칙과 검증 사례를 삭제할까요? 저장하기 전에는 보드에 반영되지 않습니다.',
                  )
                )
                  onChange({
                    ...design,
                    rules: design.rules.filter((r) => r.id !== rule.id),
                  });
              }}
            >
              <Trash2 size={14} />
              규칙 삭제
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="button"
        disabled={design.rules.length >= 40}
        onClick={() =>
          onChange({
            ...design,
            rules: [
              ...design.rules,
              {
                id: crypto.randomUUID(),
                statement: '',
                commandIds: [],
                examples: [],
              },
            ],
          })
        }
      >
        <Plus size={15} />
        업무 규칙 추가
      </button>
      <h3>경계 밖 참조와 실패 대응</h3>
      <p className="field-help">
        다른 애그리게이트는 내부 엔티티로 묶기보다 식별자로 참조하고, 각 경계의
        변경과 실패 대응을 구분하세요.
      </p>
      {design.externalReferences.map((ref) => (
        <fieldset key={ref.aggregateId} className="aggregate-reference-editor">
          <legend>
            {cards.find((c) => c.id === ref.aggregateId)?.title ||
              '참조 대상 없음'}
          </legend>
          <label>
            참조 이유·전달할 식별자
            <textarea
              aria-label={`외부 참조 이유: ${cards.find((c) => c.id === ref.aggregateId)?.title || ref.aggregateId}`}
              rows={2}
              maxLength={2000}
              value={ref.reason}
              onChange={(event) =>
                onChange({
                  ...design,
                  externalReferences: design.externalReferences.map((r) =>
                    r.aggregateId === ref.aggregateId
                      ? { ...r, reason: event.target.value }
                      : r,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className="button small"
            onClick={() =>
              onChange({
                ...design,
                externalReferences: design.externalReferences.filter(
                  (r) => r.aggregateId !== ref.aggregateId,
                ),
              })
            }
          >
            참조 해제
          </button>
        </fieldset>
      ))}
      <div className="aggregate-reference-add">
        <select
          aria-label="외부 애그리게이트 선택"
          value={referenceId}
          onChange={(event) => setReferenceId(event.target.value)}
        >
          <option value="">참조할 애그리게이트</option>
          {external.map((c) => (
            <option value={c.id} key={c.id}>
              {cards.find((ctx) => ctx.id === c.contextId)?.title || '미분류'} ·{' '}
              {c.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button small"
          disabled={
            !external.some((c) => c.id === referenceId) ||
            design.externalReferences.length >= 40
          }
          onClick={() => {
            onChange({
              ...design,
              externalReferences: [
                ...design.externalReferences,
                { aggregateId: referenceId, reason: '' },
              ],
            });
            setReferenceId('');
          }}
        >
          참조 추가
        </button>
      </div>
      <label>
        경계 밖 조정·실패 정책
        <textarea
          aria-label="경계 밖 조정·실패 정책"
          rows={3}
          maxLength={20000}
          value={design.coordination}
          placeholder="어떤 결과를 기다리나요? 지연·중복·타임아웃·재시도·보상은 어떻게 처리하나요?"
          onChange={(event) =>
            onChange({ ...design, coordination: event.target.value })
          }
        />
      </label>
    </section>
  );
}
