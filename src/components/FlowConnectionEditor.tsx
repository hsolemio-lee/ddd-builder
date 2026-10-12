import { useEffect, useState } from 'react';
import type { Card } from '../types';
import { flowAllowed } from '../../shared/design.mjs';
import { kinds } from '../workflow';

export default function FlowConnectionEditor({
  cards,
  sourceId,
  targetId,
  onSource,
  onTarget,
  onClose,
  onPatch,
  connected,
  readOnly,
  pending,
}: {
  cards: Card[];
  sourceId: string;
  targetId: string;
  onSource: (id: string) => void;
  onTarget: (id: string) => void;
  onClose: () => void;
  onPatch: (card: Card, change: Partial<Card>) => Promise<boolean>;
  connected: boolean;
  readOnly: boolean;
  pending: Set<string>;
}) {
  const [base, setBase] = useState<Card>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBase(cards.find((c) => c.id === sourceId));
    if (sourceId) setMessage('');
    // A new user selection captures a revision; live updates do not silently
    // advance the revision of a connection being reviewed.
  }, [sourceId]);
  const latest = cards.find((c) => c.id === sourceId);
  const stale = Boolean(base && (!latest || latest.revision !== base.revision));
  const disabled = readOnly || !connected || pending.size > 0 || stale || busy;
  const candidates = cards.filter(
    (c) =>
      base &&
      c.id !== base.id &&
      flowAllowed(base, c) &&
      !base.links.some((l) => l.kind === 'flow' && l.targetId === c.id),
  );
  async function save(links: Card['links']) {
    if (!base || disabled) return;
    setBusy(true);
    const ok = await onPatch(base, { links });
    setBusy(false);
    if (ok) {
      setBase(undefined);
      onSource('');
      onTarget('');
      setMessage('흐름 연결을 저장했어요.');
    } else setMessage('저장하지 못했어요. 최신 연결을 확인해 주세요.');
  }
  return (
    <section className="flow-connection-editor" aria-label="흐름 연결 편집">
      <div className="story-section-heading">
        <div>
          <strong>흐름 연결</strong>
          <p>
            출발 사건·명령과 대상을 선택하세요. 배치 순서는 바뀌지 않습니다.
          </p>
        </div>
        <button
          className="button small"
          disabled={busy || pending.size > 0}
          onClick={onClose}
        >
          연결 편집 닫기
        </button>
      </div>
      <div className="story-connection-fields">
        <label>
          출발 카드
          <select
            aria-label="흐름 출발 카드"
            disabled={busy || pending.size > 0}
            value={sourceId}
            onChange={(e) => {
              onSource(e.target.value);
              onTarget('');
            }}
          >
            <option value="">출발을 선택하세요</option>
            {cards
              .filter(
                (c) =>
                  c.stage === 'events' &&
                  ['actor', 'command', 'event', 'policy'].includes(c.kind),
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {kinds[c.kind].label} · {c.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          대상 카드
          <select
            aria-label="흐름 대상 카드"
            value={targetId}
            onChange={(e) => onTarget(e.target.value)}
            disabled={!base || disabled}
          >
            <option value="">대상을 선택하세요</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {kinds[c.kind].label} · {c.title}
              </option>
            ))}
          </select>
        </label>
        {!readOnly && (
          <button
            className="button primary"
            disabled={
              disabled ||
              !candidates.some((c) => c.id === targetId) ||
              (base?.links.length || 0) >= 100
            }
            onClick={() =>
              base && void save([...base.links, { kind: 'flow', targetId }])
            }
          >
            흐름 연결 추가
          </button>
        )}
      </div>
      {base?.status === 'agreed' && !readOnly && (
        <p className="field-help">
          흐름을 변경하면 이 카드의 합의 상태가 제안으로 돌아갑니다.
        </p>
      )}
      {stale && (
        <div className="story-conflict" role="status">
          출발 카드가 변경됐어요. 현재 연결을 확인한 뒤 다시 편집하세요.
          {latest && (
            <button
              className="button small"
              disabled={busy || pending.size > 0}
              onClick={() => {
                setBase(latest);
                onTarget('');
                setMessage('');
              }}
            >
              최신 연결 불러오기
            </button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {base && (
        <ul className="story-links">
          {base.links
            .filter((l) => l.kind === 'flow')
            .map((link) => (
              <li key={link.targetId}>
                <span>
                  {base.title} →{' '}
                  {cards.find((c) => c.id === link.targetId)?.title ||
                    '삭제된 대상'}
                </span>
                {!readOnly && (
                  <button
                    className="button small"
                    aria-label={`흐름 연결 삭제: ${base.title} → ${cards.find((c) => c.id === link.targetId)?.title || link.targetId}`}
                    disabled={disabled}
                    onClick={() =>
                      void save(
                        base.links.filter(
                          (l) =>
                            !(
                              l.kind === 'flow' && l.targetId === link.targetId
                            ),
                        ),
                      )
                    }
                  >
                    연결 삭제
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
      {base && !base.links.some((l) => l.kind === 'flow') && (
        <p className="field-help">이 카드에서 나가는 흐름 연결이 없습니다.</p>
      )}
    </section>
  );
}
