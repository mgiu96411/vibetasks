// A thin draggable divider used to resize layout panels. Reports incremental
// pointer deltas via onResize; the store clamps + persists the resulting size.
//   - orientation="vertical"   → a vertical bar dragged horizontally (col-resize); delta = dx
//   - orientation="horizontal" → a horizontal bar dragged vertically  (row-resize); delta = dy
// Position it with the `style` prop (e.g. { left: sidebarW } or { right: rightW }).

import { useCallback, type CSSProperties } from 'react';

interface Props {
  orientation: 'vertical' | 'horizontal';
  onResize: (delta: number) => void;
  style?: CSSProperties;
}

export default function ResizeHandle({ orientation, onResize, style }: Props) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      let last = orientation === 'vertical' ? e.clientX : e.clientY;
      const move = (ev: PointerEvent) => {
        const cur = orientation === 'vertical' ? ev.clientX : ev.clientY;
        onResize(cur - last);
        last = cur;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [orientation, onResize],
  );

  return (
    <div
      className={`resize-handle ${orientation}`}
      style={style}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
