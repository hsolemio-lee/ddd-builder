import { useEffect, useState, type FormEvent } from 'react';
import type { Project, ProjectRole } from '../types';
import { api } from '../api';
import Modal from './Modal';

type Member = {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
};
type Invitation = {
  id: string;
  email: string;
  role: ProjectRole;
  expiresAt: string;
};
type Credential = {
  id: string;
  name: string;
  projectId: string;
  scope: 'read' | 'write';
  expiresAt: string;
  createdAt: string;
};
type Info = {
  urls: string[];
  runtime?: string;
  mcp: { command: string; args: string[]; env: Record<string, string> };
};
const roleNames = { admin: '관리자', editor: '편집자', viewer: '조회자' };

export default function AccessDialog({
  mode,
  project,
  onClose,
}: {
  mode: 'share' | 'mcp';
  project?: Project;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<Info>();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [tokens, setTokens] = useState<Credential[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [name, setName] = useState('AI 분석');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [days, setDays] = useState(7);
  const [freshToken, setFreshToken] = useState('');
  const [freshCredential, setFreshCredential] = useState<Credential>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = project?.role === 'admin';
  const canWrite = admin || project?.role === 'editor';
  useEffect(() => {
    if (!canWrite) setScope('read');
  }, [canWrite]);
  async function refresh() {
    if (mode === 'share' && admin && project) {
      const access = await api<{
        members: Member[];
        invitations: Invitation[];
      }>(`/projects/${project.id}/access`);
      setMembers(access.members);
      setInvites(access.invitations);
    }
    if (mode === 'mcp') {
      const { tokens: next } = await api<{ tokens: Credential[] }>('/tokens');
      setTokens(next.filter((t) => t.projectId === project?.id));
    }
  }
  useEffect(() => {
    let active = true;
    api<Info>('/info')
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    refresh().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
    // Dialog is remounted when project or mode changes.
  }, []);
  async function action(run: () => Promise<unknown>) {
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
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('복사했어요.');
    } catch {
      setError('아래 내용을 선택해서 복사해 주세요.');
    }
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    await action(async () => {
      await api(`/projects/${project.id}/invitations`, 'POST', {
        email: email.trim(),
        role,
      });
      setEmail('');
      setNotice('초대를 등록했어요. 접속 주소를 팀원에게 직접 전달해 주세요.');
    });
  }
  async function createToken(event: FormEvent) {
    event.preventDefault();
    if (!project) return;
    await action(async () => {
      const result = await api<{ token: string; credential: Credential }>(
        '/tokens',
        'POST',
        { projectId: project.id, name: name.trim(), scope, days },
      );
      setFreshToken(result.token);
      setFreshCredential(result.credential);
    });
  }
  const config =
    info && freshToken
      ? JSON.stringify(
          {
            mcpServers: {
              'ddd-builder': {
                ...info.mcp,
                env: {
                  ...Object.fromEntries(
                    Object.entries(info.mcp.env).filter(
                      ([key]) => key !== 'DDD_CODE',
                    ),
                  ),
                  DDD_TOKEN: freshToken,
                  DDD_READ_ONLY: String(freshCredential?.scope !== 'write'),
                },
              },
            },
          },
          null,
          2,
        )
      : '';
  return (
    <Modal
      title={mode === 'share' ? '프로젝트 멤버와 초대' : '외부 AI 연결'}
      onClose={onClose}
      closeDisabled={busy}
      className="mcp-modal"
    >
      <div className="share-body access-dialog">
        <h3>{project?.name || '프로젝트를 먼저 선택해 주세요.'}</h3>
        {info?.urls.slice(0, 1).map((url) => (
          <div className="copy-row" key={url}>
            <code>{url}</code>
            <button className="button small" onClick={() => copy(url)}>
              주소 복사
            </button>
          </div>
        ))}
        {mode === 'share' && (
          <>
            <p className="muted">
              초대받은 이메일의 개인 계정으로 로그인합니다. 초대 등록 후 접속
              주소를 직접 전달해 주세요.
            </p>
            {admin && project ? (
              <>
                <form onSubmit={invite} className="login-form access-form">
                  <label>
                    초대할 이메일
                    <input
                      type="email"
                      value={email}
                      maxLength={254}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label>
                    프로젝트 권한
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as ProjectRole)}
                      disabled={busy}
                    >
                      {Object.entries(roleNames).map(([key, title]) => (
                        <option key={key} value={key}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button primary" disabled={busy}>
                    초대 등록
                  </button>
                </form>
                <h4>멤버</h4>
                {members.map((member) => (
                  <div className="access-row" key={member.userId}>
                    <div>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                    </div>
                    <select
                      aria-label={`${member.name} 권한`}
                      value={member.role}
                      disabled={busy}
                      onChange={(e) =>
                        action(() =>
                          api(
                            `/projects/${project.id}/members/${member.userId}`,
                            'PATCH',
                            { role: e.target.value },
                          ),
                        )
                      }
                    >
                      {Object.entries(roleNames).map(([key, title]) => (
                        <option key={key} value={key}>
                          {title}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button small"
                      disabled={busy}
                      onClick={() =>
                        action(() =>
                          api(
                            `/projects/${project.id}/members/${member.userId}`,
                            'DELETE',
                          ),
                        )
                      }
                    >
                      접근 철회
                    </button>
                  </div>
                ))}
                <h4>대기 중인 초대</h4>
                {invites.length === 0 && (
                  <p className="muted">대기 중인 초대가 없습니다.</p>
                )}
                {invites.map((invite) => (
                  <div className="access-row" key={invite.id}>
                    <div>
                      <strong>{invite.email}</strong>
                      <small>
                        {roleNames[invite.role]} ·{' '}
                        {new Date(invite.expiresAt).toLocaleDateString()} 만료
                      </small>
                    </div>
                    <button
                      className="button small"
                      disabled={busy}
                      onClick={() =>
                        action(() =>
                          api(
                            `/projects/${project.id}/invitations/${invite.id}`,
                            'DELETE',
                          ),
                        )
                      }
                    >
                      초대 취소
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <p className="dialog-note">
                초대와 권한 변경은 프로젝트 관리자가 할 수 있어요.
              </p>
            )}
          </>
        )}
        {mode === 'mcp' && (
          <>
            <p className="muted">
              선택한 프로젝트에만 접근하는 개인 토큰을 만듭니다. 토큰이
              만료되거나 철회되면 AI의 접근도 중단됩니다.
            </p>
            <form className="login-form access-form" onSubmit={createToken}>
              <label>
                연결 이름
                <input
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
              <label>
                유효 기간
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  disabled={busy}
                >
                  <option value={1}>1일</option>
                  <option value={7}>7일</option>
                  <option value={30}>30일</option>
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={scope === 'write'}
                  onChange={(e) =>
                    setScope(e.target.checked ? 'write' : 'read')
                  }
                  disabled={busy || !canWrite}
                />
                <span>
                  이 프로젝트의 카드 편집 허용
                  <small>
                    기본은 읽기 전용입니다. 계정·멤버·프로젝트 관리는 허용하지
                    않아요.
                  </small>
                </span>
              </label>
              <button className="button primary" disabled={busy || !project}>
                새 MCP 토큰 만들기
              </button>
            </form>
            {freshToken && (
              <div className="generated-token">
                <p className="dialog-note">
                  원문 토큰은 이 창에서 한 번만 제공합니다. 비밀번호처럼
                  보관하고 Git이나 채팅에 올리지 마세요.
                </p>
                <pre className="config-block" tabIndex={0}>
                  {config || freshToken}
                </pre>
                <button
                  className="button"
                  disabled={!config}
                  onClick={() => copy(config)}
                >
                  MCP 설정 복사
                </button>
              </div>
            )}
            <h4>내 연결</h4>
            {tokens.length === 0 && (
              <p className="muted">생성한 토큰이 없습니다.</p>
            )}
            {tokens.map((token) => (
              <div className="access-row" key={token.id}>
                <div>
                  <strong>{token.name}</strong>
                  <small>
                    {token.scope === 'read' ? '읽기 전용' : '카드 편집'} ·{' '}
                    {new Date(token.expiresAt).toLocaleDateString()} 만료
                  </small>
                </div>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api(`/tokens/${token.id}`, 'DELETE');
                      if (freshCredential?.id === token.id) {
                        setFreshToken('');
                        setFreshCredential(undefined);
                      }
                    })
                  }
                >
                  토큰 철회
                </button>
              </div>
            ))}
            <p className="dialog-note">
              MCP는 AI 클라이언트가 실행하는 stdio 방식으로 별도 공개 포트가
              필요 없습니다. 같은 호스트에서는 위 Docker/Node 명령을 사용합니다.
              다른 컴퓨터에서는 저장소를 설치하고 로컬 mcp/index.mjs를 실행하며
              DDD_URL에 공개 HTTPS 주소를 지정해 주세요.
            </p>
            <p className="dialog-note">
              AI가 읽은 내용은 연결한 모델에 전달될 수 있어요. 프로젝트 책임자가
              허용한 데이터만 분석하고, 쓰기 전에 AI의 제안을 검토해 주세요.
            </p>
          </>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
