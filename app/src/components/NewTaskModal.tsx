// Floating "New task" window — a centered modal for full task capture (title,
// target column, priority, type, Brief, Details), opened from the titlebar
// "+ New" button or ⌘N (store.newTaskOpen). It shares the centered modal shell
// (.modal-overlay / .modal-card) with TaskDetail and reuses the .detail-* field
// styles. The fast per-column inline "+ Add a task" input stays as the quick path;
// this is the rich path.
//
// Local form state is reset each time the modal opens. Create is disabled until a
// title is entered; ⌘/Ctrl+Enter submits from anywhere in the form.

import { useEffect, useRef, useState } from 'react';
import type { Status, Priority, Kind } from 'shared';
import { useStore, type NewTaskInput } from '../store';

const COLUMNS: { status: Status; label: string }[] = [
  { status: 'now', label: 'Now' },
  { status: 'next', label: 'Next' },
  { status: 'later', label: 'Later' },
  { status: 'complete', label: 'Complete' },
  { status: 'dropped', label: 'Dropped' },
];

const PRIORITIES: Priority[] = ['none', 'low', 'med', 'high'];
const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'None',
  low: 'Low',
  med: 'Med',
  high: 'High',
};

const KINDS: Kind[] = ['none', 'fix', 'feature', 'chore', 'rule', 'docs'];
const KIND_LABEL: Record<Kind, string> = {
  none: 'None',
  fix: 'Fix',
  feature: 'Feature',
  chore: 'Chore',
  rule: 'Rule',
  docs: 'Docs',
};

const EMPTY: NewTaskInput = {
  title: '',
  status: 'next',
  priority: 'none',
  kind: 'none',
  summary: '',
  description: '',
};

export default function NewTaskModal() {
  const open = useStore((s) => s.newTaskOpen);
  const close = useStore((s) => s.closeNewTask);
  const createTask = useStore((s) => s.createTask);

  const [form, setForm] = useState<NewTaskInput>(EMPTY);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Reset the form and focus the title each time the modal opens.
  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      const id = requestAnimationFrame(() => titleRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [form.title]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const canCreate = form.title.trim().length > 0;
  const set = <K extends keyof NewTaskInput>(key: K, value: NewTaskInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function submit() {
    if (!canCreate) return;
    void createTask(form);
    close();
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-heading">New task</span>
          <button className="detail-close" onClick={close}>
            ✕
          </button>
        </div>

        <div
          className="modal-body"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
        >
          <textarea
            ref={titleRef}
            className="detail-title"
            placeholder="Task title"
            rows={1}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
            }}
          />

          <div className="detail-field">
            <label className="detail-label">Column</label>
            <div className="kind-picker">
              {COLUMNS.map((c) => (
                <button
                  key={c.status}
                  className={`kind-btn${form.status === c.status ? ' active' : ''}`}
                  onClick={() => set('status', c.status)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="detail-field">
            <label className="detail-label">Priority</label>
            <div className="priority-picker">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  className={`prio-btn ${p}${form.priority === p ? ' active' : ''}`}
                  onClick={() => set('priority', p)}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="detail-field">
            <label className="detail-label">Type</label>
            <div className="kind-picker">
              {KINDS.map((k) => (
                <button
                  key={k}
                  className={`kind-btn ${k}${form.kind === k ? ' active' : ''}`}
                  onClick={() => set('kind', k)}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="detail-field">
            <label className="detail-label">Brief</label>
            <input
              className="detail-input"
              placeholder="One sentence"
              maxLength={240}
              value={form.summary}
              onChange={(e) => set('summary', e.target.value)}
            />
          </div>

          <div className="detail-field">
            <label className="detail-label">Details</label>
            <textarea
              className="detail-textarea"
              placeholder="Acceptance criteria, constraints, edge cases…"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-create" disabled={!canCreate} onClick={submit}>
            Create task
          </button>
          <span className="modal-hint">
            <kbd>⌘</kbd>
            <kbd>↵</kbd> to create · <kbd>Esc</kbd> to cancel
          </span>
        </div>
      </div>
    </div>
  );
}
