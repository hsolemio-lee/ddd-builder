import type { Card } from '../types';
import { kinds } from '../workflow';
import { statuses, scenarios, linkKinds } from '../../shared/design.mjs';
import Modal from './Modal';
import ContextRelationships from './ContextRelationships';
import AggregateOverview from './AggregateOverview';

const labels: Record<string, string> = {
  relationships: '컨텍스트 관계',
  relationshipFormat: '관계 표시 형식',
  root: '루트 엔티티',
  entities: '엔티티',
  valueObjects: '값 객체',
  invariants: '불변 조건',
  assignee: '담당자',
  done: '완료 여부',
};
export default function CardDetails({
  card,
  onClose,
  cards,
}: {
  card: Card;
  cards: Card[];
  onClose: () => void;
}) {
  return (
    <Modal
      title={card.title}
      className={card.kind === 'aggregate' ? 'aggregate-detail-modal' : ''}
      onClose={onClose}
    >
      <div className="share-body card-details">
        <span className="tiny-tag">{kinds[card.kind].label} · 조회 전용</span>
        <span className={`agreement-badge status-${card.status}`}>
          {statuses[card.status]}
        </span>
        <p>흐름 구분: {scenarios[card.scenario]}</p>
        {card.decision && (
          <div>
            <strong>검토 근거</strong>
            <p>{card.decision}</p>
          </div>
        )}
        {card.links.length > 0 && (
          <div>
            <strong>나가는 연결</strong>
            {card.links.map((l) => (
              <p key={`${l.kind}:${l.targetId}`}>
                {linkKinds[l.kind]} →{' '}
                {cards.find((c) => c.id === l.targetId)?.title || l.targetId}
              </p>
            ))}
          </div>
        )}
        <p>{card.description || '작성된 설명이 없습니다.'}</p>
        {card.kind === 'context' && (
          <ContextRelationships
            text={String(
              (card.data.relationshipFormat === 'mermaid'
                ? card.data.relationshipDiagram
                : card.data.relationships) || '',
            )}
            format={String(card.data.relationshipFormat || 'text')}
          />
        )}
        {card.kind === 'aggregate' && (
          <AggregateOverview card={card} cards={cards} />
        )}
        {Object.entries(card.kind === 'aggregate' ? {} : card.data)
          .filter(
            ([name]) =>
              card.kind !== 'context' ||
              ![
                'relationships',
                'relationshipDiagram',
                'relationshipFormat',
              ].includes(name),
          )
          .map(([name, value]) => (
            <div key={name}>
              <strong>{labels[name] || name}</strong>
              <p>
                {typeof value === 'boolean'
                  ? value
                    ? '완료'
                    : '미완료'
                  : value || '—'}
              </p>
            </div>
          ))}
        <p className="muted">마지막 수정: {card.updatedBy}</p>
      </div>
    </Modal>
  );
}
