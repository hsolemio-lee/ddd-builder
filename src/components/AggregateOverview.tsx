import {
  documentationFields,
  ruleFields,
} from '../../shared/documentation-fields.mjs';
import { statuses } from '../../shared/design.mjs';
import { ArrowRight, Blocks } from 'lucide-react';
import type { Card } from '../types';
import { buildAggregateDesign } from '../../shared/aggregate.mjs';

const exampleTypes = {
  normal: '정상',
  rejection: '거절·실패',
  boundary: '경계값',
  concurrency: '동시성·중복 요청',
};
export default function AggregateOverview({
  card,
  cards,
  onOpen,
}: {
  card: Card;
  cards: Card[];
  onOpen?: (card: Card) => void;
}) {
  const model = buildAggregateDesign(card, cards);
  const lines = (value: string | boolean | undefined) =>
    String(value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  function link(target: Card | null, fallback: string) {
    return target && onOpen ? (
      <button className="text-button" onClick={() => onOpen(target)}>
        {target.title}
      </button>
    ) : (
      <span>{target?.title || fallback}</span>
    );
  }
  return (
    <div className="aggregate-overview">
      <section
        className="aggregate-consistency"
        aria-label={`${card.title} 일관성 경계`}
      >
        <div className="aggregate-boundary-label">
          <Blocks size={15} />
          하나의 변경에서 함께 지키는 일관성 경계
        </div>
        <div className="aggregate-root-node">
          <small>외부 변경의 진입점 · 루트</small>
          <strong>{String(card.data.root || '루트를 정해 주세요')}</strong>
        </div>
        <div className="aggregate-members">
          {(
            [
              ['entities', '내부 엔티티'],
              ['valueObjects', '값 객체'],
            ] as const
          ).map(([key, title]) => (
            <section key={key}>
              <h4>{title}</h4>
              {lines(card.data[key]).length ? (
                <ul>
                  {lines(card.data[key]).map((value, i) => (
                    <li key={i}>{value}</li>
                  ))}
                </ul>
              ) : (
                <p className="field-help">작성된 항목이 없어요.</p>
              )}
            </section>
          ))}
        </div>
        {card.data.invariants && (
          <div className="aggregate-legacy-rules">
            <h4>기존 업무 규칙 설명</h4>
            <p>{String(card.data.invariants)}</p>
          </div>
        )}
        <h4>처리 명령과 결과 사건</h4>
        {model.commands.length ? (
          <ul className="aggregate-command-flows">
            {model.commands.map((command) => (
              <li key={command.id}>
                <div>
                  {link(command.card, '연결된 명령을 찾을 수 없어요.')}
                  <ArrowRight size={14} />
                  {command.resultEvents.length ? (
                    command.resultEvents.map((event) => (
                      <span key={event.id}>{link(event, event.title)}</span>
                    ))
                  ) : (
                    <span className="field-help">
                      결과 사건을 확인해 주세요.
                    </span>
                  )}
                </div>
                <small>연결한 규칙 {command.ruleIds.length}개</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-help">
            처리 명령을 연결해 변경 행동을 구체화하세요.
          </p>
        )}
        {documentationFields
          .aggregate!.filter((f) => card.data[f.key])
          .map((f) => (
            <div key={f.key}>
              <h4>{f.label}</h4>
              <p>{String(card.data[f.key])}</p>
            </div>
          ))}
        <h4>업무 규칙과 검증 사례</h4>
        {model.design.rules.map((rule, i) => (
          <details className="aggregate-rule-summary" key={rule.id}>
            <summary>
              {rule.statement || `내용이 없는 규칙 ${i + 1}`}
              <span>사례 {rule.examples.length}개</span>
            </summary>
            <p className="field-help">
              보장하는 명령:{' '}
              {rule.commandIds
                .map(
                  (id) => cards.find((c) => c.id === id)?.title || '참조 없음',
                )
                .join(', ') || '아직 연결하지 않았어요.'}
            </p>
            <p className="field-help">
              규칙 ID: {rule.id} · 상태:{' '}
              {rule.status === 'retired'
                ? '폐기'
                : statuses[rule.status || card.status]}
            </p>
            {ruleFields
              .filter((f) => rule[f.key])
              .map((f) => (
                <div key={f.key}>
                  <strong>{f.label}</strong>
                  <p>{rule[f.key]}</p>
                </div>
              ))}
            {rule.examples.map((example) => (
              <section className="aggregate-case" key={example.id}>
                <h5>
                  {example.title || '이름 없는 사례'} ·{' '}
                  {exampleTypes[example.type]}
                </h5>
                <dl>
                  <dt>Given</dt>
                  <dd>{example.given || '—'}</dd>
                  <dt>When</dt>
                  <dd>{example.when || '—'}</dd>
                  <dt>Then</dt>
                  <dd>{example.then || '—'}</dd>
                  {example.testReferences && (
                    <>
                      <dt>관련 테스트</dt>
                      <dd>{example.testReferences} · 실행 여부 별도 확인</dd>
                    </>
                  )}
                </dl>
              </section>
            ))}
          </details>
        ))}
        {!model.design.rules.length && (
          <p className="field-help">
            규칙을 명령과 사례에 연결하면 이곳에서 함께 검토할 수 있어요.
          </p>
        )}
      </section>
      <section className="aggregate-outside">
        <h4>경계 밖 애그리게이트 참조</h4>
        {model.externalReferences.length ? (
          model.externalReferences.map((ref) => (
            <div key={ref.aggregateId}>
              {link(ref.aggregate, '참조 대상 없음')}
              <p>{ref.reason || '참조 이유·전달할 식별자를 기록하세요.'}</p>
            </div>
          ))
        ) : (
          <p className="field-help">명시적으로 연결한 외부 참조가 없어요.</p>
        )}
        {model.design.coordination && (
          <div>
            <h4>조정·실패 정책</h4>
            <p>{model.design.coordination}</p>
          </div>
        )}
        {model.incomingReferences.length > 0 && (
          <p className="field-help">
            이 경계를 참조하는 애그리게이트:{' '}
            {model.incomingReferences.map((ref) => ref.title).join(', ')}
          </p>
        )}
      </section>
      <p className="field-help">{model.note}</p>
    </div>
  );
}
