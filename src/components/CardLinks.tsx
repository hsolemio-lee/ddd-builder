import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Card, CardDraft, CardLink } from '../types';
import { flowAllowed, linkKinds } from '../../shared/design.mjs';
import { kinds } from '../workflow';

export default function CardLinks({
  source,
  id,
  cards,
  onChange,
}: {
  source: CardDraft;
  id?: string;
  cards: Card[];
  onChange: (links: CardLink[]) => void;
}) {
  const canFlow =
    source.stage === 'events' &&
    ['actor', 'command', 'event', 'policy'].includes(source.kind);
  const [selectedKind, setKind] = useState<CardLink['kind']>('flow');
  const kind = selectedKind === 'flow' && !canFlow ? 'related' : selectedKind;
  const [targetId, setTargetId] = useState('');
  const links = source.links || [];
  const candidates = cards.filter(
    (c) =>
      c.id !== id &&
      (kind !== 'flow' || flowAllowed(source, c)) &&
      !links.some((l) => l.kind === kind && l.targetId === c.id),
  );
  const incoming = cards.filter((c) => c.links?.some((l) => l.targetId === id));
  return (
    <section className="link-editor" aria-label="카드 연결">
      <strong>나가는 연결</strong>
      <p className="field-help">
        흐름: 행위자 → 명령 → 이벤트 → 정책 → 명령. 관련 연결은 컨텍스트 관계와
        설계 근거를 남길 때 사용하세요.
      </p>
      <ul>
        {links.map((link) => (
          <li key={`${link.kind}:${link.targetId}`}>
            <span>
              {linkKinds[link.kind]} →{' '}
              {cards.find((c) => c.id === link.targetId)?.title ||
                '삭제된 대상'}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`연결 제거: ${cards.find((c) => c.id === link.targetId)?.title || link.targetId}`}
              onClick={() => onChange(links.filter((l) => l !== link))}
            >
              <X size={15} />
            </button>
          </li>
        ))}
      </ul>
      <div className="link-inputs">
        <label>
          연결 유형
          <select
            aria-label="연결 유형"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as CardLink['kind']);
              setTargetId('');
            }}
          >
            {Object.entries(linkKinds)
              .filter(([k]) => k !== 'flow' || canFlow)
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </label>
        <label>
          연결 대상
          <select
            aria-label="연결 대상"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">카드를 선택하세요</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {kinds[c.kind].label} · {c.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button small"
          disabled={
            !candidates.some((c) => c.id === targetId) || links.length >= 100
          }
          onClick={() => {
            onChange([...links, { kind, targetId }]);
            setTargetId('');
          }}
        >
          <Plus size={14} />
          연결 추가
        </button>
      </div>
      {incoming.length > 0 && (
        <p className="field-help">
          들어오는 연결: {incoming.map((c) => c.title).join(' · ')}. 해당 출발
          카드에서 수정할 수 있어요.
        </p>
      )}
    </section>
  );
}
