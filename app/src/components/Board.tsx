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
  pointerWithin,
  closestCorners,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
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

// Pointer-first collision detection. `closestCorners` compares the dragged
// card's corners (a ~220px-wide rect that straddles 2-3 columns at once)
// against every droppable's corners, so a corner-distance tie can resolve to
// the wrong neighbour — which is why dropping into some columns (Next/Complete)
// silently failed. `pointerWithin` keys only off the cursor point, so the column
// the pointer is actually over always wins; we fall back to corner distance only
// when the pointer is outside every droppable (e.g. dragging past the board edge).
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : closestCorners(args);
};

function matchesFilter(task: Task, filter: Filter): boolean {
  if (filter === 'mine') return task.source === 'you';
  if (filter === 'claude') return task.source === 'claude';
  return true;
}

// Title is the primary target; task number (ref, prefix match) and body
// (brief + details) broaden recall so nothing is missed. Empty query matches all.
function matchesSearch(task: Task, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (String(task.ref).startsWith(q)) return true;
  if (task.title.toLowerCase().includes(q)) return true;
  const body = `${task.summary} ${task.description}`.toLowerCase();
  return body.includes(q);
}

export default function Board() {
  const snapshot = useStore((s) => s.snapshot);
  const filter = useStore((s) => s.filter);
  const search = useStore((s) => s.search);
  const clearHighlight = useStore((s) => s.clearHighlight);
  const moveTask = useStore((s) => s.moveTask);
  const reorderTasks = useStore((s) => s.reorderTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  // During a drag we keep a working copy of the column lists so siblings open a
  // live gap and the card previews at the hovered position (incl. across columns).
  // Committed to the backend on drop; null when not dragging (we render baseColumns).
  const [dragColumns, setDragColumns] = useState<Record<Status, ColumnCard[]> | null>(null);

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
  const baseColumns = useMemo(() => {
    const top = tasks
      .filter((t) => t.parent_id === null && matchesFilter(t, filter) && matchesSearch(t, search))
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
  }, [tasks, filter, search, subtaskRollup, linkCounts]);

  // While dragging, render the live working copy; otherwise the snapshot-derived lists.
  const columns = dragColumns ?? baseColumns;

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

  // Which column holds a given id in the working copy. Accepts a card id or a
  // "column:<status>" droppable id (the empty-space target on each column).
  function findContainer(cols: Record<Status, ColumnCard[]>, id: string): Status | null {
    if (id.startsWith('column:')) return id.slice('column:'.length) as Status;
    for (const col of COLUMNS) {
      if (cols[col.status].some((c) => c.id === id)) return col.status;
    }
    return null;
  }

  function onDragStart(event: DragStartEvent) {
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    setActiveId(String(event.active.id));
    // Seed the working copy from the current snapshot-derived lists.
    setDragColumns({
      now: [...baseColumns.now],
      next: [...baseColumns.next],
      later: [...baseColumns.later],
      complete: [...baseColumns.complete],
      dropped: [...baseColumns.dropped],
    });
  }

  function endDrag() {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setActiveId(null);
    setDragColumns(null);
  }

  // Live preview: relocate/reorder the active card to the hovered slot in the
  // working copy so siblings open a gap where it will land. We never move the
  // card INTO Complete here — that column is version-grouped + collapsible, and
  // dropping the active node into a collapsed (unrendered) section unmounts it
  // mid-drag → blank screen. Drops onto Complete are resolved in onDragEnd.
  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    setDragColumns((prev) => {
      if (!prev) return prev;
      const from = findContainer(prev, activeId);
      const to = findContainer(prev, overId);
      if (!from || !to || to === 'complete') return prev;

      const fromArr = prev[from];
      const toArr = prev[to];
      const activeIdx = fromArr.findIndex((c) => c.id === activeId);
      if (activeIdx === -1) return prev;

      // Hovering the column's empty space targets the end; over a card targets it.
      const overIdx = overId.startsWith('column:')
        ? toArr.length
        : toArr.findIndex((c) => c.id === overId);

      if (from === to) {
        // Reorder within the column (both directions) so the gap tracks smoothly.
        const target = overIdx < 0 ? toArr.length - 1 : overIdx;
        if (activeIdx === target) return prev;
        return { ...prev, [to]: arrayMove(toArr, activeIdx, target) };
      }

      // Cross-column: drop from the source, splice into the target at the hovered slot.
      const insertAt = overIdx < 0 ? toArr.length : overIdx;
      const card = fromArr[activeIdx];
      return {
        ...prev,
        [from]: fromArr.filter((c) => c.id !== activeId),
        [to]: [...toArr.slice(0, insertAt), card, ...toArr.slice(insertAt)],
      };
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const final = dragColumns;
    endDrag();
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const activeTask = byId.get(activeId);
    if (!activeTask || !final) return;

    const fromStatus = activeTask.status;
    // Target column = where the pointer was released. Resolve from `over` because
    // the active card is deliberately never placed into Complete's working copy.
    const toStatus = findContainer(final, overId);
    if (!toStatus) return;

    if (fromStatus !== toStatus) {
      // Moved to another column. Non-Complete targets already hold the card at the
      // hovered slot (from onDragOver) → persist that order. Complete is organized
      // by version sections, so we only move the card in.
      void (async () => {
        await moveTask(activeId, toStatus);
        if (toStatus !== 'complete') await reorderTasks(final[toStatus].map((c) => c.id));
      })();
      return;
    }

    if (toStatus === 'complete') {
      // Complete isn't live-reordered; reorder within it from the drop target.
      const ids = baseColumns.complete.map((c) => c.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = overId.startsWith('column:') ? ids.length - 1 : ids.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      void reorderTasks(arrayMove(ids, oldIndex, newIndex));
      return;
    }

    // Same column (non-Complete): final already reflects the live reorder.
    const targetIds = final[toStatus].map((c) => c.id);
    const baseIds = baseColumns[toStatus].map((c) => c.id);
    const changed =
      targetIds.length !== baseIds.length || targetIds.some((id, i) => id !== baseIds[i]);
    if (changed) void reorderTasks(targetIds);
  }

  return (
    <div
      className="board-shell"
      onClick={(e) => {
        // A click that didn't land on a card clears the last-viewed mark. Card
        // clicks set the highlight first and bubble here, where closest('.card')
        // is truthy → we skip, so the fresh highlight survives.
        if (!(e.target as HTMLElement).closest('.card')) clearHighlight();
      }}
    >
      <NextGoal />
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
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
