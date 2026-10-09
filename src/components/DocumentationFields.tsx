import type { CardDraft } from '../types';
import { documentationFields } from '../../shared/documentation-fields.mjs';

export default function DocumentationFields({
  draft,
  onChange,
}: {
  draft: CardDraft;
  onChange: (key: string, value: string) => void;
}) {
  const fields = documentationFields[draft.kind];
  if (!fields) return null;
  return (
    <details className="documentation-fields">
      <summary>구현 문서용 상세 항목</summary>
      <p className="field-help">
        컨텍스트별 문서에 포함할 내용을 기록하세요. 아래 예시는 가상의 생산계획
        정책이며 저장되지 않습니다. 비워 둔 항목은 문서에 ‘미작성’으로
        표시합니다.
      </p>
      {fields.map((field) => (
        <div className="documentation-field" key={field.key}>
          <label>
            {field.label}
            <textarea
              aria-label={field.label}
              rows={2}
              maxLength={20000}
              value={String(draft.data[field.key] || '')}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          </label>
          <p className="field-help">{field.help}</p>
          <p className="field-example">예: {field.example}</p>
        </div>
      ))}
    </details>
  );
}
