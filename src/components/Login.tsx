import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Blocks,
  Check,
  Users,
  LockKeyhole,
  Sparkles,
} from 'lucide-react';
import { api } from '../api';
import type { User } from '../types';

export default function Login({
  onJoin,
  compact = false,
  initialName,
}: {
  onJoin: (user: User) => void;
  compact?: boolean;
  initialName?: string;
}) {
  const [name, setName] = useState(
    initialName || localStorage.getItem('ddd-name') || '',
  );
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<'legacy' | 'oidc'>();
  useEffect(() => {
    let active = true;
    api<{ mode: 'legacy' | 'oidc' }>('/auth/config')
      .then(({ mode }) => {
        if (active) setAuthMode(mode);
      })
      .catch(() => {
        if (active)
          setError('로그인 설정을 확인하지 못했어요. 새로고침해 주세요.');
      });
    if (new URLSearchParams(location.search).has('login_error')) {
      setError(
        '로그인하지 못했어요. 계정의 이메일 인증과 프로젝트 초대를 확인해 주세요.',
      );
      history.replaceState(null, '', location.pathname);
    }
    return () => {
      active = false;
    };
  }, []);
  async function join(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api<{ user: User }>('/session', 'POST', {
        name: name.trim(),
        code: code.trim(),
      });
      localStorage.setItem('ddd-name', user.name);
      onJoin(user);
    } catch (error) {
      setError(error instanceof Error ? error.message : '접속하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  const form =
    authMode === 'oidc' ? (
      <div className="login-form">
        <p className="muted">초대받은 이메일의 계정으로 로그인해 주세요.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <a className="button primary login-submit" href="/api/auth/login">
          계정으로 로그인 <ArrowRight size={18} />
        </a>
      </div>
    ) : !authMode ? (
      <p className="muted" role="status">
        {error || '로그인 설정을 확인하는 중…'}
      </p>
    ) : (
      <form onSubmit={join} className="login-form">
        <label>
          이름
          <input
            aria-label="이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="팀에서 사용할 이름"
            autoComplete="nickname"
            maxLength={40}
            required
            autoFocus
          />
        </label>
        <label>
          접속 코드
          <input
            aria-label="접속 코드"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="호스트에게 받은 접속 코드"
            type="password"
            autoComplete="off"
            maxLength={200}
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary login-submit" disabled={busy}>
          {busy ? '작업 공간에 연결하는 중…' : '워크숍 참여하기'}
          <ArrowRight size={18} />
        </button>
      </form>
    );
  if (compact)
    return (
      <div className="rejoin-content">
        <p className="muted">
          {authMode === 'oidc'
            ? '로그인 시간이 만료되었어요. 개인 계정으로 다시 로그인해 주세요.'
            : '서버가 재시작되었거나 참여 시간이 만료되었어요. 접속 코드를 입력해 다시 참여해 주세요. 작성 중인 내용은 그대로 보관하고 있어요.'}
        </p>
        {form}
      </div>
    );
  return (
    <div className="login-layout">
      <div className="login-story">
        <div className="brand brand-light">
          <span className="brand-symbol">
            <Blocks size={24} />
          </span>
          <span>
            ddd<span className="brand-slash">/</span>builder
          </span>
        </div>
        <div className="login-story-content">
          <div className="eyebrow">A SHARED SPACE FOR DOMAIN THINKING</div>
          <h1>
            좋은 설계는,
            <br />
            함께 나누는
            <br />
            <span>이야기에서.</span>
          </h1>
          <p>
            문제의 발견부터 구현의 첫걸음까지.
            <br />
            우리 팀의 도메인을 한곳에서 만들어 가요.
          </p>
          <div className="story-cards" aria-hidden="true">
            <div className="story-card story-orange">
              <span>도메인 이벤트</span>
              <strong>주문이 접수되었다</strong>
              <small>작은 사건에서 출발해요</small>
            </div>
            <div className="story-connector">→</div>
            <div className="story-card story-green">
              <span>바운디드 컨텍스트</span>
              <strong>주문 관리</strong>
              <small>함께 의미를 찾아가요</small>
            </div>
          </div>
        </div>
        <div className="login-footnote">
          <span>
            <Users size={16} /> 사람과 함께
          </span>
          <span>
            <Sparkles size={16} /> AI와 함께
          </span>
          <span>
            <LockKeyhole size={15} /> 우리 로컬에서
          </span>
        </div>
      </div>
      <main className="login-main">
        <div className="login-form-wrap">
          <span className="tiny-tag">LET’S BUILD TOGETHER</span>
          <h2>워크숍에 오신 걸 환영해요.</h2>
          <p className="muted">
            이름을 알려주고, 팀의 작업 공간에 참여해 주세요.
          </p>
          {form}
          <div className="login-note">
            <Check size={17} />
            <p>
              {authMode === 'oidc'
                ? '개인 계정과 프로젝트 권한으로 안전하게 참여해요.'
                : '별도 가입 없이 참여할 수 있어요.'}
              <br />
              <span>
                {authMode === 'oidc'
                  ? '관리자가 초대한 사용자만 참여할 수 있어요.'
                  : '서버를 실행한 분은 접속 코드 파일을 확인해 주세요.'}
              </span>
            </p>
          </div>
        </div>
        <div className="login-bottom">
          FROM DISCOVERY TO DESIGN · DDD BUILDER
        </div>
      </main>
    </div>
  );
}
