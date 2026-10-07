import {
  Plus,
  ArrowUp,
  ArrowDown,
  UserRound,
  ArrowUpRight,
  Layers3,
} from 'lucide-react';
import type { Card, Kind, Stage } from '../types';
import { kinds, steps } from '../workflow';

export default function Board({
  stage,
  cards,
  allCards,
  filter,
  query,
  connected,
  pending,
  onEdit,
  onAdd,
  onPatch,
  onMove,
}: {
  stage: Stage;
  cards: Card[];
  allCards: Card[];
  filter: string;
  query: string;
  connected: boolean;
  pending: Set<string>;
  onEdit: (card: Card) => void;
  onAdd: (kind?: Kind) => void;
  onPatch: (card: Card, patch: Partial<Card>) => void;
  onMove: (card: Card, direction: -1 | 1) => void;
}) {
  const contexts = allCards.filter((c) => c.stage === 'contexts');
  const shownKinds = steps
    .find((s) => s.id === stage)!
    .kinds.filter((k) => filter === 'all' || filter === k);
  const visible = cards.filter(
    (c) =>
      (!query ||
        `${c.title} ${c.description} ${Object.values(c.data).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (filter === 'all' || c.kind === filter),
  );
  function tile(card: Card, siblings: Card[]) {
    const meta = kinds[card.kind];
    const context = contexts.find((c) => c.id === card.contextId);
    const done = card.data.done === true;
    return (
      <article
        className={`board-card card-${meta.color} ${done ? 'task-done' : ''}`}
        key={card.id}
      >
        <div className="card-top">
          <span className="card-kind">
            {pending.has(card.id) ? '저장 중…' : meta.label}
          </span>
          {stage === 'tasks' ? (
            <input
              className="task-checkbox"
              aria-label={`작업 완료: ${card.title}`}
              type="checkbox"
              checked={done}
              disabled={!connected || pending.has(card.id)}
              onChange={(e) =>
                onPatch(card, {
                  data: { ...card.data, done: e.target.checked },
                })
              }
            />
          ) : (
            <span className="card-number">
              {String(siblings.indexOf(card) + 1).padStart(2, '0')}
            </span>
          )}
        </div>
        <button
          className="card-content"
          aria-label={`카드 편집: ${card.title}`}
          onClick={() => onEdit(card)}
        >
          <h3>{card.title}</h3>
          {card.description && <p>{card.description}</p>}
          {stage === 'aggregates' && card.data.root && (
            <span className="aggregate-root">
              <Layers3 size={13} />
              {String(card.data.root)}
            </span>
          )}
          {stage === 'contexts' && card.data.relationships && (
            <span className="context-relation">
              <ArrowUpRight size={14} />
              {String(card.data.relationships)}
            </span>
          )}
        </button>
        <div className="card-bottom">
          {stage === 'tasks' && card.data.assignee ? (
            <span className="card-context">
              <UserRound size={12} />
              {String(card.data.assignee)}
            </span>
          ) : (
            <span className={`card-context ${!context ? 'unassigned' : ''}`}>
              {context ? (
                <>
                  <span className="mini-dot" />
                  {context.title}
                </>
              ) : stage === 'contexts' ? (
                `${allCards.filter((c) => c.stage === 'events' && c.contextId === card.id).length}개 이벤트 카드`
              ) : stage === 'discovery' ? (
                card.updatedBy || '워크숍'
              ) : (
                '미분류'
              )}
            </span>
          )}
          <div className="card-moves">
            <button
              aria-label={`위로 이동: ${card.title}`}
              disabled={
                !connected || pending.size > 0 || siblings.indexOf(card) === 0
              }
              onClick={() => onMove(card, -1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              aria-label={`아래로 이동: ${card.title}`}
              disabled={
                !connected ||
                pending.size > 0 ||
                siblings.indexOf(card) === siblings.length - 1
              }
              onClick={() => onMove(card, 1)}
            >
              <ArrowDown size={13} />
            </button>
          </div>
        </div>
      </article>
    );
  }
  return (
    <>
      {query && visible.length === 0 && (
        <div className="empty-search">
          “{query}”에 해당하는 카드가 없어요. 다른 검색어를 입력해 보세요.
        </div>
      )}
      <div
        className={`board-grid board-${stage} ${shownKinds.length === 1 ? 'single-kind' : ''}`}
      >
        {shownKinds.map((kind) => {
          const meta = kinds[kind];
          const items = visible
            .filter((c) => c.kind === kind)
            .sort(
              (a, b) => a.position - b.position || a.id.localeCompare(b.id),
            );
          return (
            <section
              className="board-column"
              key={kind}
              aria-label={meta.label}
            >
              <div className="column-heading">
                <span className={`color-dot dot-${meta.color}`} />
                <h2>{meta.label}</h2>
                <span className="column-count">{items.length}</span>
                <button
                  className="column-add icon-button"
                  aria-label={`${meta.label} 추가`}
                  disabled={!connected}
                  onClick={() => onAdd(kind)}
                >
                  <Plus size={16} />
                </button>
              </div>
              <p className="column-description">{meta.description}</p>
              <div className="column-cards">
                {items.map((c) => tile(c, items))}
              </div>
              {items.length === 0 && !query && (
                <div className="empty-column">
                  <span className={`empty-mark dot-${meta.color}`} />
                  <p>
                    첫 {kind === 'question' ? '질문을' : '카드를'}
                    <br />
                    함께 적어 볼까요?
                  </p>
                </div>
              )}
              <button
                className="add-card-inline"
                aria-label={`${meta.label} 카드 추가`}
                disabled={!connected}
                onClick={() => onAdd(kind)}
              >
                <Plus size={15} />
                카드 추가
              </button>
            </section>
          );
        })}
      </div>
      {stage === 'contexts' && (
        <section className="context-mapping">
          <div className="mapping-title">
            <div>
              <h2>이벤트에 경계 붙이기</h2>
              <p>앞 단계에서 정리한 카드를 알맞은 컨텍스트로 분류해 주세요.</p>
            </div>
            <span className="pill">
              {
                allCards.filter((c) => c.stage === 'events' && !c.contextId)
                  .length
              }
              개 미분류
            </span>
          </div>
          {allCards.filter((c) => c.stage === 'events').length === 0 ? (
            <p className="muted">
              이벤트 정리 단계에서 카드를 추가하면 이곳에 나타나요.
            </p>
          ) : (
            <div className="mapping-list">
              {allCards
                .filter(
                  (c) =>
                    c.stage === 'events' &&
                    (!query ||
                      c.title.toLowerCase().includes(query.toLowerCase())),
                )
                .sort(
                  (a, b) => a.position - b.position || a.id.localeCompare(b.id),
                )
                .map((c) => (
                  <div className="mapping-row" key={c.id}>
                    <span
                      className={`mapping-kind type-${kinds[c.kind].color}`}
                    >
                      {kinds[c.kind].label}
                    </span>
                    <button onClick={() => onEdit(c)}>{c.title}</button>
                    <select
                      aria-label={`컨텍스트 분류: ${c.title}`}
                      value={c.contextId || ''}
                      disabled={!connected || pending.has(c.id)}
                      onChange={(e) =>
                        onPatch(c, { contextId: e.target.value || null })
                      }
                    >
                      <option value="">미분류</option>
                      {contexts.map((ctx) => (
                        <option key={ctx.id} value={ctx.id}>
                          {ctx.title}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
