// One Kanban column (now / next / later / complete / dropped). It is both a
// droppable container (via useDroppable, so a card can be dropped onto an empty
// column) and a SortableContext owner (so cards reorder within it). The header
// shows the column name + count; the Complete column shows a completion bar.
//
// The Complete column additionally groups its cards into collapsible per-version
// sections (newest version expanded, older collapsed by default), so it stays
// bounded as completed work accretes while staying explorable per release. The
// other four columns render a flat list. All cards stay in one SortableContext
// so cross-column drag is unaffected.

import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { Status } from 'shared';
import { useStore } from '../store';
import Card, { type CardData } from './Card';

export type ColumnCard = CardData;

interface ColumnProps {
  status: Status;
  name: string;
  cards: ColumnCard[];
  /** only set for the Complete column: completion ratio 0..1 of the active board */
  completion?: number;
}

// Persisted collapse state for version sections, keyed by version label.
const LS_KEY = 'vt.collapsedVersions';
function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

// Group cards by version: newest version first (numeric-aware), "Unversioned" last.
function groupByVersion(cards: ColumnCard[]): { version: string; cards: ColumnCard[] }[] {
  const by = new Map<string, ColumnCard[]>();
  for (const c of cards) {
    const v = c.version || '';
    const arr = by.get(v);
    if (arr) arr.push(c);
    else by.set(v, [c]);
  }
  const versions = [...by.keys()].sort((a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    return b.localeCompare(a, undefined, { numeric: true });
  });
  return versions.map((v) => ({ version: v, cards: by.get(v)! }));
}

export default function Column({ status, name, cards, completion }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: `column:${status}` });
  const addTaskTo = useStore((s) => s.addTaskTo);
  const [draft, setDraft] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const addRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = addRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [draft]);

  function commit() {
    const t = draft.trim();
    if (!t) return;
    void addTaskTo(status, t);
    setDraft('');
  }

  const groups = status === 'complete' ? groupByVersion(cards) : null;
  const versioned = groups != null && groups.some((g) => g.version !== '');

  // Default: only the newest version section is expanded; older ones collapse.
  const isCollapsed = (version: string, isNewest: boolean): boolean =>
    collapsed[version] ?? !isNewest;
  function toggle(version: string, isNewest: boolean) {
    setCollapsed((prev) => {
      const next = { ...prev, [version]: !(prev[version] ?? !isNewest) };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Cards actually rendered right now. Collapsed version sections render no cards,
  // so the SortableContext must list ONLY the visible ones — otherwise dnd-kit
  // measures phantom nodes for collapsed cards and drops onto the Complete column
  // resolve to a non-existent target and snap back.
  const visibleIds =
    versioned && groups
      ? groups
          .filter((g, i) => !isCollapsed(g.version, i === 0 && g.version !== ''))
          .flatMap((g) => g.cards.map((c) => c.id))
      : cards.map((c) => c.id);

  return (
    <div className="column" data-status={status}>
      <div className="column-header">
        <span>{name}</span>
        <span className="count">{cards.length}</span>
      </div>

      {completion !== undefined && (
        <div className="completion-bar">
          <span style={{ width: `${Math.round(completion * 100)}%` }} />
        </div>
      )}

      <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
        <div className="column-body" ref={setNodeRef}>
          {versioned && groups
            ? groups.map((g, i) => {
                const isNewest = i === 0 && g.version !== '';
                const open = !isCollapsed(g.version, isNewest);
                return (
                  <div key={g.version || '∅'} className="version-section">
                    <button
                      className="version-section-header"
                      onClick={() => toggle(g.version, isNewest)}
                    >
                      <span className={`chevron${open ? ' open' : ''}`}>▸</span>
                      <span className="version-section-label">{g.version || 'Unversioned'}</span>
                      <span className="version-section-count">{g.cards.length}</span>
                    </button>
                    {open && g.cards.map((c) => <Card key={c.id} data={c} />)}
                  </div>
                );
              })
            : cards.map((c) => <Card key={c.id} data={c} />)}
        </div>
      </SortableContext>

      <textarea
        ref={addRef}
        className="column-add"
        placeholder="+ Add a task"
        rows={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
        }}
      />
    </div>
  );
}
