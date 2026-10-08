import { useId } from 'react';
import type { Card } from '../types';
import { layoutFlow } from '../../shared/flow.mjs';
import { statuses } from '../../shared/design.mjs';
import { kinds } from '../workflow';

export default function FlowBoard({
  cards,
  allCards,
  onOpen,
}: {
  cards: Card[];
  allCards: Card[];
  onOpen: (card: Card) => void;
}) {
  const marker = useId().replace(/:/g, '');
  const graph = layoutFlow(cards);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const hiddenLinks = cards
    .flatMap((c) => c.links)
    .filter(
      (l) => !byId.has(l.targetId) && allCards.some((c) => c.id === l.targetId),
    ).length;
  return (
    <section className="flow-board" aria-label="설계 흐름">
      <p className="field-help">
        화살표는 출발 카드에서 연결 대상으로 향해요. 카드를 선택해 내용을
        확인하고 연결을 편집하세요. 점선은 반복 경로입니다.
      </p>
      {hiddenLinks > 0 && (
        <p className="field-help">
          현재 필터로 연결 대상 {hiddenLinks}개가 숨겨져 있어요. 전체 흐름은
          필터를 해제해 확인하세요.
        </p>
      )}
      {graph.edges.length === 0 ? (
        <div className="flow-empty">
          <strong>첫 연결로 이야기를 이어 보세요.</strong>
          <p>
            카드 편집의 ‘나가는 연결’에서 명령과 결과 사건을 연결하면 흐름이
            나타나요.
          </p>
        </div>
      ) : (
        <div
          className="flow-scroll"
          tabIndex={0}
          aria-label="설계 흐름 캔버스, 가로로 스크롤할 수 있습니다"
        >
          <div
            className="flow-canvas"
            style={{ width: graph.width, height: graph.height }}
          >
            <svg width={graph.width} height={graph.height} aria-hidden="true">
              <defs>
                <marker
                  id={marker}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#668071" />
                </marker>
              </defs>
              {graph.edges.map((edge, i) => {
                const a = nodeById.get(edge.source)!,
                  b = nodeById.get(edge.target)!;
                const start = a.x + 224,
                  end = b.x;
                const path = edge.feedback
                  ? `M ${start} ${a.y + 50} C ${start + 35} ${a.y - 26}, ${end - 35} ${b.y - 26}, ${end} ${b.y + 50}`
                  : `M ${start} ${a.y + 50} C ${(start + end) / 2} ${a.y + 50}, ${(start + end) / 2} ${b.y + 50}, ${end} ${b.y + 50}`;
                return (
                  <path
                    key={i}
                    d={path}
                    fill="none"
                    stroke="#668071"
                    strokeWidth="1.7"
                    strokeDasharray={edge.feedback ? '5 4' : undefined}
                    markerEnd={`url(#${marker})`}
                  />
                );
              })}
            </svg>
            {graph.nodes.map((node) => {
              const card = byId.get(node.id)!;
              return (
                <button
                  key={node.id}
                  className={`flow-node card-${kinds[card.kind].color}`}
                  style={{ left: node.x, top: node.y }}
                  aria-label={`흐름 카드: ${card.title}`}
                  onClick={() => onOpen(card)}
                >
                  <span>
                    {kinds[card.kind].label} · {statuses[card.status]}
                  </span>
                  <strong>{card.title}</strong>
                  <small>
                    {allCards.find((c) => c.id === card.contextId)?.title ||
                      '미분류'}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <details className="flow-connections">
        <summary>연결 목록 ({graph.edges.length})</summary>
        <ul>
          {graph.edges.map((edge, i) => (
            <li key={i}>
              <button
                className="text-button"
                onClick={() => onOpen(byId.get(edge.source)!)}
              >
                {byId.get(edge.source)?.title}
              </button>
              <span>→</span>
              <button
                className="text-button"
                onClick={() => onOpen(byId.get(edge.target)!)}
              >
                {byId.get(edge.target)?.title}
              </button>
              {edge.feedback && <small>반복</small>}
            </li>
          ))}
        </ul>
      </details>
      {graph.unconnected.length > 0 && (
        <details className="flow-connections">
          <summary>
            아직 연결되지 않은 카드 ({graph.unconnected.length})
          </summary>
          <div className="unconnected-cards">
            {graph.unconnected.map((id) => (
              <button
                key={id}
                className="button small"
                onClick={() => onOpen(byId.get(id)!)}
              >
                {byId.get(id)?.title}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
