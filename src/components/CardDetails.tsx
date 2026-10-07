import type { Card } from '../types';
import { kinds } from '../workflow';
import Modal from './Modal';

const labels: Record<string, string> = {
  relationships: '컨텍스트 관계',
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
}: {
  card: Card;
  onClose: () => void;
}) {
  return (
    <Modal title={card.title} onClose={onClose}>
      <div className="share-body card-details">
        <span className="tiny-tag">{kinds[card.kind].label} · 조회 전용</span>
        <p>{card.description || '작성된 설명이 없습니다.'}</p>
        {Object.entries(card.data).map(([name, value]) => (
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
