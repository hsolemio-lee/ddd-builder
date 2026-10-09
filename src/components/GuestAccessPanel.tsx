import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

type Invitation = {
  id: string;
  name: string;
  role: 'viewer' | 'editor';
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};
type Guest = {
  userId: string;
  name: string;
  role: 'viewer' | 'editor';
  expiresAt: string;
  revokedAt: string | null;
};
type Access = { enabled: boolean; invitations: Invitation[]; guests: Guest[] };
const roles = { viewer: '조회자', editor: '편집자' };

export default function GuestAccessPanel({ projectId }: { projectId: string }) {
  const [access, setAccess] = useState<Access>();
  const [name, setName] = useState('게스트 초대');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [days, setDays] = useState(1);
  const [fresh, setFresh] = useState<{
    code: string;
    invitation: Invitation;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function refresh() {
    const value = await api<Access>(`/projects/${projectId}/guest-access`);
    setAccess(value);
    setFresh((current) => {
      if (!current) return current;
      const invite = value.invitations.find(
        (entry) => entry.id === current.invitation.id,
      );
      return value.enabled &&
        invite &&
        !invite.usedAt &&
        !invite.revokedAt &&
        new Date(invite.expiresAt).getTime() > Date.now()
        ? current
        : undefined;
    });
  }
  useEffect(() => {
    let active = true;
    api<Access>(`/projects/${projectId}/guest-access`)
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  async function action(run: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '변경하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      setFresh(
        await api<{ code: string; invitation: Invitation }>(
          `/projects/${projectId}/guest-invitations`,
          'POST',
          { name: name.trim(), role, days },
        ),
      );
    });
  }
  const expired = (date: string) => new Date(date).getTime() <= Date.now();
  return (
    <section className="guest-access-panel" aria-label="게스트 초대 관리">
      <h4>게스트 초대 코드</h4>
      <p className="muted">
        기존 계정 로그인을 유지하면서 이 프로젝트에만 게스트를 초대합니다.
        코드는 1회용이며 원문은 발급 직후에만 확인할 수 있습니다.
      </p>
      {!access && !error && <p role="status">게스트 설정을 불러오는 중…</p>}
      {access && (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              aria-label="이 프로젝트의 게스트 참여 허용"
              checked={access.enabled}
              disabled={busy}
              onChange={(e) => {
                const enabled = e.target.checked;
                if (
                  !enabled &&
                  !confirm(
                    '게스트 참여를 중단하면 발급된 코드와 기존 게스트 세션을 모두 철회합니다. 중단할까요?',
                  )
                )
                  return;
                action(async () => {
                  await api(`/projects/${projectId}/guest-access`, 'PATCH', {
                    enabled,
                  });
                  setFresh(undefined);
                });
              }}
            />
            <span>이 프로젝트의 게스트 참여 허용</span>
          </label>
          <p className="dialog-note">
            게스트 세션은 최대 12시간, 30분간 요청이 없으면 만료됩니다. 게스트는
            프로젝트 관리와 MCP 토큰 발급을 할 수 없습니다.
          </p>
          {access.enabled && (
            <form className="login-form access-form" onSubmit={create}>
              <label>
                초대 이름
                <input
                  aria-label="게스트 초대 이름"
                  value={name}
                  maxLength={80}
                  required
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                게스트 권한
                <select
                  aria-label="게스트 권한"
                  value={role}
                  disabled={busy}
                  onChange={(e) =>
                    setRole(e.target.value as 'viewer' | 'editor')
                  }
                >
                  {Object.entries(roles).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                초대 코드 유효 기간
                <select
                  aria-label="초대 코드 유효 기간"
                  value={days}
                  disabled={busy}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {[1, 3, 7].map((day) => (
                    <option key={day} value={day}>
                      {day}일
                    </option>
                  ))}
                </select>
              </label>
              <button className="button primary" disabled={busy}>
                게스트 초대 코드 발급
              </button>
            </form>
          )}
          {fresh && (
            <div className="guest-code-result">
              <label>
                발급된 게스트 초대 코드
                <input
                  aria-label="발급된 게스트 초대 코드"
                  readOnly
                  value={fresh.code}
                  autoComplete="off"
                />
              </label>
              <p className="dialog-note">
                {roles[fresh.invitation.role]} ·{' '}
                {new Date(fresh.invitation.expiresAt).toLocaleString()}까지 1회
                사용. 접속 주소와 이 코드를 초대 대상자에게 전달하세요.
              </p>
              <button
                type="button"
                className="button small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fresh.code);
                    setNotice('초대 코드를 복사했어요.');
                  } catch {
                    setError('코드를 선택해서 복사해 주세요.');
                  }
                }}
              >
                게스트 코드 복사
              </button>
            </div>
          )}
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => action(async () => {})}
          >
            게스트 목록 새로고침
          </button>
          <h5>발급한 코드</h5>
          {access.invitations.length === 0 && (
            <p className="muted">발급한 코드가 없습니다.</p>
          )}
          {access.invitations.map((invite) => (
            <div className="access-row" key={invite.id}>
              <div>
                <strong>{invite.name}</strong>
                <small>
                  {roles[invite.role]} ·{' '}
                  {invite.revokedAt
                    ? '철회됨'
                    : invite.usedAt
                      ? '사용됨'
                      : expired(invite.expiresAt)
                        ? '만료됨'
                        : `${new Date(invite.expiresAt).toLocaleString()} 만료`}
                </small>
              </div>
              {!invite.revokedAt && (
                <button
                  type="button"
                  className="button small"
                  disabled={busy}
                  aria-label={`게스트 초대 철회: ${invite.name}`}
                  onClick={() =>
                    action(async () => {
                      await api(
                        `/projects/${projectId}/guest-invitations/${invite.id}`,
                        'DELETE',
                      );
                      if (fresh?.invitation.id === invite.id)
                        setFresh(undefined);
                    })
                  }
                >
                  초대 철회
                </button>
              )}
            </div>
          ))}
          <p className="dialog-note">
            사용된 코드를 철회하면 해당 코드로 참여한 게스트의 세션도
            차단됩니다.
          </p>
          <h5>참여한 게스트</h5>
          {access.guests.length === 0 && (
            <p className="muted">참여한 게스트가 없습니다.</p>
          )}
          {access.guests.map((guest) => (
            <div className="access-row" key={guest.userId}>
              <div>
                <strong>{guest.name} · 게스트</strong>
                <small>
                  {guest.userId.slice(0, 8)} ·{' '}
                  {guest.revokedAt
                    ? '철회됨'
                    : expired(guest.expiresAt)
                      ? '만료됨'
                      : `${new Date(guest.expiresAt).toLocaleString()}까지`}
                </small>
              </div>
              {!guest.revokedAt && !expired(guest.expiresAt) && (
                <>
                  <select
                    aria-label={`게스트 권한: ${guest.name}`}
                    value={guest.role}
                    disabled={busy}
                    onChange={(e) => {
                      const nextRole = e.target.value;
                      action(() =>
                        api(
                          `/projects/${projectId}/members/${guest.userId}`,
                          'PATCH',
                          { role: nextRole },
                        ),
                      );
                    }}
                  >
                    {Object.entries(roles).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button small"
                    disabled={busy}
                    aria-label={`게스트 접근 철회: ${guest.name}`}
                    onClick={() =>
                      action(() =>
                        api(
                          `/projects/${projectId}/guests/${guest.userId}`,
                          'DELETE',
                        ),
                      )
                    }
                  >
                    접근 철회
                  </button>
                </>
              )}
            </div>
          ))}
        </>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
