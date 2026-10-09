import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { Card, Project } from '../types';
import type { DomainDocuments } from '../../shared/documents.mjs';
import { api } from '../api';

export default function DocumentExport({
  project,
  cards,
}: {
  project: Project;
  cards: Card[];
}) {
  const [contextId, setContextId] = useState('');
  const [bundle, setBundle] = useState<DomainDocuments>();
  const [path, setPath] = useState('docs/domain/index.md');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const contexts = cards.filter(
    (c) => c.projectId === project.id && c.kind === 'context',
  );
  const query = contextId ? `&contextId=${encodeURIComponent(contextId)}` : '';
  useEffect(() => {
    let active = true;
    setBundle(undefined);
    setError('');
    api<DomainDocuments>(
      `/projects/${encodeURIComponent(project.id)}/documents${contextId ? `?contextId=${encodeURIComponent(contextId)}` : ''}`,
    )
      .then((data) => {
        if (active) {
          setBundle(data);
          setPath('docs/domain/index.md');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [project.id, contextId, refresh]);
  const file = bundle?.files.find((f) => f.path === path);
  return (
    <section className="document-export" aria-label="컨텍스트별 구현 문서">
      <h4>컨텍스트별 구현 문서</h4>
      <p className="muted">
        책임·용어·규칙·검증 사례·애그리게이트를 문서로 묶습니다. 입력한 내용으로
        생성하며 빈 항목은 ‘미작성’으로 표시합니다.
      </p>
      <label>
        문서 범위
        <select
          aria-label="문서 범위"
          value={contextId}
          onChange={(e) => setContextId(e.target.value)}
        >
          <option value="">프로젝트 전체</option>
          {contexts.map((c) => (
            <option value={c.id} key={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <a
        className="export-option"
        href={`/api/projects/${encodeURIComponent(project.id)}/export?format=documents${query}`}
        download
      >
        <Download size={24} />
        <div>
          <strong>구현 문서 묶음 ZIP</strong>
          <p>AGENTS.md 진입점과 컨텍스트별 Markdown, 원본 JSON을 포함합니다.</p>
        </div>
      </a>
      <p className="dialog-note">
        보드를 원본으로 관리하고 변경 후 다시 내보내세요. 기존 저장소에 적용할
        때 AGENTS.md와 문서 경로를 확인하세요.
      </p>
      <details className="document-preview">
        <summary>생성 문서 미리보기</summary>
        <button
          type="button"
          className="button small"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={14} />
          최신 보드로 새로고침
        </button>
        {!bundle && !error && <p role="status">문서를 생성하고 있어요…</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {bundle && (
          <>
            <label>
              미리볼 문서
              <select
                aria-label="미리볼 문서"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              >
                {bundle.files.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            </label>
            {file && (
              <pre
                className="document-content"
                aria-label="문서 내용"
                tabIndex={0}
              >
                {file.content}
              </pre>
            )}
          </>
        )}
      </details>
    </section>
  );
}
