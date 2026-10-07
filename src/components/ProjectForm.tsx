import { useState, type FormEvent } from 'react';
import { Plus, Check, Trash2 } from 'lucide-react';
import type { Project } from '../types';
import { api } from '../api';
import Modal from './Modal';

export default function ProjectForm({
  project,
  onClose,
  onSaved,
  onDeleted,
}: {
  project?: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [sample, setSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api<Project>(
        project ? `/projects/${project.id}` : '/projects',
        project ? 'PATCH' : 'POST',
        {
          name: name.trim(),
          description,
          ...(project ? { revision: project.revision } : { sample }),
        },
      );
      onSaved(saved);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !project ||
      !confirm(
        `“${project.name}” 프로젝트와 모든 카드를 삭제할까요? 먼저 내보내기로 백업할 수 있습니다.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${project.id}`, 'DELETE', {
        revision: project.revision,
      });
      onDeleted();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '삭제하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={project ? '프로젝트 설정' : '새 프로젝트'}
      onClose={onClose}
      closeDisabled={busy}
    >
      <form className="project-form" onSubmit={submit}>
        <p className="muted">함께 탐색할 도메인에 이름을 붙여 주세요.</p>
        <label>
          프로젝트 이름
          <input
            autoFocus
            aria-label="프로젝트 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 우리 팀의 예약 서비스"
            required
            maxLength={100}
          />
        </label>
        <label>
          프로젝트 목적
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="누구의 어떤 문제를 해결하고 싶나요?"
            rows={3}
            maxLength={10000}
          />
        </label>
        {!project && (
          <label className="check-label sample-check">
            <input
              type="checkbox"
              aria-label="예시 카드로 시작"
              checked={sample}
              onChange={(e) => setSample(e.target.checked)}
            />
            <span>
              예시 카드로 시작
              <small>
                주문 서비스 예시를 수정하며 사용법을 익힐 수 있어요.
              </small>
            </span>
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          {project && (
            <button
              type="button"
              className="icon-button danger"
              aria-label="프로젝트 삭제"
              disabled={busy}
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
          <button className="button primary" disabled={busy}>
            {project ? <Check size={16} /> : <Plus size={16} />}
            {busy ? '저장 중…' : project ? '변경 저장' : '프로젝트 만들기'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
