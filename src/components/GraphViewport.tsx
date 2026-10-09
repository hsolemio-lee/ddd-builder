import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import Modal from './Modal';

export default function GraphViewport({
  title,
  width,
  height,
  expanded,
  onExpandedChange,
  onAvailableWidth,
  tools,
  children,
}: {
  title: string;
  width: number;
  height: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onAvailableWidth?: (width: number) => void;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [heightLimit, setHeightLimit] = useState(650);
  const expandButton = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const drag = useRef<
    { x: number; y: number; left: number; top: number } | undefined
  >(undefined);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setAvailable(element.clientWidth);
      onAvailableWidth?.(element.clientWidth);
      setHeightLimit(parseFloat(getComputedStyle(element).maxHeight) || 650);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, onAvailableWidth]);
  useEffect(() => {
    if (wasExpanded.current && !expanded)
      expandButton.current?.focus({ preventScroll: true });
    wasExpanded.current = expanded;
  }, [expanded]);
  // Keep text readable on phones; the canvas scrolls without widening the page.
  const fitted =
    available < 600 && !expanded
      ? 1
      : Math.max(
          0.25,
          Math.min(1, (available - 24) / width, heightLimit / height),
        );
  const scale = zoom === 'fit' ? fitted : zoom;
  const changeZoom = (delta: number) =>
    setZoom(Math.max(0.25, Math.min(1.5, scale + delta)));
  const content = (
    <div className={`graph-view ${expanded ? 'graph-expanded' : ''}`}>
      <div
        className="graph-controls"
        role="group"
        aria-label={`${title} 화면 조절`}
      >
        <div className="graph-zoom">
          <button
            className="button small"
            aria-label="축소"
            disabled={scale <= 0.25}
            onClick={() => changeZoom(-0.1)}
          >
            <Minus size={16} />
          </button>
          <output aria-label="확대 비율">{Math.round(scale * 100)}%</output>
          <button
            className="button small"
            aria-label="확대"
            disabled={scale >= 1.5}
            onClick={() => changeZoom(0.1)}
          >
            <Plus size={16} />
          </button>
          <button
            className="button small"
            aria-pressed={zoom === 'fit'}
            onClick={() => {
              setZoom('fit');
              viewport.current?.scrollTo(0, 0);
            }}
          >
            화면 맞춤
          </button>
          <button
            className="button small"
            aria-pressed={zoom === 1}
            onClick={() => setZoom(1)}
          >
            기본 크기
          </button>
        </div>
        {tools}
        {!expanded && (
          <button
            className="button small"
            ref={expandButton}
            onClick={() => onExpandedChange(true)}
          >
            <Maximize2 size={15} /> 넓게 보기
          </button>
        )}
      </div>
      <p className="graph-help">
        전체 관계는 화면 맞춤으로, 카드 내용은 확대해서 보세요. 배경을
        드래그하거나 스크롤해 이동할 수 있어요.
      </p>
      <div
        className="graph-scroll"
        ref={viewport}
        tabIndex={0}
        aria-label={`${title} 캔버스, 가로와 세로로 이동할 수 있습니다`}
        onPointerDownCapture={(event) => {
          if ((event.target as Element).closest('[data-graph-move]'))
            setZoom(scale);
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            event.pointerType !== 'mouse' ||
            (event.target as Element).closest('button, a, input, select')
          )
            return;
          const element = event.currentTarget;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
          };
          element.setPointerCapture(event.pointerId);
          element.classList.add('dragging');
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollLeft =
            drag.current.left + drag.current.x - event.clientX;
          event.currentTarget.scrollTop =
            drag.current.top + drag.current.y - event.clientY;
        }}
        onLostPointerCapture={(event) => {
          drag.current = undefined;
          event.currentTarget.classList.remove('dragging');
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div
          className="graph-stage"
          style={{ width: width * scale, height: height * scale }}
        >
          <div
            className="graph-transform"
            style={{ width, height, transform: `scale(${scale})` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
  return expanded ? (
    <Modal
      title={`${title} 넓게 보기`}
      className="graph-modal"
      onClose={() => onExpandedChange(false)}
    >
      {content}
    </Modal>
  ) : (
    content
  );
}
