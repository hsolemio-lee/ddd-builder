import DocumentExport from './DocumentExport';
import { useEffect, useState } from 'react';
import {
  Copy,
  Check,
  Download,
  FileText,
  Braces,
  Network,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';
import Modal from './Modal';
import { api } from '../api';
import type { Card, Project } from '../types';

interface Info {
  urls: string[];
  runtime?: 'local' | 'docker';
  mcp: { command: string; args: string[]; env: Record<string, string> };
}
async function copy(text: string) {
  if (navigator.clipboard && window.isSecureContext)
    return navigator.clipboard.writeText(text);
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('텍스트를 선택해서 복사해 주세요.');
}
export default function ShareDialog({
  mode,
  project,
  cards = [],
  onClose,
}: {
  mode: 'share' | 'mcp' | 'export';
  project?: Project;
  cards?: Card[];
  onClose: () => void;
}) {
  const [info, setInfo] = useState<Info>();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [write, setWrite] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  useEffect(() => {
    let active = true;
    if (mode !== 'export')
      api<Info>('/info')
        .then((data) => {
          if (active) setInfo(data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [mode]);
  async function copyText(text: string, key: string) {
    try {
      await copy(text);
      setCopied(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : '복사하지 못했어요.');
    }
  }
  const config = info
    ? JSON.stringify(
        {
          mcpServers: {
            'ddd-builder': {
              ...info.mcp,
              env: { ...info.mcp.env, DDD_READ_ONLY: String(!write) },
            },
          },
        },
        null,
        2,
      )
    : '';
  const prompt = project
    ? `DDD Builder의 프로젝트 ${project.id} (${project.name})의 get_domain_documents로 docs/domain/index.md를 읽고 관련 컨텍스트의 용어·규칙·사례와 이벤트 스토밍 결과를 분석해줘. 중복 이벤트와 빠진 명령·행위자·정책을 확인하고, 바운디드 컨텍스트와 애그리게이트 경계를 제안해줘. 사실과 추론을 구분하고, 보드에 수정하기 전에 제안 내용을 보여줘.`
    : '';
  return (
    <Modal
      title={
        mode === 'share'
          ? '팀원 초대하기'
          : mode === 'mcp'
            ? '외부 AI 연결'
            : '결과 내보내기'
      }
      className={mode === 'mcp' ? 'mcp-modal' : ''}
      onClose={onClose}
    >
      <div className="share-body">
        {mode === 'share' && (
          <>
            <div className="dialog-illustration">
              <Network size={30} />
            </div>
            <h3>같은 공간에서, 같은 보드를.</h3>
            <p className="muted">
              같은 네트워크의 팀원에게 접속 주소와 코드를 전달해 주세요. 각자의
              이름으로 바로 참여할 수 있어요.
            </p>
            <label>접속 주소</label>
            {info?.urls.map((url) => (
              <div className="copy-row" key={url}>
                <code>{url}</code>
                <button
                  className="icon-button"
                  aria-label={`주소 복사: ${url}`}
                  onClick={() => copyText(url, url)}
                >
                  {copied === url ? <Check size={17} /> : <Copy size={17} />}
                </button>
              </div>
            ))}
            {info && (
              <>
                <label>접속 코드</label>
                <div className="copy-row">
                  <code>{info.mcp.env.DDD_CODE}</code>
                  <button
                    className="icon-button"
                    aria-label="접속 코드 복사"
                    onClick={() => copyText(info.mcp.env.DDD_CODE, 'code')}
                  >
                    {copied === 'code' ? (
                      <Check size={17} />
                    ) : (
                      <Copy size={17} />
                    )}
                  </button>
                </div>
              </>
            )}
            <p className="dialog-note">
              호스트 컴퓨터에서 서버를 실행하는 동안 참여할 수 있어요. 접속이 안
              되면 같은 네트워크인지와 호스트의 방화벽 설정을 확인해 주세요.
            </p>
          </>
        )}
        {mode === 'export' && project && (
          <>
            <div className="dialog-illustration">
              <Download size={28} />
            </div>
            <h3>설계를 다음 작업으로 가져가요.</h3>
            <p className="muted">
              {project.name}의 문서 범위와 내보내기 형식을 선택하세요.
            </p>
            <DocumentExport project={project} cards={cards} />
            <a
              className="export-option"
              href={`/api/projects/${project.id}/export?format=markdown`}
              download
            >
              <FileText size={24} />
              <div>
                <strong>워크숍 기록 Markdown</strong>
                <p>단계별로 모든 카드를 나열한 기록입니다.</p>
              </div>
              <ArrowUpRight size={18} />
            </a>
            <a
              className="export-option"
              href={`/api/projects/${project.id}/export?format=json`}
              download
            >
              <Braces size={24} />
              <div>
                <strong>JSON 백업</strong>
                <p>전체 설계 데이터를 파일로 보관해요.</p>
              </div>
              <ArrowUpRight size={18} />
            </a>
          </>
        )}
        {mode === 'mcp' && (
          <>
            <div className="ai-dialog-intro">
              <span className="dialog-illustration">
                <Sparkles size={26} />
              </span>
              <div>
                <h3>AI도 우리 팀의 보드를 읽을 수 있어요.</h3>
                <p className="muted">
                  MCP를 지원하는 로컬 AI 클라이언트에 연결해 분석과 정리를 맡겨
                  보세요.
                </p>
              </div>
            </div>
            <ol className="mcp-instructions">
              <li>
                <span>1</span>
                <div>
                  <strong>앱 서버를 켜 두세요</strong>
                  <p>
                    {info?.runtime === 'docker'
                      ? 'Docker Desktop과 앱 컨테이너를 실행해 두세요. AI 클라이언트는 docker 명령으로 컨테이너 안의 MCP에 연결합니다.'
                      : '아래 설정은 이 컴퓨터에서 실행하는 AI 클라이언트용입니다.'}
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>MCP 서버 설정을 추가하세요</strong>
                  <p>
                    JSON 설정을 지원하는 클라이언트는 복사해 붙여 넣으세요. 다른
                    형식에서는 표시된 실행 명령과 환경 변수를 등록해 주세요.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>프로젝트 분석을 요청하세요</strong>
                  <p>연결된 AI는 최신 보드와 컨텍스트별 구현 문서를 읽어요.</p>
                </div>
              </li>
            </ol>
            <label className="check-label mcp-permission">
              <input
                type="checkbox"
                checked={write}
                onChange={(e) => setWrite(e.target.checked)}
              />
              <span>
                AI가 보드를 수정하도록 허용
                <small>
                  {write
                    ? '카드 추가·수정 도구가 활성화됩니다. 변경은 팀원에게 실시간 공유돼요.'
                    : '읽기 전용으로 연결합니다. AI는 분석과 제안을 할 수 있어요.'}
                </small>
              </span>
            </label>
            <div className="config-actions">
              <button
                className="button primary"
                disabled={!info}
                onClick={() => copyText(config, 'config')}
              >
                {copied === 'config' ? <Check size={16} /> : <Copy size={16} />}
                {copied === 'config' ? '설정 복사됨' : 'MCP 설정 복사'}
              </button>
              <button
                className="text-button"
                onClick={() => setShowConfig(!showConfig)}
              >
                {showConfig ? '설정 접기' : '설정 보기'}
              </button>
            </div>
            {showConfig && (
              <pre className="config-block" tabIndex={0}>
                {config || '설정을 불러오는 중…'}
              </pre>
            )}
            {project && (
              <div className="ai-prompt">
                <label>이렇게 요청해 보세요</label>
                <p>{prompt}</p>
                <button
                  className="button small"
                  onClick={() => copyText(prompt, 'prompt')}
                >
                  {copied === 'prompt' ? (
                    <Check size={14} />
                  ) : (
                    <Copy size={14} />
                  )}
                  분석 요청 복사
                </button>
              </div>
            )}
            <p className="dialog-note">
              AI 클라이언트의 모델로 분석합니다. 연결 설정을 추가해도 자동으로
              분석을 실행하지 않아요.{' '}
              {info?.runtime === 'docker'
                ? '이 설정은 Docker가 실행 중인 호스트의 AI 클라이언트용입니다. 기존 Node 실행용 MCP 설정을 사용했다면 새 설정으로 교체해 주세요.'
                : '다른 컴퓨터에서 연결하려면 저장소를 복사하고 실행 경로와 DDD_URL을 변경해 주세요.'}
            </p>
          </>
        )}
        {mode !== 'export' && !info && !error && (
          <p className="muted">접속 정보를 불러오는 중…</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
