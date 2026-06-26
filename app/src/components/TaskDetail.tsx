// Task detail overlay, opened by selecting a card (store.selectedTaskId).
// Renders a right-docked panel over the app with editors for one task:
//
//   - Title / Brief / Details / priority  -> store.updateTask
//   - Code refs: paths[] and symbols[] as chip inputs            -> store.setRefs
//   - Subtasks checklist: add (store.addSubtask) and complete one via
//     store.moveTask(subtaskId, 'complete') (un-complete -> 'next')
//   - Links:
//       Depends-on : links where from == this (type 'depends_on')
//       Blocks     : derived — links where to == this (type 'depends_on')
//       Related    : links where this participates (type 'related')
//     each with add (pick another task) + remove (store.unlinkTasks).
//
// Field edits are kept in local state and committed onBlur / Enter so we don't
// fire a backend write on every keystroke.

import { useEffect, useRef, useState } from 'react';
import type { Priority, Kind, Task, TaskLink } from 'shared';
import { useStore, getTerminalApp } from '../store';

const PRIORITIES: Priority[] = ['none', 'low', 'med', 'high'];
const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'None',
  low: 'Low',
  med: 'Med',
  high: 'High',
};

const KINDS: Kind[] = ['none', 'fix', 'feature', 'chore', 'rule', 'docs'];
type DraftField = 'title' | 'summary' | 'description' | 'version';
const KIND_LABEL: Record<Kind, string> = {
  none: 'None',
  fix: 'Fix',
  feature: 'Feature',
  chore: 'Chore',
  rule: 'Rule',
  docs: 'Docs',
};

// ---- chip editor for a string[] field (paths / symbols) --------------------

function ChipEditor({
  label,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  }
  function remove(v: string) {
    onChange(values.filter((x) => x !== v));
  }

  return (
    <div className="detail-field">
      <label className="detail-label">{label}</label>
      <div className="chips">
        {values.map((v) => (
          <span key={v} className="chip">
            {v}
            <button className="chip-x" onClick={() => remove(v)}>
              ✕
            </button>
          </span>
        ))}
        <input
          className="chip-input"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
    </div>
  );
}

// ---- a single link row + an "add link" picker ------------------------------

interface LinkRow {
  otherId: string;
  title: string;
}

function LinkSection<R extends LinkRow>({
  title,
  rows,
  candidates,
  onAdd,
  onRemove,
}: {
  title: string;
  // one entry per link in this section
  rows: R[];
  // tasks selectable to add a new link in this section ([] disables adding)
  candidates: { id: string; title: string }[];
  onAdd?: (otherId: string) => void;
  onRemove?: (row: R) => void;
}) {
  const [pick, setPick] = useState('');
  return (
    <div className="detail-field">
      <label className="detail-label">{title}</label>
      <div className="link-list">
        {rows.length === 0 && <span className="link-empty">None</span>}
        {rows.map((r) => (
          <span key={r.otherId} className="link-chip">
            {r.title}
            {onRemove && (
              <button className="chip-x" onClick={() => onRemove(r)}>
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      {onAdd && candidates.length > 0 && (
        <select
          className="link-add"
          value={pick}
          onChange={(e) => {
            const id = e.target.value;
            if (id) {
              onAdd(id);
              setPick('');
            }
          }}
        >
          <option value="">+ Add…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function TaskDetail() {
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const selectTask = useStore((s) => s.selectTask);
  const snapshot = useStore((s) => s.snapshot);
  const updateTask = useStore((s) => s.updateTask);
  const setRefs = useStore((s) => s.setRefs);
  const addSubtask = useStore((s) => s.addSubtask);
  const moveTask = useStore((s) => s.moveTask);
  const linkTasks = useStore((s) => s.linkTasks);
  const unlinkTasks = useStore((s) => s.unlinkTasks);
  const deleteTask = useStore((s) => s.deleteTask);
  const startTask = useStore((s) => s.startTask);

  const tasks = snapshot?.tasks ?? [];
  const links: TaskLink[] = snapshot?.links ?? [];
  const task = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const project = snapshot?.projects.find((p) => p.id === task?.project_id) ?? null;

  // Local editable copies of the text fields. Dirty tracking prevents a live
  // MCP/app refresh from being overwritten by stale modal text on blur.
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [subDraft, setSubDraft] = useState('');
  const [version, setVersion] = useState('');
  const [dirty, setDirty] = useState<Record<DraftField, boolean>>({
    title: false,
    summary: false,
    description: false,
    version: false,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [startCooldown, setStartCooldown] = useState(false);
  const closePanelRef = useRef<() => void>(null!);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const markDirty = (field: DraftField, value = true) =>
    setDirty((d) => ({ ...d, [field]: value }));

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setSummary(task.summary);
      setDescription(task.description);
      setVersion(task.version);
      setSubDraft('');
      setDirty({
        title: false,
        summary: false,
        description: false,
        version: false,
      });
      setConfirmDelete(false);
      setConfirmStart(false);
      setStartCooldown(false);
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (task && !dirty.title) setTitle(task.title);
  }, [task?.id, task?.title, dirty.title]);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [title]);
  useEffect(() => {
    if (task && !dirty.summary) setSummary(task.summary);
  }, [task?.id, task?.summary, dirty.summary]);
  useEffect(() => {
    if (task && !dirty.description) setDescription(task.description);
  }, [task?.id, task?.description, dirty.description]);
  useEffect(() => {
    if (task && !dirty.version) setVersion(task.version);
  }, [task?.id, task?.version, dirty.version]);

  // Close on Escape while open — uses ref so we always flush the latest dirty state.
  useEffect(() => {
    if (!task) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePanelRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [task]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;
  const t: Task = task;

  const titleOf = (id: string) =>
    tasks.find((x) => x.id === id)?.title ?? '(unknown)';

  // Subtasks = tasks whose parent_id is this one.
  const subtasks = tasks
    .filter((s) => s.parent_id === t.id)
    .slice()
    .sort((a, b) => a.position - b.position);

  // Link partitions.
  const dependsOn = links
    .filter((l) => l.type === 'depends_on' && l.from_task_id === t.id)
    .map((l) => ({ otherId: l.to_task_id, title: titleOf(l.to_task_id) }));
  const blocks = links
    .filter((l) => l.type === 'depends_on' && l.to_task_id === t.id)
    .map((l) => ({ otherId: l.from_task_id, title: titleOf(l.from_task_id) }));
  // 'related' is conceptually symmetric but stored with a fixed direction, and
  // unlink deletes the exact (from,to) row — so keep the stored endpoints to
  // remove the right row regardless of which side `t` is on.
  const related = links
    .filter(
      (l) =>
        l.type === 'related' &&
        (l.from_task_id === t.id || l.to_task_id === t.id),
    )
    .map((l) => {
      const otherId = l.from_task_id === t.id ? l.to_task_id : l.from_task_id;
      return {
        otherId,
        title: titleOf(otherId),
        from: l.from_task_id,
        to: l.to_task_id,
      };
    });

  // Candidate tasks for new links: top-level tasks in this project, excluding
  // self and ones already linked in that section.
  const topLevel = tasks.filter(
    (x) => x.parent_id === null && x.id !== t.id,
  );
  const dependsIds = new Set(dependsOn.map((r) => r.otherId));
  const relatedIds = new Set(related.map((r) => r.otherId));
  const dependsCandidates = topLevel
    .filter((x) => !dependsIds.has(x.id))
    .map((x) => ({ id: x.id, title: x.title }));
  const relatedCandidates = topLevel
    .filter((x) => !relatedIds.has(x.id))
    .map((x) => ({ id: x.id, title: x.title }));

  const doneSub = subtasks.filter((s) => s.status === 'complete').length;

  function commitTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(t.title);
      markDirty('title', false);
      return;
    }
    if (next !== t.title)
      void updateTask(t.id, { title: next }).finally(() =>
        markDirty('title', false),
      );
    else markDirty('title', false);
  }
  function commitSummary() {
    const next = summary.trim();
    if (next !== t.summary)
      void updateTask(t.id, { summary: next }).finally(() =>
        markDirty('summary', false),
      );
    else markDirty('summary', false);
  }
  function commitDescription() {
    if (description !== t.description)
      void updateTask(t.id, { description }).finally(() =>
        markDirty('description', false),
      );
    else markDirty('description', false);
  }
  function commitVersion() {
    if (version !== t.version)
      void updateTask(t.id, { version }).finally(() =>
        markDirty('version', false),
      );
    else markDirty('version', false);
  }
  function closePanel() {
    commitTitle();
    commitSummary();
    commitDescription();
    commitVersion();
    selectTask(null);
  }
  closePanelRef.current = closePanel;

  function addSub() {
    const v = subDraft.trim();
    if (v) void addSubtask(t.id, v);
    setSubDraft('');
  }

  function launch() {
    setConfirmStart(false);
    setStartCooldown(true);
    setTimeout(() => setStartCooldown(false), 5000);
    void startTask(t.id);
  }

  function onStartClick() {
    if (!t.description.trim() && !confirmStart) {
      setConfirmStart(true);
      return;
    }
    launch();
  }

  return (
    <div className="modal-overlay" onClick={() => closePanel()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {t.ref > 0 && <span className="detail-ref">#{t.ref}</span>}
          <span className="detail-source">
            {t.source === 'claude' ? '✦ Claude' : 'You'}
          </span>
          {t.reopened_at && (
            <span className="reopened-badge">⟲ Reopened from Complete</span>
          )}
          <button className="detail-close" onClick={() => closePanel()}>
            ✕
          </button>
        </div>

        <div className="modal-body">
        <textarea
          ref={titleRef}
          className="detail-title"
          rows={1}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty('title');
          }}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
          }}
        />

        <div className="detail-field">
          <label className="detail-label">Priority</label>
          <div className="priority-picker">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                className={`prio-btn ${p}${t.priority === p ? ' active' : ''}`}
                onClick={() => void updateTask(t.id, { priority: p })}
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
                className={`kind-btn ${k}${t.kind === k ? ' active' : ''}`}
                onClick={() => void updateTask(t.id, { kind: k })}
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
            value={summary}
            onChange={(e) => {
              setSummary(e.target.value);
              markDirty('summary');
            }}
            onBlur={commitSummary}
          />
        </div>

        <div className="detail-field">
          <label className="detail-label">Version</label>
          <input
            className="detail-input"
            placeholder="e.g. v0.4.0 — groups the Complete column"
            value={version}
            onChange={(e) => {
              setVersion(e.target.value);
              markDirty('version');
            }}
            onBlur={commitVersion}
          />
        </div>

        <div className="detail-field">
          <label className="detail-label">Details</label>
          <textarea
            className="detail-textarea"
            placeholder="Acceptance criteria, constraints, edge cases…"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              markDirty('description');
            }}
            onBlur={commitDescription}
          />
        </div>

        <ChipEditor
          label="Paths"
          placeholder="src/foo.ts"
          values={t.paths}
          onChange={(next) => void setRefs(t.id, next, t.symbols)}
        />
        <ChipEditor
          label="Symbols"
          placeholder="fnName"
          values={t.symbols}
          onChange={(next) => void setRefs(t.id, t.paths, next)}
        />

        <div className="detail-field">
          <label className="detail-label">
            Subtasks {subtasks.length > 0 && `(${doneSub}/${subtasks.length})`}
          </label>
          <div className="subtask-list">
            {subtasks.map((s) => (
              <div
                key={s.id}
                className={`subtask-item${s.status === 'complete' ? ' done' : ''}`}
              >
                <button
                  className="check"
                  aria-label="Toggle subtask"
                  onClick={() =>
                    void moveTask(
                      s.id,
                      s.status === 'complete' ? 'next' : 'complete',
                    )
                  }
                >
                  {s.status === 'complete' ? '✓' : ''}
                </button>
                <span className="label">{s.title}</span>
                {s.source === 'claude' && (
                  <span className="todo-marker">✦</span>
                )}
              </div>
            ))}
          </div>
          <input
            className="subtask-add"
            placeholder="Add a subtask…"
            value={subDraft}
            onChange={(e) => setSubDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addSub();
            }}
          />
        </div>

        <LinkSection
          title="Depends on"
          rows={dependsOn}
          candidates={dependsCandidates}
          onAdd={(otherId) => void linkTasks(t.id, otherId, 'depends_on')}
          onRemove={(r) => void unlinkTasks(t.id, r.otherId, 'depends_on')}
        />
        <LinkSection title="Blocks" rows={blocks} candidates={[]} />
        <LinkSection
          title="Related"
          rows={related}
          candidates={relatedCandidates}
          onAdd={(otherId) => void linkTasks(t.id, otherId, 'related')}
          onRemove={(r) => void unlinkTasks(r.from, r.to, 'related')}
        />
        </div>

        <div className="modal-footer">
          {t.status !== 'complete' && (
            confirmStart ? (
              <>
                <button className="detail-start" onClick={launch}>
                  No details — start anyway?
                </button>
                <button className="detail-delete-cancel" onClick={() => setConfirmStart(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="detail-start"
                disabled={!project?.repo_path || startCooldown}
                title={
                  !project?.repo_path
                    ? 'Set the repo path in the sidebar first'
                    : `Launch Claude on this task in ${getTerminalApp()}`
                }
                onClick={onStartClick}
              >
                ▶ Start in {getTerminalApp()}
              </button>
            )
          )}
          {confirmDelete ? (
            <>
              <button
                className="detail-delete danger"
                onClick={() => void deleteTask(t.id)}
              >
                {subtasks.length > 0
                  ? `Delete task + ${subtasks.length} subtask${
                      subtasks.length > 1 ? 's' : ''
                    }`
                  : 'Confirm delete'}
              </button>
              <button
                className="detail-delete-cancel"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="detail-delete"
              onClick={() => setConfirmDelete(true)}
            >
              Delete task
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
