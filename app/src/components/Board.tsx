// The Kanban board. Owns the dnd-kit DndContext and renders five Columns
// (now / next / later / complete / dropped). It derives column card lists from
// the current snapshot:
//   - only TOP-LEVEL tasks (parent_id === null) become cards,
//   - the active store filter (all / mine / claude) hides non-matching cards,
//   - subtask progress (n/m), link counts and the reopened flag come from the snapshot,
//   - cards are ordered by their `position`.
//
// A DragOverlay renders a copy of the dragged card that follows the cursor, so a
// card dragged across column borders stays visible instead of snapping back.
//
// On drag end:
//   - if the card's column (status) changed  -> store.moveTask(id, newStatus)
//   - if it was reordered within a column     -> store.reorderTasks(orderedIds)

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { Status, Task, TaskLink } from 'shared';
import { useStore, type Filter } from '../store';
import Column, { type ColumnCard } from './Column';
import { CardView } from './Card';
import NextGoal from './NextGoal';

const COLUMNS: { status: Status; name: string }[] = [
  { status: 'now', name: 'Now' },
  { status: 'next', name: 'Next' },
  { status: 'later', name: 'Later' },
  { status: 'complete', name: 'Complete' },
  { status: 'dropped', name: 'Dropped' },
];

function matchesFilter(task: Task, filter: Filter): boolean {
  if (filter === 'mine') return task.source === 'you';
  if (filter === 'claude') return task.source === 'claude';
  return true;
}

/** Resolve which column status a drop target belongs to. The target id is
 *  either a column droppable id ("column:<status>") or a card id. */
function statusOfOverId(overId: string, byId: Map<string, Task>): Status | null {
  if (overId.startsWith('column:')) {
    return overId.slice('column:'.length) as Status;
  }
  return byId.get(overId)?.status ?? null;
}

export default function Board() {
  const snapshot = useStore((s) => s.snapshot);
  const filter = useStore((s) => s.filter);
  const moveTask = useStore((s) => s.moveTask);
  const reorderTasks = useStore((s) => s.reorderTasks);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    // A small activation distance lets plain clicks through to card selection.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const tasks = snapshot?.tasks ?? [];
  const links: TaskLink[] = snapshot?.links ?? [];

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const linkCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of links) {
      m.set(l.from_task_id, (m.get(l.from_task_id) ?? 0) + 1);
      m.set(l.to_task_id, (m.get(l.to_task_id) ?? 0) + 1);
    }
    return m;
  }, [links]);

  const subtaskRollup = useMemo(() => {
    const total = new Map<string, number>();
    const done = new Map<string, number>();
    for (const t of tasks) {
      if (t.parent_id) {
        total.set(t.parent_id, (total.get(t.parent_id) ?? 0) + 1);
        if (t.status === 'complete') {
          done.set(t.parent_id, (done.get(t.parent_id) ?? 0) + 1);
        }
      }
    }
    return { total, done };
  }, [tasks]);

  // Build the per-column, filtered, position-sorted card lists.
  const columns = useMemo(() => {
    const top = tasks
      .filter((t) => t.parent_id === null && matchesFilter(t, filter))
      .slice()
      .sort((a, b) => a.position - b.position);

    const buckets: Record<Status, ColumnCard[]> = {
      now: [],
      next: [],
      later: [],
      complete: [],
      dropped: [],
    };
    for (const t of top) {
      buckets[t.status].push({
        id: t.id,
        ref: t.ref,
        title: t.title,
        priority: t.priority,
        kind: t.kind,
        version: t.version,
        source: t.source,
        totalSubtasks: subtaskRollup.total.get(t.id) ?? 0,
        doneSubtasks: subtaskRollup.done.get(t.id) ?? 0,
        linkCount: linkCounts.get(t.id) ?? 0,
        reopened: !!t.reopened_at,
      });
    }
    return buckets;
  }, [tasks, filter, subtaskRollup, linkCounts]);

  // Completion ratio for the Complete column's bar: done / active cards
  // (now + next + later + complete). Dropped tasks don't count against progress.
  const activeTotal =
    columns.now.length + columns.next.length + columns.later.length + columns.complete.length;
  const completion = activeTotal === 0 ? 0 : columns.complete.length / activeTotal;

  // The card currently being dragged (for the overlay copy).
  const activeCard = useMemo<ColumnCard | null>(() => {
    if (!activeId) return null;
    for (const col of COLUMNS) {
      const found = columns[col.status].find((c) => c.id === activeId);
      if (found) return found;
    }
    return null;
  }, [activeId, columns]);

  function onDragStart(event: DragStartEvent) {
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    setActiveId(String(event.active.id));
  }

  function endDrag() {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setActiveId(null);
  }

  function onDragEnd(event: DragEndEvent) {
    endDrag();
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeTask = byId.get(activeId);
    if (!activeTask) return;

    const fromStatus = activeTask.status;
    const toStatus = statusOfOverId(overId, byId);
    if (!toStatus) return;

    if (fromStatus !== toStatus) {
      void moveTask(activeId, toStatus);
      return;
    }

    const ids = columns[fromStatus].map((c) => c.id);
    const oldIndex = ids.indexOf(activeId);
    const newIndex = overId.startsWith('column:') ? ids.length - 1 : ids.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    void reorderTasks(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <div className="board-shell">
      <NextGoal />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragCancel={endDrag}
        onDragEnd={onDragEnd}
      >
        <div className="board">
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              name={col.name}
              cards={columns[col.status]}
              completion={col.status === 'complete' ? completion : undefined}
            />
          ))}
        </div>
        <DragOverlay>{activeCard ? <CardView data={activeCard} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
