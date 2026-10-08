import { useEffect, useId, useState } from 'react';
import DOMPurify from 'dompurify';

let renderer: Promise<(typeof import('mermaid'))['default']> | undefined;
function getRenderer() {
  renderer ||= import('mermaid')
    .then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        maxTextSize: 20000,
        maxEdges: 300,
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme: 'neutral',
        fontFamily: 'system-ui, sans-serif',
      });
      return mermaid;
    })
    .catch((error) => {
      renderer = undefined;
      throw error;
    });
  return renderer;
}
function sanitizeSvg(svg: string) {
  const safe = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'image', 'a'],
    FORBID_ATTR: ['href', 'xlink:href'],
  });
  const doc = new DOMParser().parseFromString(safe, 'image/svg+xml');
  const cleanCss = (css: string) =>
    css
      .replace(/@import[^;]+;?/gi, '')
      .replace(/url\(([^)]*)\)/gi, (whole, ref: string) =>
        /^#[\w:-]+$/.test(ref.trim().replace(/^['"]|['"]$/g, ''))
          ? whole
          : 'none',
      );
  for (const element of doc.querySelectorAll('*')) {
    if (element.tagName === 'style')
      element.textContent = cleanCss(element.textContent || '');
    for (const attr of [...element.attributes])
      if (/url\(/i.test(attr.value))
        element.setAttribute(attr.name, cleanCss(attr.value));
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
export default function ContextRelationships({
  text,
  format = 'text',
  compact = false,
}: {
  text: string;
  format?: string;
  compact?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [result, setResult] = useState<{
    source: string;
    svg?: string;
    error?: string;
  }>();
  useEffect(() => {
    if (format !== 'mermaid' || !text.trim()) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        if (text.length > 20000 || /%%\s*\{|^\s*---/m.test(text))
          throw new Error('설정 지시문 대신 다이어그램 본문만 입력해 주세요.');
        const mermaid = await getRenderer();
        const { svg } = await mermaid.render(`context-diagram-${id}`, text);
        if (active) setResult({ source: text, svg: sanitizeSvg(svg) });
      } catch (error) {
        if (active)
          setResult({
            source: text,
            error:
              error instanceof Error
                ? error.message
                : '다이어그램을 그리지 못했어요.',
          });
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [text, format, id]);
  if (format !== 'mermaid')
    return (
      <p className="context-text">{text || '컨텍스트 관계를 작성해 주세요.'}</p>
    );
  if (!text.trim())
    return (
      <p className="field-help">Mermaid 본문을 입력하면 미리보기가 나타나요.</p>
    );
  const current = result?.source === text ? result : undefined;
  return (
    <div className={`context-diagram ${compact ? 'compact' : ''}`}>
      {current?.svg ? (
        <div
          className="mermaid-svg"
          role="img"
          aria-label="컨텍스트 관계 다이어그램"
          dangerouslySetInnerHTML={{ __html: current.svg }}
        />
      ) : current?.error ? (
        <div className="diagram-error" role="status">
          <strong>Mermaid 문법을 확인해 주세요.</strong>
          {!compact && <pre>{current.error}</pre>}
        </div>
      ) : (
        <p className="field-help" role="status">
          다이어그램을 그리는 중…
        </p>
      )}
      {!compact && (
        <details>
          <summary>다이어그램 원문</summary>
          <pre className="diagram-source">{text}</pre>
        </details>
      )}
    </div>
  );
}
