import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Layers3,
  Move,
  Plus,
  X,
} from 'lucide-react';
import type { Card, Kind } from '../types';
import {
  buildContextMap,
  layoutContextMap,
  type ContextConnection,
} from '../../shared/context-map.mjs';
import { kinds } from '../workflow';
import { statuses } from '../../shared/design.mjs';
import ContextRelationships from './ContextRelationships';
import GraphViewport from './GraphViewport';

const accents = [
  '#4e7860',
  '#527c9b',
  '#96723e',
  '#88639b',
  '#3f8484',
  '#a46566',
];
const memberKinds: Kind[] = [
  'event',
  'command',
  'policy',
  'aggregate',
  'actor',
  'question',
];
export default function ContextMap({
  contexts,
  members,
  connected,
  pending,
  readOnly,
  onOpen,
  onPatch,
  onAdd,
}: {
  contexts: Card[];
  members: Card[];
  connected: boolean;
  pending: Set<string>;
  readOnly: boolean;
  onOpen: (card: Card) => void;
  onPatch: (card: Card, change: Partial<Card>) => void;
  onAdd: () => void;
}) {
  const marker = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [expanded, setExpanded] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(1100);
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const drag = useRef<
    | { x: number; y: number; left: number; top: number; scale: number }
    | undefined
  >(undefined);
  const [selection, setSelection] = useState<string>();
  const [pairId, setPairId] = useState<string>();
  const detail = useRef<HTMLElement>(null);
  const map = useMemo(
    () => buildContextMap(contexts, members),
    [contexts, members],
  );
  const layout = useMemo(
    () =>
      layoutContextMap(map.groups, map.connections, {
        width: availableWidth,
        positions,
      }),
    [map, availableWidth, positions],
  );
  function moveRegion(id: string, x: number, y: number) {
    x = Math.max(64, x);
    y = Math.max(64, y);
    if (
      layout.nodes.some(
        (node) =>
          node.id !== id &&
          x < node.x + 384 &&
          x + 384 > node.x &&
          y < node.y + 312 &&
          y + 312 > node.y,
      )
    )
      return;
    setPositions((previous) => ({
      ...Object.fromEntries(
        layout.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
      ),
      ...previous,
      [id]: { x, y },
    }));
  }
  const selected =
    selection === 'unassigned'
      ? { context: undefined, members: map.unassigned }
      : map.groups.find((g) => g.context.id === selection);
  const pair = map.connections.find((c) => c.id === pairId);
  const byId = new Map(members.map((c) => [c.id, c]));
  const title = (id: string) =>
    contexts.find((c) => c.id === id)?.title || '미분류';
  const flowCount = map.connections.reduce(
    (sum, c) => sum + c.forward.flows.length + c.reverse.flows.length,
    0,
  );
  useEffect(() => {
    if (selection || pairId)
      detail.current?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
  }, [selection, pairId]);
  function chooseContext(id: string) {
    setExpanded(false);
    setSelection(id);
    setPairId(undefined);
  }
  function choosePair(id: string) {
    setExpanded(false);
    setPairId(id);
    setSelection(undefined);
  }
  function connectionDirection(c: ContextConnection) {
    const hasFlows = c.forward.flows.length + c.reverse.flows.length > 0;
    const forward = hasFlows ? c.forward.flows.length > 0 : c.forward.declared;
    const reverse = hasFlows ? c.reverse.flows.length > 0 : c.reverse.declared;
    return { forward, reverse };
  }
  function connectionArrow(c: ContextConnection) {
    const { forward, reverse } = connectionDirection(c);
    return forward && reverse ? (
      <ArrowLeftRight size={12} />
    ) : forward ? (
      <ArrowRight size={12} />
    ) : (
      <ArrowLeft size={12} />
    );
  }
  function memberButton(card: Card) {
    return (
      <button
        key={card.id}
        className={`boundary-member card-${kinds[card.kind].color}`}
        aria-label={`경계 카드: ${card.title}`}
        title={card.title}
        onClick={() => onOpen(card)}
      >
        <span>{kinds[card.kind].label}</span>
        <strong>{card.title}</strong>
      </button>
    );
  }
  return (
    <section className="context-map" aria-label="바운디드 컨텍스트 지도">
      <header className="context-map-heading">
        <div>
          <span className="map-eyebrow">CONTEXT MAP</span>
          <h2>같은 경계 안의 모델, 경계 사이의 협력</h2>
          <p>
            내부 카드는 소유 컨텍스트로 묶었어요. 필터는 내부 카드에 적용하고
            경계는 유지해요.
          </p>
        </div>
        <div className="map-totals">
          <span>
            <strong>{contexts.length}</strong> 컨텍스트
          </span>
          <span>
            <strong>{members.length}</strong> 내부 카드
          </span>
          <span>
            <strong>{flowCount}</strong> 경계를 넘는 흐름
          </span>
        </div>
      </header>
      <div className="map-legend">
        <span>
          <i className="boundary-legend" />
          점선 영역 · 컨텍스트 경계
        </span>
        <span>
          <i className="flow-legend" />
          실선 · 카드 흐름
        </span>
        <span>
          <i className="relation-legend" />
          점선 연결 · 선언한 관계
        </span>
      </div>
      {contexts.length > 0 && (
        <div className="map-layout-controls">
          <p>
            이동 손잡이를 드래그하거나 방향키로 영역을 배치하세요. 자동 배치로
            돌아가면 화면 너비와 연결에 맞춰 정리해요. 수동 배치는 현재
            보기에서만 유지돼요.
          </p>
        </div>
      )}
      {contexts.length === 0 ? (
        <div className="map-empty">
          <Layers3 size={28} />
          <h3>첫 컨텍스트로 경계를 그려 보세요.</h3>
          <p>
            미분류 카드에서 함께 사용하는 언어와 책임을 찾아 영역으로 모아
            보세요.
          </p>
          <button
            className="button primary"
            disabled={readOnly || !connected}
            onClick={onAdd}
          >
            <Plus size={15} />
            컨텍스트 추가
          </button>
        </div>
      ) : (
        <GraphViewport
          title="컨텍스트 경계 지도"
          width={layout.width}
          height={layout.height}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onAvailableWidth={setAvailableWidth}
          tools={
            <button className="button small" onClick={() => setPositions({})}>
              자동 배치
            </button>
          }
        >
          <div
            className="context-map-canvas"
            style={
              {
                '--map-width': `${layout.width}px`,
                width: layout.width,
                height: layout.height,
              } as CSSProperties
            }
          >
            <svg
              className="context-map-lines"
              width={layout.width}
              height={layout.height}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={`${marker}-end`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 L10 5 L0 10z" fill="#65816e" />
                </marker>
              </defs>
              {layout.edges.map((edge) => {
                const hasFlows =
                  edge.forward.flows.length + edge.reverse.flows.length > 0;
                return (
                  <path
                    key={edge.id}
                    d={edge.path}
                    stroke="#65816e"
                    strokeWidth={pairId === edge.id ? 3 : 1.7}
                    fill="none"
                    strokeDasharray={hasFlows ? undefined : '5 5'}
                    markerEnd={
                      connectionDirection(edge).forward
                        ? `url(#${marker}-end)`
                        : undefined
                    }
                    markerStart={
                      connectionDirection(edge).reverse
                        ? `url(#${marker}-end)`
                        : undefined
                    }
                  />
                );
              })}
            </svg>
            {map.groups.map((group, i) => {
              const node = layout.nodes[i],
                event = group.members.filter((c) => c.kind === 'event').length,
                aggregate = group.members.filter(
                  (c) => c.kind === 'aggregate',
                ).length;
              const previews = [
                ...group.members.filter((c) => c.kind === 'event').slice(0, 2),
                ...group.members
                  .filter((c) => c.kind === 'command')
                  .slice(0, 1),
                ...group.members
                  .filter((c) => c.kind === 'aggregate')
                  .slice(0, 1),
              ];
              if (!previews.length) previews.push(...group.members.slice(0, 4));
              return (
                <section
                  key={group.context.id}
                  className={`context-boundary ${selection === group.context.id ? 'selected' : ''}`}
                  aria-label={`컨텍스트 영역: ${group.context.title}`}
                  style={
                    {
                      left: node.x,
                      top: node.y,
                      '--boundary-accent': accents[i % accents.length],
                    } as CSSProperties
                  }
                >
                  <header>
                    <div>
                      <button
                        className="boundary-move icon-button"
                        data-graph-move
                        aria-label={`영역 이동: ${group.context.title}`}
                        title="드래그하거나 방향키로 이동"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          const scale =
                            event.currentTarget
                              .closest('.context-boundary')!
                              .getBoundingClientRect().width / 320;
                          drag.current = {
                            x: event.clientX,
                            y: event.clientY,
                            left: node.x,
                            top: node.y,
                            scale,
                          };
                        }}
                        onPointerMove={(event) => {
                          if (!drag.current) return;
                          moveRegion(
                            group.context.id,
                            drag.current.left +
                              (event.clientX - drag.current.x) /
                                drag.current.scale,
                            drag.current.top +
                              (event.clientY - drag.current.y) /
                                drag.current.scale,
                          );
                        }}
                        onPointerUp={(event) => {
                          if (
                            event.currentTarget.hasPointerCapture(
                              event.pointerId,
                            )
                          )
                            event.currentTarget.releasePointerCapture(
                              event.pointerId,
                            );
                        }}
                        onLostPointerCapture={() => {
                          drag.current = undefined;
                        }}
                        onKeyDown={(event) => {
                          const delta = event.shiftKey ? 8 : 24;
                          const changes: Record<string, [number, number]> = {
                            ArrowLeft: [-delta, 0],
                            ArrowRight: [delta, 0],
                            ArrowUp: [0, -delta],
                            ArrowDown: [0, delta],
                          };
                          const change = changes[event.key];
                          if (change) {
                            event.preventDefault();
                            moveRegion(
                              group.context.id,
                              node.x + change[0],
                              node.y + change[1],
                            );
                          }
                        }}
                      >
                        <Move size={15} />
                      </button>
                      <span className="boundary-number">
                        BC {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3>{group.context.title}</h3>
                    </div>
                    <button
                      className="text-button"
                      aria-label={`${readOnly ? '컨텍스트 보기' : '컨텍스트 편집'}: ${group.context.title}`}
                      onClick={() => onOpen(group.context)}
                    >
                      {readOnly ? '상세' : '편집'}
                      <ArrowRight size={13} />
                    </button>
                  </header>
                  <p className="boundary-responsibility">
                    {group.context.description ||
                      '이 영역의 언어와 책임을 함께 정해 주세요.'}
                  </p>
                  <div className="boundary-counts">
                    <span>이벤트 {event}</span>
                    <span>애그리게이트 {aggregate}</span>
                    <span>{statuses[group.context.status]}</span>
                  </div>
                  <div className="boundary-previews">
                    {previews.map(memberButton)}
                    {!previews.length && (
                      <p className="boundary-empty">
                        표시할 내부 카드가 없어요.
                      </p>
                    )}
                  </div>
                  <button
                    className="boundary-open"
                    aria-label={`${group.context.title} 내부 카드 전체 보기`}
                    onClick={() => chooseContext(group.context.id)}
                  >
                    내부 카드 {group.members.length}개 보기{' '}
                    <ArrowRight size={14} />
                  </button>
                </section>
              );
            })}
            {layout.edges.map((edge) => {
              const count =
                edge.forward.flows.length + edge.reverse.flows.length;
              return (
                <button
                  key={edge.id}
                  className={`map-edge-label ${pairId === edge.id ? 'selected' : ''}`}
                  style={{ left: edge.labelX, top: edge.labelY }}
                  aria-label={`경계 연결: ${title(edge.source)} · ${title(edge.target)}, 흐름 ${count}개`}
                  onClick={() => choosePair(edge.id)}
                >
                  {count ? `${count} 흐름` : '관계'}
                  {connectionArrow(edge)}
                </button>
              );
            })}
          </div>
        </GraphViewport>
      )}
      <div className="unassigned-boundary">
        <div>
          <strong>아직 경계를 정하지 않은 카드</strong>
          <p>
            미분류는 별도 컨텍스트가 아니에요. 책임을 논의한 뒤 영역에
            배치하세요.
          </p>
        </div>
        <button className="button" onClick={() => chooseContext('unassigned')}>
          미분류 {map.unassigned.length}개 보기
          <ArrowRight size={14} />
        </button>
      </div>
      <div className="map-connection-list">
        <h3>경계 사이의 연결</h3>
        {map.connections.length ? (
          <div>
            {map.connections.map((c) => (
              <button
                key={c.id}
                className="button"
                onClick={() => choosePair(c.id)}
              >
                <span>{title(c.source)}</span>
                {connectionArrow(c)}
                <span>{title(c.target)}</span>
                <small>
                  {c.forward.flows.length + c.reverse.flows.length} 흐름
                  {c.forward.declared || c.reverse.declared ? ' · 관계' : ''}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="field-help">
            아직 경계 사이 연결이 없어요. 다른 컨텍스트로 향하는 카드 흐름 또는
            컨텍스트의 관련 연결을 추가하면 나타나요.
          </p>
        )}
      </div>
      {(selected || pair) && (
        <section
          ref={detail}
          className="context-map-detail"
          aria-label={
            selected
              ? `${selected.context?.title || '미분류'} 내부 카드`
              : '경계 연결 상세'
          }
        >
          <header>
            <div>
              <span className="map-eyebrow">
                {pair ? 'BOUNDARY CONNECTION' : 'INSIDE THE BOUNDARY'}
              </span>
              <h3>
                {pair
                  ? `${title(pair.source)} ↔ ${title(pair.target)}`
                  : selected?.context?.title || '미분류'}
              </h3>
            </div>
            <button
              className="icon-button"
              aria-label="경계 상세 닫기"
              onClick={() => {
                setSelection(undefined);
                setPairId(undefined);
              }}
            >
              <X size={18} />
            </button>
          </header>
          {pair ? (
            <div className="boundary-flow-detail">
              {[
                [pair.source, pair.target, pair.forward],
                [pair.target, pair.source, pair.reverse],
              ].map(([from, to, lane]) => {
                const direction = lane as typeof pair.forward;
                return (
                  <section key={String(from)}>
                    <h4>
                      {title(String(from))} → {title(String(to))}
                    </h4>
                    {direction.declared && (
                      <p className="field-help">
                        컨텍스트 카드에서 선언한 관련 관계
                      </p>
                    )}
                    {direction.flows.length ? (
                      <ul>
                        {direction.flows.map((flow) => (
                          <li key={`${flow.source}:${flow.target}`}>
                            <button
                              className="text-button"
                              onClick={() => onOpen(byId.get(flow.source)!)}
                            >
                              {byId.get(flow.source)?.title}
                            </button>
                            <ArrowRight size={14} />
                            <button
                              className="text-button"
                              onClick={() => onOpen(byId.get(flow.target)!)}
                            >
                              {byId.get(flow.target)?.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="field-help">
                        이 방향으로 표시할 카드 흐름이 없어요.
                      </p>
                    )}
                  </section>
                );
              })}
              <p className="field-help">
                화살표는 설계 카드의 흐름입니다. 호출 방식이나 트랜잭션 범위를
                자동으로 결정하지 않아요.
              </p>
            </div>
          ) : (
            selected && (
              <>
                {selected.context && (
                  <>
                    <p className="boundary-description">
                      {selected.context.description}
                    </p>
                    <details className="boundary-relationships">
                      <summary>컨텍스트 관계 설명·다이어그램</summary>
                      <ContextRelationships
                        text={String(
                          selected.context.data.relationshipFormat === 'mermaid'
                            ? selected.context.data.relationshipDiagram || ''
                            : selected.context.data.relationships || '',
                        )}
                        format={String(
                          selected.context.data.relationshipFormat || 'text',
                        )}
                      />
                    </details>
                  </>
                )}
                {!selected.members.length ? (
                  <p className="map-empty-members">
                    이 영역에 표시할 카드가 없어요. 검색·필터를 해제하거나
                    미분류 카드를 배치해 보세요.
                  </p>
                ) : (
                  <div className="boundary-member-groups">
                    {memberKinds.map((kind) => {
                      const list = selected.members.filter(
                        (c) => c.kind === kind,
                      );
                      return (
                        list.length > 0 && (
                          <section
                            key={kind}
                            aria-label={`${selected.context?.title || '미분류'} ${kinds[kind].label}`}
                          >
                            <h4>
                              <span
                                className={`color-dot dot-${kinds[kind].color}`}
                              />
                              {kinds[kind].label}
                              <span>{list.length}</span>
                            </h4>
                            {list.map((card) => (
                              <article key={card.id}>
                                {memberButton(card)}
                                <select
                                  aria-label={`경계 배치: ${card.title}`}
                                  value={
                                    contexts.some(
                                      (c) => c.id === card.contextId,
                                    )
                                      ? card.contextId || ''
                                      : ''
                                  }
                                  disabled={
                                    readOnly ||
                                    !connected ||
                                    pending.has(card.id)
                                  }
                                  onChange={(e) =>
                                    onPatch(card, {
                                      contextId: e.target.value || null,
                                    })
                                  }
                                >
                                  <option value="">미분류</option>
                                  {contexts.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.title}
                                    </option>
                                  ))}
                                </select>
                              </article>
                            ))}
                          </section>
                        )
                      );
                    })}
                  </div>
                )}
              </>
            )
          )}
        </section>
      )}
    </section>
  );
}
