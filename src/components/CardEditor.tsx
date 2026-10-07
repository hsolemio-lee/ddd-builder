import { useState, type FormEvent } from 'react';
import { Check, Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import type { Card, CardDraft, Kind, Stage, User } from '../types';
import { kinds, steps } from '../workflow';
import { api, ApiError } from '../api';
import Modal from './Modal';

export default function CardEditor({
  card,
  stage,
  kind,
  projectId,
  cards,
  user,
  connected,
  onClose,
  onSaved,
}: {
  card?: Card;
  stage: Stage;
  kind?: Kind;
  projectId: string;
  cards: Card[];
  user: User;
  connected: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [base, setBase] = useState(card);
  const [draft, setDraft] = useState<CardDraft>(
    card
      ? { ...card, data: { ...card.data } }
      : {
          stage,
          kind: kind || steps.find((s) => s.id === stage)!.kinds[0],
          title: '',
          description: '',
          contextId: null,
          data: {},
          position:
            Math.max(
              0,
              ...cards.filter((c) => c.stage === stage).map((c) => c.position),
            ) + 1,
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<Card>();
  const contexts = cards.filter((c) => c.stage === 'contexts');
  const latest = base && cards.find((c) => c.id === base.id);
  const remoteChanged = base && (!latest || latest.revision !== base.revision);
  const meta = kinds[draft.kind];
  function dataField(key: string, value: string | boolean) {
    setDraft((d) => ({ ...d, data: { ...d.data, [key]: value } }));
  }
  function reload() {
    const current = conflict || latest;
    if (!current) {
      setError(
        '이 카드가 삭제되었어요. 내용을 복사해 새 카드로 남길 수 있어요.',
      );
      return;
    }
    setBase(current);
    setDraft({ ...current, data: { ...current.data } });
    setConflict(undefined);
    setError('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !connected) return;
    setBusy(true);
    setError('');
    const payload = {
      kind: draft.kind,
      title: draft.title.trim(),
      description: draft.description,
      contextId: draft.contextId,
      data: draft.data,
      position: draft.position,
    };
    try {
      if (base)
        await api(`/cards/${base.id}`, 'PATCH', {
          ...payload,
          revision: base.revision,
        });
      else
        await api(`/projects/${projectId}/cards`, 'POST', {
          ...payload,
          stage: draft.stage,
        });
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(error.current as Card);
        setError('다른 참여자가 먼저 수정했어요.');
      } else
        setError(error instanceof Error ? error.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!base || !confirm('이 카드를 삭제할까요? 팀의 보드에서도 삭제됩니다.'))
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/cards/${base.id}`, 'DELETE', { revision: base.revision });
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(error.current as Card);
        setError('다른 참여자가 먼저 수정했어요.');
      } else
        setError(error instanceof Error ? error.message : '삭제하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={base ? '카드 편집' : '새 카드 만들기'}
      className="editor-modal"
      onClose={onClose}
      closeDisabled={busy}
    >
      <form className="editor-form" onSubmit={save}>
        <div className={`editor-type type-${meta.color}`}>
          <span className="color-dot" />
          {meta.label}
          <span>{meta.description}</span>
        </div>
        <div className="editor-fields">
          {steps.find((s) => s.id === draft.stage)!.kinds.length > 1 && (
            <label>
              카드 유형
              <select
                value={draft.kind}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, kind: e.target.value as Kind }))
                }
              >
                {steps
                  .find((s) => s.id === draft.stage)!
                  .kinds.map((k) => (
                    <option key={k} value={k}>
                      {kinds[k].label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            제목
            <input
              aria-label="제목"
              autoFocus
              required
              maxLength={160}
              placeholder={meta.placeholder}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
          </label>
          <label>
            {draft.stage === 'contexts' ? '책임과 역할' : '설명'}
            <textarea
              aria-label="설명"
              rows={4}
              maxLength={10000}
              placeholder={
                draft.stage === 'contexts'
                  ? '이 컨텍스트가 담당하는 일과 경계를 설명해 주세요.'
                  : '팀에 공유할 맥락이나 구체적인 내용을 적어 주세요.'
              }
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </label>
          {['events', 'aggregates', 'tasks'].includes(draft.stage) && (
            <label>
              소속 컨텍스트
              <select
                value={draft.contextId || ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, contextId: e.target.value || null }))
                }
              >
                <option value="">미분류</option>
                {contexts.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.stage === 'contexts' && (
            <label>
              다른 컨텍스트와의 관계
              <textarea
                rows={3}
                placeholder="예: 배송 관리에 주문 정보를 전달한다."
                value={String(draft.data.relationships || '')}
                onChange={(e) => dataField('relationships', e.target.value)}
                maxLength={10000}
              />
            </label>
          )}
          {draft.stage === 'aggregates' && (
            <>
              <label>
                애그리게이트 루트
                <input
                  placeholder="예: Order"
                  value={String(draft.data.root || '')}
                  onChange={(e) => dataField('root', e.target.value)}
                  maxLength={10000}
                />
              </label>
              <label>
                엔티티
                <textarea
                  rows={2}
                  placeholder="예: Order, OrderLine (각 항목을 한 줄씩)"
                  value={String(draft.data.entities || '')}
                  onChange={(e) => dataField('entities', e.target.value)}
                  maxLength={10000}
                />
              </label>
              <label>
                값 객체
                <textarea
                  rows={2}
                  placeholder="예: Money, ShippingAddress"
                  value={String(draft.data.valueObjects || '')}
                  onChange={(e) => dataField('valueObjects', e.target.value)}
                  maxLength={10000}
                />
              </label>
              <label>
                항상 지켜야 할 규칙
                <textarea
                  rows={3}
                  placeholder="예: 주문에는 최소 하나의 상품이 있어야 한다."
                  value={String(draft.data.invariants || '')}
                  onChange={(e) => dataField('invariants', e.target.value)}
                  maxLength={10000}
                />
              </label>
            </>
          )}
          {draft.stage === 'tasks' && (
            <>
              <label>
                담당자
                <input
                  placeholder={user.name}
                  value={String(draft.data.assignee || '')}
                  onChange={(e) => dataField('assignee', e.target.value)}
                  maxLength={40}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.data.done === true}
                  onChange={(e) => dataField('done', e.target.checked)}
                />
                완료한 작업
              </label>
            </>
          )}
          {remoteChanged && !error && (
            <div className="inline-notice">
              <AlertCircle size={16} />
              다른 참여자가 이 카드를 변경했어요. 현재 입력한 내용은 유지됩니다.
            </div>
          )}
          {error && (
            <div className="conflict-notice" role="alert">
              <strong>{error}</strong>
              {conflict && (
                <>
                  <p>
                    입력한 내용은 유지했어요. 필요한 내용을 복사한 뒤 최신
                    버전을 불러와 주세요.
                  </p>
                  <button
                    type="button"
                    className="button small"
                    onClick={reload}
                  >
                    <RefreshCw size={14} />
                    최신 내용 불러오기
                  </button>
                </>
              )}
            </div>
          )}
          {base && (
            <p className="editor-meta">
              최근 수정: {base.updatedBy || '참여자'} ·{' '}
              {new Date(base.updatedAt).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
        <div className="editor-footer">
          {base && (
            <button
              type="button"
              className="icon-button danger"
              aria-label="카드 삭제"
              disabled={busy || !connected}
              onClick={remove}
            >
              <Trash2 size={18} />
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || !connected}
          >
            <Check size={16} />
            {busy ? '저장 중…' : '카드 저장'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
