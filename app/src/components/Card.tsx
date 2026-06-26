// A single Kanban card. `CardView` is the presentational card — it's reused by the
// drag overlay (Board) so the dragged card follows the cursor instead of snapping
// back to its column. `Card` wraps CardView with dnd-kit's useSortable.
//
// Card shows: a left priority rail, the title, a priority tag, a "✦ Claude" marker,
// subtask progress "n/m", a link badge, and a "⟲ Reopened" badge when the task was
// moved back out of Complete.

import { forwardRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Priority, Kind } from 'shared';
import { useStore } from '../store';

const PRIORITY_LABEL: Record<Priority, string> = {
  none: '',
  low: 'Low',
  med: 'Med',
  high: 'High',
};

const KIND_LABEL: Record<Kind, string> = {
  none: '',
  fix: 'Fix',
  feature: 'Feature',
  chore: 'Chore',
  rule: 'Rule',
  docs: 'Docs',
};

// Bold the first occurrence of the search query inside a card title. Returns the
// plain string when there's no query or no match (e.g. a body-/number-only match).
function renderTitle(title: string, query?: string): React.ReactNode {
  const q = query?.trim().toLowerCase();
  if (!q) return title;
  const idx = title.toLowerCase().indexOf(q);
  if (idx === -1) return title;
  return (
    <>
      {title.slice(0, idx)}
      <mark className="title-match">{title.slice(idx, idx + q.length)}</mark>
      {title.slice(idx + q.length)}
    </>
  );
}

export interface CardData {
  id: string;
  ref: number;
  title: string;
  priority: Priority;
  kind: Kind;
  version: string;
  source: 'claude' | 'you';
  /** completed subtasks count */
  doneSubtasks: number;
  /** total subtasks count (0 == no subtasks) */
  totalSubtasks: number;
  /** number of dependency/related links this task participates in */
  linkCount: number;
  /** true when the task was moved out of Complete (reopened) */
  reopened: boolean;
}

interface CardViewProps extends React.HTMLAttributes<HTMLDivElement> {
  data: CardData;
  /** rendered inside a DragOverlay (follows the cursor) */
  overlay?: boolean;
  /** when set, the matching substring of the title is bolded (board search) */
  titleQuery?: string;
}

// Presentational card. Forwards a ref so the sortable wrapper can attach it.
export const CardView = forwardRef<HTMLDivElement, CardViewProps>(function CardView(
  { data, overlay, className, titleQuery, ...rest },
  ref,
) {
  const { ref: refNum, title, priority, kind, version, source, doneSubtasks, totalSubtasks, linkCount, reopened } = data;
  return (
    <div
      ref={ref}
      className={`card${overlay ? ' card-overlay' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      <span className={`priority-rail ${priority}`} />

      <div className="card-title">{renderTitle(title, titleQuery)}</div>

      <div className="card-meta">
        {refNum > 0 && <span className="card-ref">#{refNum}</span>}

        {kind !== 'none' && (
          <span className={`badge kind-${kind}`}>{KIND_LABEL[kind]}</span>
        )}

        {version && <span className="badge version-badge">{version}</span>}

        {priority !== 'none' && (
          <span className={`badge priority-${priority}`}>{PRIORITY_LABEL[priority]}</span>
        )}

        {source === 'claude' && (
          <span className="claude-marker">
            <span className="star">✦</span> Claude
          </span>
        )}

        {totalSubtasks > 0 && (
          <span className="badge subtask">
            {doneSubtasks}/{totalSubtasks}
          </span>
        )}

        {linkCount > 0 && <span className="badge link-badge">⛓ {linkCount}</span>}

        {reopened && <span className="badge reopened-badge">⟲ Reopened</span>}
      </div>
    </div>
  );
});

// Sortable card placed in a column. Clicking selects it (opens TaskDetail).
export default function Card({ data }: { data: CardData }) {
  const selectTask = useStore((s) => s.selectTask);
  const highlightedTaskId = useStore((s) => s.highlightedTaskId);
  const search = useStore((s) => s.search);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: data.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // The moving copy is rendered by the Board's DragOverlay, so hide the source
    // (keeps its slot/gap) — this is what stops the card from "snapping back".
    opacity: isDragging ? 0 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <CardView
      ref={setNodeRef}
      style={style}
      data={data}
      titleQuery={search}
      className={data.id === highlightedTaskId ? 'is-highlighted' : undefined}
      onClick={() => selectTask(data.id)}
      {...attributes}
      {...listeners}
    />
  );
}
