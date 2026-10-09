import type { Card } from '../types';
import { statuses } from '../../shared/design.mjs';
import AggregateOverview from './AggregateOverview';
export default function AggregateBoard({
  cards,
  allCards,
  readOnly,
  onOpen,
}: {
  cards: Card[];
  allCards: Card[];
  readOnly: boolean;
  onOpen: (card: Card) => void;
}) {
  return (
    <section
      className="aggregate-board"
      aria-label="애그리게이트 일관성 경계 보기"
    >
      <p className="field-help">
        루트 안의 모델과 업무 규칙을 검토하고, 경계 밖 참조와 실패 대응을
        구분하세요. 같은 컨텍스트에 여러 애그리게이트가 있을 수 있어요.
      </p>
      {!cards.length && (
        <div className="flow-empty">
          <strong>첫 애그리게이트의 일관성 경계를 설계해 보세요.</strong>
          <p>카드 추가에서 루트와 업무 규칙을 기록할 수 있어요.</p>
        </div>
      )}
      <div className="aggregate-boundary-grid">
        {[...cards]
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
          .map((card) => (
            <article
              className="aggregate-boundary-card"
              key={card.id}
              aria-label={`애그리게이트: ${card.title}`}
            >
              <header>
                <div>
                  <small>
                    {allCards.find((c) => c.id === card.contextId)?.title ||
                      '미분류 컨텍스트'}
                  </small>
                  <h3>{card.title}</h3>
                  <span className={`agreement-badge status-${card.status}`}>
                    {statuses[card.status]}
                  </span>
                </div>
                <button
                  className="button small"
                  aria-label={`${readOnly ? '애그리게이트 보기' : '애그리게이트 편집'}: ${card.title}`}
                  onClick={() => onOpen(card)}
                >
                  {readOnly ? '상세 보기' : '설계 편집'}
                </button>
              </header>
              {card.description && (
                <p className="aggregate-description">{card.description}</p>
              )}
              <AggregateOverview card={card} cards={allCards} onOpen={onOpen} />
            </article>
          ))}
      </div>
    </section>
  );
}
