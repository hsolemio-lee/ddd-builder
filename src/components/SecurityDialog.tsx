import { useEffect, useState } from 'react';
import type { User } from '../types';
import { api } from '../api';
import Modal from './Modal';

type Account = User & { email: string; siteAdmin: boolean; disabled: boolean };
type Audit = {
  id: string;
  at: string;
  requestId: string;
  actorId: string | null;
  event: string;
  outcome: string;
  projectId?: string;
  targetId?: string;
};
export default function SecurityDialog({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<Account[]>([]);
  const [events, setEvents] = useState<Audit[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [accounts, audit] = await Promise.all([
      api<{ users: Account[] }>('/admin/users'),
      api<{ events: Audit[] }>('/admin/audit'),
    ]);
    setUsers(accounts.users);
    setEvents(audit.events);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  async function change(
    account: Account,
    update: { disabled?: boolean; siteAdmin?: boolean },
  ) {
    setBusy(true);
    setError('');
    try {
      await api(`/admin/users/${account.id}`, 'PATCH', update);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '권한을 바꾸지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="계정과 감사 기록"
      className="mcp-modal"
      closeDisabled={busy}
      onClose={onClose}
    >
      <div className="share-body access-dialog">
        <p className="muted">
          계정 접근을 차단하면 기존 세션과 MCP 토큰도 철회됩니다. 마지막 활성
          관리자는 먼저 권한을 이전해야 합니다.
        </p>
        {users.map((account) => (
          <div className="access-row" key={account.id}>
            <div>
              <strong>
                {account.name}
                {account.id === user.id ? ' (나)' : ''}
              </strong>
              <small>
                {account.email} ·{' '}
                {account.disabled
                  ? '접근 차단'
                  : account.siteAdmin
                    ? '운영 관리자'
                    : '참여자'}
              </small>
            </div>
            <button
              className="button small"
              disabled={busy}
              onClick={() => change(account, { siteAdmin: !account.siteAdmin })}
            >
              {account.siteAdmin ? '운영 권한 해제' : '운영 권한 부여'}
            </button>
            <button
              className="button small"
              disabled={busy}
              onClick={() => change(account, { disabled: !account.disabled })}
            >
              {account.disabled ? '접근 재개' : '접근 차단'}
            </button>
          </div>
        ))}
        <h4>최근 감사 기록</h4>
        <p className="muted">
          최신 100건입니다. 카드 본문과 인증 비밀값은 기록하지 않습니다.
        </p>
        <div className="audit-list">
          {events.map((event) => (
            <div className="audit-row" key={event.id}>
              <strong>
                {event.event} · {event.outcome}
              </strong>
              <small>
                {new Date(event.at).toLocaleString()} ·{' '}
                {users.find((u) => u.id === event.actorId)?.name ||
                  '미인증 사용자'}
              </small>
              <code>요청 {event.requestId}</code>
            </div>
          ))}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
