import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, GripVertical, Plus } from 'lucide-react';
import type { Card, EventPlacement, Kind } from '../types';
import { scenarios, statuses } from '../../shared/design.mjs';
import Board from './Board';
import FlowConnectionEditor from './FlowConnectionEditor';

export default function EventStoryBoard({
  cards,
  allCards,
  connected,
  pending,
  readOnly,
  allowOrder,
  showAuxiliary,
  typeFilter,
  onOpen,
  onAdd,
  onInsert,
  onPatch,
  onMove,
  onReorder,
}: {
  cards: Card[];
  allCards: Card[];
  connected: boolean;
  pending: Set<string>;
  readOnly: boolean;
  allowOrder: boolean;
  showAuxiliary: boolean;
  typeFilter: string;
  onOpen: (card: Card) => void;
  onAdd: (kind?: Kind) => void;
  onInsert: (card: Card, side: EventPlacement['side']) => void;
  onPatch: (card: Card, change: Partial<Card>) => Promise<boolean>;
  onMove: (card: Card, direction: -1 | 1) => void;
  onReorder: (cards: Card[]) => Promise<boolean>;
}) {
  const events = cards
    .filter((c) => c.kind === 'event')
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const fullOrder = allCards
    .filter((c) => c.stage === 'events' && c.kind === 'event')
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const auxiliary = cards.filter((c) => c.kind !== 'event');
  const [auxiliaryOpen, setAuxiliaryOpen] = useState(false);
  const [editingLinks, setEditingLinks] = useState(false);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [dragging, setDragging] = useState('');
  const [over, setOver] = useState('');
  const [overSide, setOverSide] = useState<'before' | 'after'>('before');
  const dragSnapshot = useRef<Card[]>([]);
  const locked = readOnly || !connected || pending.size > 0;
  const orderLocked = locked || !allowOrder;
  function linkFrom(card: Card) {
    setSource(card.id);
    setTarget('');
    setEditingLinks(true);
  }
  async function drop(targetId: string) {
    if (orderLocked || !dragging || dragging === targetId) return;
    const original = dragSnapshot.current;
    const moved = original.find((c) => c.id === dragging);
    if (!moved) return;
    const next = original.filter((c) => c.id !== moved.id);
    const index = next.findIndex((c) => c.id === targetId);
    if (index < 0) return;
    next.splice(index + (overSide === 'after' ? 1 : 0), 0, moved);
    if (next.some((c, i) => c.id !== original[i].id)) await onReorder(next);
  }
  function shift(card: Card, direction: -1 | 1) {
    if (orderLocked) return;
    const index = fullOrder.findIndex((c) => c.id === card.id);
    const next = [...fullOrder];
    if (index + direction < 0 || index + direction >= next.length) return;
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    void onReorder(next);
  }
  return (
    <section className="event-story-board" aria-label="이벤트 순서 정리">
      <div className="story-section-heading">
        <div>
          <h2>사건을 순서대로 펼쳐 보세요.</h2>
          <p>
            연결이 없어도 모든 사건을 볼 수 있어요. 번호는 표시 순서이며, 옮겨도
            업무 연결은 바뀌지 않습니다.
          </p>
        </div>
        <div className="story-toolbar">
          <button
            className="button"
            disabled={pending.size > 0}
            onClick={() => setEditingLinks((v) => !v)}
            aria-expanded={editingLinks}
          >
            흐름 연결 편집
          </button>
          {!readOnly && (
            <button
              className="button primary"
              disabled={locked}
              onClick={() => onAdd('event')}
            >
              <Plus size={16} />
              사건 추가
            </button>
          )}
        </div>
      </div>
      {!allowOrder && !readOnly && (
        <p className="field-help">
          순서를 바꾸려면 검색·검토 상태·컨텍스트·흐름 필터를 해제하세요. 기준
          사건 앞뒤 삽입은 사용할 수 있습니다.
        </p>
      )}
      {editingLinks && (
        <FlowConnectionEditor
          cards={allCards}
          sourceId={source}
          targetId={target}
          onSource={setSource}
          onTarget={setTarget}
          onClose={() => setEditingLinks(false)}
          onPatch={onPatch}
          connected={connected}
          readOnly={readOnly}
          pending={pending}
        />
      )}
      <div
        className="event-story-scroll"
        tabIndex={0}
        aria-label="이벤트 순서 목록"
      >
        <ol className="event-story-list">
          {events.map((card, index) => {
            const number = fullOrder.findIndex((c) => c.id === card.id);
            const incoming = allCards.filter((c) =>
              c.links.some((l) => l.kind === 'flow' && l.targetId === card.id),
            ).length;
            const outgoing = card.links.filter((l) => l.kind === 'flow').length;
            return (
              <li
                key={card.id}
                data-event-id={card.id}
                className={`event-story-card ${dragging === card.id ? 'dragging' : ''} ${over === card.id ? `drop-${overSide}` : ''}`}
                onDragOver={(e) => {
                  if (orderLocked) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const box = e.currentTarget.getBoundingClientRect();
                  setOver(card.id);
                  setOverSide(
                    e.clientX >= box.x + box.width / 2 ? 'after' : 'before',
                  );
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void drop(card.id);
                  setDragging('');
                  setOver('');
                }}
              >
                <div className="story-card-heading">
                  <span className="story-number">
                    {String(number + 1).padStart(2, '0')}
                  </span>
                  <span className={`agreement-badge status-${card.status}`}>
                    {statuses[card.status]}
                  </span>
                  <button
                    className="story-drag-handle"
                    aria-label={`순서 이동: ${card.title}`}
                    disabled={orderLocked}
                    draggable={!orderLocked}
                    title="드래그하거나 왼쪽·오른쪽 방향키로 이동하세요."
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        shift(card, e.key === 'ArrowLeft' ? -1 : 1);
                      }
                    }}
                    onDragStart={(e) => {
                      if (orderLocked) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.setData('text/plain', card.id);
                      e.dataTransfer.effectAllowed = 'move';
                      dragSnapshot.current = fullOrder.map((c) => ({ ...c }));
                      setDragging(card.id);
                    }}
                    onDragEnd={() => {
                      setDragging('');
                      setOver('');
                    }}
                  >
                    <GripVertical size={16} />
                  </button>
                </div>
                <button
                  className="story-card-content"
                  aria-label={`${readOnly ? '카드 보기' : '카드 편집'}: ${card.title}`}
                  onClick={() => onOpen(card)}
                >
                  <span>도메인 이벤트 · {scenarios[card.scenario]}</span>
                  <h3>{card.title}</h3>
                  {card.description && <p>{card.description}</p>}
                </button>
                <div className="story-card-meta">
                  <span>
                    {allCards.find((c) => c.id === card.contextId)?.title ||
                      '미분류'}
                  </span>
                  <button
                    className="text-button"
                    disabled={pending.size > 0}
                    onClick={() => linkFrom(card)}
                  >
                    흐름 {incoming}개 → {outgoing}개
                  </button>
                </div>
                {!readOnly && (
                  <div className="story-card-actions">
                    <button
                      className="button small"
                      disabled={locked}
                      aria-label={`앞에 사건 추가: ${card.title}`}
                      onClick={() => onInsert(card, 'before')}
                    >
                      앞에 추가
                    </button>
                    <button
                      className="button small"
                      disabled={locked}
                      aria-label={`뒤에 사건 추가: ${card.title}`}
                      onClick={() => onInsert(card, 'after')}
                    >
                      뒤에 추가
                    </button>
                    <button
                      className="icon-button"
                      disabled={orderLocked || number === 0}
                      aria-label={`왼쪽으로 이동: ${card.title}`}
                      onClick={() => shift(card, -1)}
                    >
                      <ArrowLeft size={15} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={orderLocked || number === fullOrder.length - 1}
                      aria-label={`오른쪽으로 이동: ${card.title}`}
                      onClick={() => shift(card, 1)}
                    >
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                {index < events.length - 1 && (
                  <span className="story-order-divider" aria-hidden="true">
                    ·
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {!events.length && !showAuxiliary && (
          <div className="story-empty">
            <strong>아직 표시할 사건이 없어요.</strong>
            <p>
              사건을 추가하거나 필터를 조정하세요. 연결은 나중에 정리할 수
              있습니다.
            </p>
          </div>
        )}
      </div>
      <div className="story-auxiliary">
        <button
          className="button"
          aria-expanded={showAuxiliary || auxiliaryOpen}
          disabled={showAuxiliary}
          onClick={() => setAuxiliaryOpen((v) => !v)}
        >
          보조 카드 {auxiliary.length}개{' '}
          {showAuxiliary ? '표시 중' : auxiliaryOpen ? '접기' : '펼치기'}
        </button>
        <p className="field-help">
          명령·행위자·정책·질문은 필요한 때 펼쳐 보세요. 전체 연결과 분기·반복은
          흐름 보기에서 확인할 수 있습니다.
        </p>
        {(showAuxiliary || auxiliaryOpen) && (
          <Board
            stage="events"
            cards={auxiliary}
            allCards={allCards}
            filter={typeFilter}
            excludeKinds={['event']}
            query=""
            connected={connected}
            pending={pending}
            readOnly={readOnly}
            allowMove={allowOrder}
            onEdit={onOpen}
            onAdd={onAdd}
            onPatch={onPatch}
            onMove={onMove}
          />
        )}
      </div>
    </section>
  );
}
