import { useEffect, useRef, useState } from 'react';
import {
  Blocks,
  Plus,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  Settings2,
  Search,
  Lightbulb,
  Share2,
  Download,
  Sparkles,
  LogOut,
  Menu,
  X,
  Check,
  HelpCircle,
  WifiOff,
  LoaderCircle,
} from 'lucide-react';
import type { User, Workspace, Project, Stage, Card, Kind } from './types';
import { api, ApiError } from './api';
import { kinds, steps } from './workflow';
import Login from './components/Login';
import Board from './components/Board';
import CardEditor from './components/CardEditor';
import ProjectForm from './components/ProjectForm';
import ShareDialog from './components/ShareDialog';
import Modal from './components/Modal';
import CardDetails from './components/CardDetails';
import AccessDialog from './components/AccessDialog';
import SecurityDialog from './components/SecurityDialog';
import FlowBoard from './components/FlowBoard';
import DesignReview from './components/DesignReview';
import ContextMap from './components/ContextMap';
import AggregateBoard from './components/AggregateBoard';
import LearningGuide from './components/LearningGuide';
import { normalizeCard, statuses, scenarios } from '../shared/design.mjs';

function normalizeWorkspace(value: Workspace): Workspace {
  return { ...value, cards: value.cards.map(normalizeCard) };
}
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspace, setWorkspace] = useState<Workspace>({
    projects: [],
    cards: [],
  });
  const [projectId, setProjectId] = useState(
    localStorage.getItem('ddd-project') || '',
  );
  const [stage, setStage] = useState<Stage>('events');
  const [presence, setPresence] = useState<User[]>([]);
  const [connected, setConnected] = useState(false);
  const [editor, setEditor] = useState<{
    card?: Card;
    kind?: Kind;
    stage: Stage;
    projectId: string;
  }>();
  const [projectForm, setProjectForm] = useState<{ project?: Project }>();
  const [dialog, setDialog] = useState<'share' | 'mcp' | 'export'>();
  const [guide, setGuide] = useState<Stage>();
  const [details, setDetails] = useState<Card>();
  const [securityOpen, setSecurityOpen] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [contextFilter, setContextFilter] = useState('all');
  const [scenarioFilter, setScenarioFilter] = useState('all');
  const [view, setView] = useState<'cards' | 'flow' | 'map' | 'aggregate'>(
    'cards',
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [receivedState, setReceivedState] = useState(false);
  const [needsJoin, setNeedsJoin] = useState(false);
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState(new Set<string>());
  useEffect(() => {
    let active = true;
    api<{ user: User }>('/session')
      .then((value) => {
        if (active) setUser(value.user);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const source = new EventSource('/api/events');
    source.addEventListener('state', (event) => {
      if (!active) return;
      try {
        setWorkspace(
          normalizeWorkspace(JSON.parse((event as MessageEvent).data)),
        );
        setConnected(true);
        setReceivedState(true);
      } catch {
        setNotice('보드 데이터를 읽지 못했어요. 새로고침해 주세요.');
      }
    });
    function applyUser(next: User) {
      if (!active) return;
      if (next.id !== user!.id) {
        setWorkspace({ projects: [], cards: [] });
        setEditor(undefined);
        setDetails(undefined);
        setProjectForm(undefined);
        setDialog(undefined);
        setSecurityOpen(false);
        setReceivedState(false);
        setProjectId('');
        localStorage.removeItem('ddd-project');
      }
      setUser((current) =>
        current &&
        current.id === next.id &&
        current.siteAdmin === next.siteAdmin &&
        current.email === next.email &&
        current.name === next.name
          ? current
          : next,
      );
      if (!next.siteAdmin) setSecurityOpen(false);
    }
    source.addEventListener('user', (event) => {
      if (!active) return;
      try {
        applyUser(JSON.parse((event as MessageEvent).data));
      } catch {
        /* reconnect refreshes the session */
      }
    });
    source.addEventListener('presence', (event) => {
      if (active) {
        try {
          setPresence(JSON.parse((event as MessageEvent).data));
        } catch {
          /* next presence event refreshes */
        }
      }
    });
    source.onerror = () => {
      if (!active) return;
      setConnected(false);
      api<{ user: User }>('/session')
        .then((session) => {
          applyUser(session.user);
          return api<Workspace>('/state');
        })
        .then((next) => {
          if (active) setWorkspace(normalizeWorkspace(next));
        })
        .catch((error) => {
          if (active && error instanceof ApiError && error.status === 401) {
            source.close();
            if (user.email) {
              setWorkspace({ projects: [], cards: [] });
              setEditor(undefined);
              setDetails(undefined);
              setProjectForm(undefined);
              setDialog(undefined);
              setSecurityOpen(false);
              setReceivedState(false);
              localStorage.removeItem('ddd-name');
              localStorage.removeItem('ddd-project');
              setUser(null);
            } else setNeedsJoin(true);
          }
        });
    };
    return () => {
      active = false;
      source.close();
      setConnected(false);
      setPresence([]);
    };
  }, [user]);
  useEffect(() => {
    if (projectId) localStorage.setItem('ddd-project', projectId);
  }, [projectId]);
  const project =
    workspace.projects.find((p) => p.id === projectId) || workspace.projects[0];
  const official = Boolean(user?.email);
  const canEdit =
    !official || ['admin', 'editor'].includes(project?.role || '');
  const canManage = !official || project?.role === 'admin';
  useEffect(() => {
    if (!official) return;
    if (
      editor &&
      !workspace.projects.some(
        (p) => p.id === editor.projectId && p.role !== 'viewer',
      )
    )
      setEditor(undefined);
    if (details && !workspace.cards.some((c) => c.id === details.id))
      setDetails(undefined);
  }, [official, workspace, editor, details]);
  const projectCards = workspace.cards.filter(
    (c) => c.projectId === project?.id,
  );
  const stepIndex = steps.findIndex((s) => s.id === stage);
  const step = steps[stepIndex];
  const stageCards = projectCards.filter((c) => c.stage === stage);
  const filledSteps = steps.filter((s) =>
    projectCards.some((c) => c.stage === s.id),
  ).length;
  const visibleCards = stageCards.filter(
    (c) =>
      (statusFilter === 'all' || c.status === statusFilter) &&
      (contextFilter === 'all' ||
        (contextFilter === 'none'
          ? !c.contextId
          : c.contextId === contextFilter)) &&
      (stage !== 'events' ||
        scenarioFilter === 'all' ||
        c.scenario === scenarioFilter ||
        c.scenario === 'shared'),
  );
  const displayedCards = visibleCards.filter(
    (c) =>
      (filter === 'all' || c.kind === filter) &&
      (!query ||
        `${c.title} ${c.description} ${c.decision} ${Object.values(c.data).join(' ')} ${JSON.stringify(c.aggregateDesign || '')}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const mapContexts = projectCards.filter((c) => c.kind === 'context');
  const mapScope = projectCards.filter((c) =>
    stage === 'contexts'
      ? c.stage === 'events' || c.stage === 'aggregates'
      : c.stage === 'events',
  );
  const mapMembers = mapScope.filter(
    (c) =>
      (statusFilter === 'all' || c.status === statusFilter) &&
      (stage === 'contexts' || filter === 'all' || c.kind === filter) &&
      (contextFilter === 'all' ||
        (contextFilter === 'none'
          ? !c.contextId
          : c.contextId === contextFilter)) &&
      (stage !== 'events' ||
        scenarioFilter === 'all' ||
        c.scenario === scenarioFilter ||
        c.scenario === 'shared') &&
      (!query ||
        `${c.title} ${c.description} ${c.decision} ${Object.values(c.data).join(' ')} ${JSON.stringify(c.aggregateDesign || '')} ${mapContexts.find((ctx) => ctx.id === c.contextId)?.title || ''}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const shownCount = view === 'map' ? mapMembers.length : displayedCards.length;
  const totalCount = view === 'map' ? mapScope.length : stageCards.length;
  function openCard(card: Card) {
    if (canEdit)
      setEditor({ card, stage: card.stage, projectId: card.projectId });
    else setDetails(card);
  }
  function resetDesignFilters(nextStage = stage) {
    setStatusFilter('all');
    setContextFilter('all');
    setScenarioFilter('all');
    setView(
      nextStage === 'contexts'
        ? 'map'
        : nextStage === 'aggregates'
          ? 'aggregate'
          : 'cards',
    );
  }
  function navigate(next: Stage) {
    resetDesignFilters(next);
    setStage(next);
    setFilter('all');
    setQuery('');
    setSidebar(false);
  }
  function notify(message: string) {
    setNotice(message);
  }
  async function patch(card: Card, change: Partial<Card>) {
    if (!canEdit || !connected || pendingRef.current.has(card.id)) return;
    pendingRef.current.add(card.id);
    setPending(new Set(pendingRef.current));
    setWorkspace((current) => ({
      ...current,
      cards: current.cards.map((c) =>
        c.id === card.id ? { ...c, ...change } : c,
      ),
    }));
    try {
      const saved = await api<Card>(`/cards/${card.id}`, 'PATCH', {
        ...change,
        revision: card.revision,
      });
      setWorkspace((current) => ({
        ...current,
        cards: current.cards.map((c) =>
          c.id === saved.id && c.revision <= saved.revision ? saved : c,
        ),
      }));
    } catch (error) {
      setWorkspace((current) => ({
        ...current,
        cards:
          error instanceof ApiError && error.status === 404
            ? current.cards.filter((c) => c.id !== card.id)
            : current.cards.map((c) => {
                if (c.id !== card.id) return c;
                if (
                  error instanceof ApiError &&
                  error.current &&
                  error.current.revision >= c.revision
                )
                  return error.current as Card;
                return c.revision <= card.revision ? card : c;
              }),
      }));
      notify(
        error instanceof ApiError && error.status === 409
          ? '다른 참여자가 먼저 수정했어요. 최신 보드를 확인하고 다시 시도해 주세요.'
          : error instanceof Error
            ? error.message
            : '변경하지 못했어요.',
      );
    } finally {
      pendingRef.current.delete(card.id);
      setPending(new Set(pendingRef.current));
    }
  }
  async function move(card: Card, direction: -1 | 1) {
    if (!canEdit || !connected || pendingRef.current.has(card.id)) return;
    pendingRef.current.add(card.id);
    setPending(new Set(pendingRef.current));
    try {
      await api(`/cards/${card.id}/move`, 'POST', {
        revision: card.revision,
        direction,
      });
    } catch (error) {
      notify(
        error instanceof Error ? error.message : '카드를 이동하지 못했어요.',
      );
    } finally {
      pendingRef.current.delete(card.id);
      setPending(new Set(pendingRef.current));
    }
  }
  async function logout() {
    try {
      await api('/session', 'DELETE');
      setUser(null);
      localStorage.removeItem('ddd-name');
      localStorage.removeItem('ddd-project');
      setProjectId('');
      setEditor(undefined);
      setDetails(undefined);
      setProjectForm(undefined);
      setDialog(undefined);
      setSecurityOpen(false);
      setReceivedState(false);
      setWorkspace({ projects: [], cards: [] });
    } catch (error) {
      notify(error instanceof Error ? error.message : '나가지 못했어요.');
    }
  }
  if (loading)
    return (
      <div className="app-loading">
        <Blocks size={32} />
        <span>워크숍을 준비하는 중…</span>
      </div>
    );
  if (!user) return <Login onJoin={setUser} />;
  return (
    <div className="app-layout">
      {sidebar && (
        <button
          className="sidebar-shade"
          aria-label="메뉴 닫기"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <span className="brand-symbol">
            <Blocks size={23} />
          </span>
          <span>
            ddd<span className="brand-slash">/</span>builder
          </span>
          <span className="beta-label">DESIGN</span>
        </div>
        <div className="workspace-switch">
          <div className="sidebar-label">작업 공간</div>
          <div className="project-select">
            <span className="project-icon">
              <Blocks size={17} />
            </span>
            <select
              aria-label="프로젝트 선택"
              value={project?.id || ''}
              onChange={(e) => {
                setProjectId(e.target.value);
                resetDesignFilters();
                setReviewOpen(false);
                setQuery('');
                setFilter('all');
              }}
            >
              <option value="" disabled>
                프로젝트를 선택하세요
              </option>
              {workspace.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
          <button
            className="new-project"
            aria-label="새 프로젝트"
            disabled={!connected}
            onClick={() => setProjectForm({})}
          >
            <Plus size={15} />새 프로젝트
          </button>
        </div>
        <div className="sidebar-label process-label">
          설계 프로세스<span>5 STEPS</span>
        </div>
        <nav className="step-nav">
          {steps.map((s, index) => {
            const Icon = s.icon;
            const count = projectCards.filter((c) => c.stage === s.id).length;
            return (
              <button
                key={s.id}
                className={`step-link ${stage === s.id ? 'active' : ''}`}
                onClick={() => navigate(s.id)}
                aria-current={stage === s.id ? 'step' : undefined}
                aria-label={`${s.title} 단계`}
              >
                <span className="step-icon">
                  <Icon size={19} />
                </span>
                <span className="step-link-text">
                  <small>STEP {String(index + 1).padStart(2, '0')}</small>
                  <strong>{s.title}</strong>
                </span>
                <span className="step-count">{count}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-spacer" />
        <button
          className="ai-connect-card"
          onClick={() => {
            setDialog('mcp');
            setSidebar(false);
          }}
        >
          <span className="ai-icon">
            <Sparkles size={18} />
          </span>
          <strong>AI와 함께 설계하기</strong>
          <span>
            MCP로 외부 AI를 연결해요
            <ArrowRight size={14} />
          </span>
        </button>
        <button
          className="guide-button"
          onClick={() => {
            setGuide(stage);
            setSidebar(false);
          }}
        >
          <HelpCircle size={17} />
          DDD 학습 가이드
          <ArrowUpMini />
        </button>
        {user.siteAdmin && (
          <button
            className="guide-button"
            onClick={() => setSecurityOpen(true)}
          >
            <Settings2 size={17} />
            계정과 감사 기록
          </button>
        )}
        <div className="sidebar-user">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            <strong>{user.name}</strong>
            <span>
              {official
                ? project?.role === 'admin'
                  ? '프로젝트 관리자'
                  : project?.role === 'editor'
                    ? '편집자'
                    : '조회자'
                : '워크숍 참여자'}
            </span>
          </div>
          <button
            className="icon-button"
            aria-label="워크숍 나가기"
            onClick={logout}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="단계 메뉴"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </button>
            <span>프로젝트</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{project?.name || '새로운 워크숍'}</strong>
            {project && canManage && (
              <button
                className="icon-button project-settings"
                aria-label="프로젝트 설정"
                disabled={!connected}
                onClick={() => setProjectForm({ project })}
              >
                <Settings2 size={15} />
              </button>
            )}
          </div>
          <div className="topbar-actions">
            <div className="presence">
              <div className="avatar-stack">
                {presence.slice(0, 3).map((p, i) => (
                  <span
                    className={`avatar avatar-${i}`}
                    key={p.id}
                    title={p.name}
                  >
                    {p.name.slice(0, 1)}
                  </span>
                ))}
              </div>
              <span>{presence.length}명 함께 작업 중</span>
            </div>
            <button
              className="button share-button"
              onClick={() => setDialog('share')}
            >
              <Share2 size={15} />
              <span>
                {official
                  ? canManage
                    ? '멤버 관리'
                    : '접속 주소'
                  : '초대하기'}
              </span>
            </button>
          </div>
        </header>
        {notice && (
          <div className="toast" role="alert">
            <span>{notice}</span>
            <button aria-label="알림 닫기" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </div>
        )}
        <main className="workspace-main">
          <div className="workspace-heading-row">
            <span className="step-eyebrow">
              <span>{String(stepIndex + 1).padStart(2, '0')}</span>
              {step.english}
            </span>
            <span
              className={`connection-status ${connected ? '' : 'disconnected'}`}
            >
              {connected ? (
                <>
                  <span className="live-dot" />
                  실시간 연결됨
                </>
              ) : (
                <>
                  <WifiOff size={13} />
                  연결을 복구하는 중
                </>
              )}
            </span>
          </div>
          <div className="workspace-hero">
            <div>
              <h1>{step.headline}</h1>
              <p>{step.description}</p>
            </div>
            <button
              className="button export-button"
              aria-label="결과 내보내기"
              disabled={!project || !connected}
              onClick={() => setDialog('export')}
            >
              <Download size={15} />
              <span>결과 내보내기</span>
            </button>
          </div>
          {!receivedState ? (
            <div className="workspace-loading">
              <LoaderCircle className="spin" size={24} />
              <p>서버에서 보드를 불러오고 있어요.</p>
            </div>
          ) : !project ? (
            <div className="empty-project">
              <div className="empty-project-icon">
                <Blocks size={36} />
              </div>
              <h2>첫 도메인 이야기를 시작해 볼까요?</h2>
              <p>프로젝트를 만들고 팀과 함께 문제를 탐색해 보세요.</p>
              <button
                className="button primary"
                disabled={!connected}
                onClick={() => setProjectForm({})}
              >
                <Plus size={16} />
                프로젝트 만들기
              </button>
            </div>
          ) : (
            <>
              <div className="workshop-tip">
                <span className="tip-icon">
                  <Lightbulb size={19} />
                </span>
                <p>
                  <strong>워크숍 팁</strong>
                  {step.tip}
                </p>
                <button
                  className="button small learning-open"
                  onClick={() => setGuide(stage)}
                >
                  <HelpCircle size={15} /> 이 단계 이론과 실습
                </button>
              </div>
              <div className="board-toolbar">
                <div className="board-view">
                  <Blocks size={16} />
                  <strong>{step.title} 보드</strong>
                  <span className="board-total">{stageCards.length}</span>
                </div>
                <div className="board-tools">
                  <div className="search-field">
                    <Search size={15} />
                    <input
                      aria-label="카드 검색"
                      placeholder="카드 검색"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  {step.kinds.length > 1 && (
                    <select
                      aria-label="카드 유형 필터"
                      className="filter-select"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">모든 유형</option>
                      {step.kinds.map((k) => (
                        <option key={k} value={k}>
                          {kinds[k].label}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="button primary"
                    aria-label="카드 추가"
                    disabled={!canEdit || !connected}
                    onClick={() => setEditor({ stage, projectId: project.id })}
                  >
                    <Plus size={16} />
                    카드 추가
                  </button>
                </div>
              </div>
              <div className="design-toolbar">
                {(stage === 'events' || stage === 'contexts') && (
                  <div
                    className="view-toggle"
                    role="group"
                    aria-label="보드 보기"
                  >
                    <button
                      className={view === 'map' ? 'active' : ''}
                      aria-pressed={view === 'map'}
                      onClick={() => setView('map')}
                    >
                      경계 보기
                    </button>
                    <button
                      className={view === 'cards' ? 'active' : ''}
                      aria-pressed={view === 'cards'}
                      onClick={() => setView('cards')}
                    >
                      카드 보기
                    </button>
                    <button
                      className={view === 'flow' ? 'active' : ''}
                      aria-pressed={view === 'flow'}
                      onClick={() => setView('flow')}
                    >
                      흐름 보기
                    </button>
                  </div>
                )}
                {stage === 'aggregates' && (
                  <div
                    className="view-toggle"
                    role="group"
                    aria-label="애그리게이트 보기"
                  >
                    <button
                      className={view === 'aggregate' ? 'active' : ''}
                      aria-pressed={view === 'aggregate'}
                      onClick={() => setView('aggregate')}
                    >
                      일관성 경계
                    </button>
                    <button
                      className={view === 'cards' ? 'active' : ''}
                      aria-pressed={view === 'cards'}
                      onClick={() => setView('cards')}
                    >
                      카드 보기
                    </button>
                  </div>
                )}
                <label>
                  검토 상태 필터
                  <select
                    aria-label="검토 상태 필터"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">모든 검토 상태</option>
                    {Object.entries(statuses).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {stage !== 'discovery' && stage !== 'contexts' && (
                  <label>
                    컨텍스트 필터
                    <select
                      aria-label="컨텍스트 필터"
                      value={contextFilter}
                      onChange={(e) => setContextFilter(e.target.value)}
                    >
                      <option value="all">모든 컨텍스트</option>
                      <option value="none">미분류</option>
                      {projectCards
                        .filter((c) => c.kind === 'context')
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {stage === 'events' && (
                  <label>
                    흐름 필터
                    <select
                      aria-label="흐름 필터"
                      value={scenarioFilter}
                      onChange={(e) => setScenarioFilter(e.target.value)}
                    >
                      <option value="all">모든 흐름</option>
                      {Object.entries(scenarios).map(([k, v]) => (
                        <option value={k} key={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="button"
                  aria-expanded={reviewOpen}
                  onClick={() => setReviewOpen(!reviewOpen)}
                >
                  설계 점검
                </button>
                <span className="visible-count">
                  {shownCount}/{totalCount}개
                  {view === 'map' ? ' 내부 카드' : ''} 표시
                </span>
              </div>
              {shownCount === 0 &&
                (query ||
                  filter !== 'all' ||
                  statusFilter !== 'all' ||
                  contextFilter !== 'all' ||
                  scenarioFilter !== 'all') && (
                  <div className="empty-search" role="status">
                    조건에 맞는 카드가 없어요.{' '}
                    <button
                      className="text-button"
                      onClick={() => {
                        setQuery('');
                        setFilter('all');
                        setStatusFilter('all');
                        setContextFilter('all');
                        setScenarioFilter('all');
                      }}
                    >
                      필터 초기화
                    </button>
                  </div>
                )}
              {reviewOpen && (
                <DesignReview
                  cards={projectCards}
                  stage={stage}
                  onOpen={openCard}
                />
              )}
              {view === 'aggregate' && stage === 'aggregates' ? (
                <AggregateBoard
                  cards={displayedCards}
                  allCards={projectCards}
                  readOnly={!canEdit}
                  onOpen={openCard}
                />
              ) : view === 'map' &&
                (stage === 'events' || stage === 'contexts') ? (
                <ContextMap
                  key={`${project.id}:${stage}`}
                  contexts={mapContexts}
                  members={mapMembers}
                  connected={connected}
                  pending={pending}
                  readOnly={!canEdit}
                  onOpen={openCard}
                  onPatch={patch}
                  onAdd={() =>
                    setEditor({
                      stage: 'contexts',
                      kind: 'context',
                      projectId: project.id,
                    })
                  }
                />
              ) : view === 'flow' &&
                (stage === 'events' || stage === 'contexts') ? (
                <FlowBoard
                  cards={displayedCards}
                  allCards={projectCards}
                  onOpen={openCard}
                />
              ) : (
                <Board
                  stage={stage}
                  cards={displayedCards}
                  allCards={projectCards}
                  query=""
                  filter={filter}
                  connected={connected}
                  pending={pending}
                  readOnly={!canEdit}
                  allowMove={
                    !query &&
                    statusFilter === 'all' &&
                    contextFilter === 'all' &&
                    scenarioFilter === 'all'
                  }
                  onEdit={openCard}
                  onAdd={(kind) =>
                    setEditor({ stage, kind, projectId: project.id })
                  }
                  onPatch={patch}
                  onMove={move}
                />
              )}
              <div className="step-footer">
                <div className="step-progress">
                  <span>{filledSteps}/5</span>
                  <div>
                    <strong>
                      작성 범위 · 합의 진행은 설계 점검에서 확인해요
                    </strong>
                    <p>
                      {filledSteps}개 단계에 카드가 있어요 · 단계는 자유롭게
                      오갈 수 있어요
                    </p>
                  </div>
                </div>
                <div className="step-footer-actions">
                  {stepIndex > 0 && (
                    <button
                      className="text-button"
                      onClick={() => navigate(steps[stepIndex - 1].id)}
                    >
                      <ArrowLeft size={14} />
                      이전 단계
                    </button>
                  )}
                  {stepIndex < 4 ? (
                    <button
                      className="button"
                      onClick={() => navigate(steps[stepIndex + 1].id)}
                    >
                      다음: {steps[stepIndex + 1].title}
                      <ArrowRight size={15} />
                    </button>
                  ) : (
                    <button
                      className="button"
                      onClick={() => setDialog('export')}
                    >
                      <Download size={15} />
                      설계 문서 가져가기
                    </button>
                  )}
                </div>
              </div>
              <div className="board-footnote">
                <span>
                  <Check size={13} />
                  저장한 변경은 팀원에게 공유됩니다
                </span>
                <span>좋은 질문이 좋은 도메인을 만듭니다.</span>
              </div>
            </>
          )}
        </main>
      </div>
      {editor && (
        <CardEditor
          key={
            editor.card?.id ||
            `${editor.projectId}-${editor.stage}-${editor.kind || 'new'}`
          }
          card={editor.card}
          kind={editor.kind}
          stage={editor.stage}
          cards={workspace.cards.filter(
            (c) => c.projectId === editor.projectId,
          )}
          projectId={editor.projectId}
          user={user}
          connected={connected}
          onClose={() => setEditor(undefined)}
          onSaved={() => notify('보드에 저장했어요.')}
        />
      )}
      {projectForm && (
        <ProjectForm
          project={projectForm.project}
          onClose={() => setProjectForm(undefined)}
          onSaved={(p) => {
            setProjectId(p.id);
            if (!projectForm.project) navigate('discovery');
            notify('프로젝트를 저장했어요.');
          }}
          onDeleted={() => {
            setProjectId('');
            notify('프로젝트를 삭제했어요.');
          }}
        />
      )}
      {details && (
        <CardDetails
          cards={projectCards}
          card={workspace.cards.find((c) => c.id === details.id) || details}
          onClose={() => setDetails(undefined)}
        />
      )}
      {securityOpen && (
        <SecurityDialog user={user} onClose={() => setSecurityOpen(false)} />
      )}
      {dialog && official && dialog !== 'export' && (
        <AccessDialog
          key={`${project?.id}-${dialog}`}
          mode={dialog}
          project={project}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog && (!official || dialog === 'export') && (
        <ShareDialog
          cards={projectCards}
          mode={dialog}
          project={project}
          onClose={() => setDialog(undefined)}
        />
      )}
      {guide && (
        <LearningGuide
          initialStage={guide}
          onClose={() => setGuide(undefined)}
          onPractice={(target) => {
            navigate(target);
            setGuide(undefined);
          }}
        />
      )}
      {needsJoin && (
        <Modal title="워크숍에 다시 참여하기" closeDisabled onClose={() => {}}>
          <Login
            compact
            initialName={user.name}
            onJoin={(joined) => {
              setNeedsJoin(false);
              setUser(joined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
function ArrowUpMini() {
  return <ArrowRight size={14} className="guide-arrow" />;
}
