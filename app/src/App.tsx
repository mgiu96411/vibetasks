// Command Center shell:
//   <Sidebar/> | center (Board or Graph by view) | right column (Last session over Notes)
// Title bar shows the active project name, the All/Mine/Claude filter, a ⌘K hint,
// and a Board/Graph toggle. TaskDetail + CommandPalette render as overlays on top.
// ResizeHandles let you resize the sidebar and right panel; sizes are persisted by
// the store. Polling starts on mount.

import { useEffect, useState } from 'react';
import { useStore, type Filter, type View } from './store';
import Board from './components/Board';
import Sidebar from './components/Sidebar';
import LastSession from './components/LastSession';
import Notes from './components/Notes';
import TaskDetail from './components/TaskDetail';
import NewTaskModal from './components/NewTaskModal';
import CommandPalette from './components/CommandPalette';
import Toasts from './components/Toasts';
import GraphView from './components/GraphView';
import ResizeHandle from './components/ResizeHandle';

const TITLEBAR_H = 52;
const DEFAULT_SPACE_ID = 'space-current';

// ---- title bar ----

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'claude', label: "Claude's" },
];

function TitleBar() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  // `?? []` stays OUTSIDE the selector (stable reference — see store.ts).
  const projects = useStore((s) => s.snapshot?.projects) ?? [];
  const spaces = useStore((s) => s.snapshot?.spaces) ?? [];
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openNewTask = useStore((s) => s.openNewTask);
  const moveProjectToSpace = useStore((s) => s.moveProjectToSpace);
  const setProjectRepoPath = useStore((s) => s.setProjectRepoPath);
  const openClaude = useStore((s) => s.openClaude);

  const [editingRepoPath, setEditingRepoPath] = useState(false);
  const [repoPathDraft, setRepoPathDraft] = useState('');

  const active = projects.find((p) => p.id === activeProjectId);

  function startEditRepoPath() {
    setRepoPathDraft(active?.repo_path ?? '');
    setEditingRepoPath(true);
  }

  function commitRepoPath() {
    if (active) void setProjectRepoPath(active.id, repoPathDraft);
    setEditingRepoPath(false);
    setRepoPathDraft('');
  }

  return (
    <header className="titlebar">
      <span className="project-name">{active?.name ?? 'Vibe Tasks'}</span>

      <div className="filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? 'active' : ''}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {active && (
        <select
          className="titlebar-space-select"
          title="Move project to space"
          value={active.space_id ?? DEFAULT_SPACE_ID}
          onChange={(e) => void moveProjectToSpace(active.id, e.target.value)}
        >
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {active && (editingRepoPath ? (
        <input
          className="titlebar-repo-input"
          autoFocus
          placeholder="/path/to/repo"
          value={repoPathDraft}
          onChange={(e) => setRepoPathDraft(e.target.value)}
          onBlur={commitRepoPath}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitRepoPath(); }
            if (e.key === 'Escape') { setEditingRepoPath(false); setRepoPathDraft(''); }
          }}
        />
      ) : (
        <button
          className={`titlebar-repo-btn${active.repo_path ? ' has-path' : ''}`}
          title={active.repo_path ? `Repo: ${active.repo_path}` : 'Set repo path (enables Start)'}
          onClick={startEditRepoPath}
        >
          📁
        </button>
      ))}

      {active && active.repo_path && !editingRepoPath && (
        <button
          className="titlebar-open-claude-btn"
          title={`Open Claude in ${active.repo_path}`}
          onClick={() => void openClaude(active.id)}
        >
          Open Claude
        </button>
      )}

      <span className="spacer" />

      <button className="new-task-btn" onClick={openNewTask} title="New task (⌘N)">
        + New
      </button>

      <span className="cmdk-hint">
        <kbd>⌘K</kbd> Command
      </span>

      <div className="viewtoggle">
        {(['board', 'graph'] as View[]).map((v) => (
          <button
            key={v}
            className={view === v ? 'active' : ''}
            onClick={() => setView(v)}
          >
            {v === 'board' ? 'Board' : 'Graph'}
          </button>
        ))}
      </div>
    </header>
  );
}

// ---- app shell ----

export default function App() {
  const view = useStore((s) => s.view);
  const startPolling = useStore((s) => s.startPolling);
  const stopPolling = useStore((s) => s.stopPolling);

  const sidebarW = useStore((s) => s.sidebarW);
  const rightW = useStore((s) => s.rightW);
  const resizeSidebar = useStore((s) => s.resizeSidebar);
  const resizeRight = useStore((s) => s.resizeRight);

  const openNewTask = useStore((s) => s.openNewTask);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // ⌘N / Ctrl+N opens the floating "New task" modal (preventDefault so the
  // webview doesn't try to open a new OS window).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openNewTask();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openNewTask]);

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${sidebarW}px 1fr ${rightW}px` }}
    >
      <Sidebar />
      <TitleBar />
      <main className="center">{view === 'graph' ? <GraphView /> : <Board />}</main>
      <div className="right">
        <LastSession />
        <Notes />
      </div>

      {/* layout dividers (absolute, over the grid boundaries) */}
      <ResizeHandle
        orientation="vertical"
        onResize={resizeSidebar}
        style={{ left: sidebarW - 3 }}
      />
      <ResizeHandle
        orientation="vertical"
        onResize={resizeRight}
        style={{ right: rightW - 3, top: TITLEBAR_H }}
      />

      {/* overlays */}
      <TaskDetail />
      <NewTaskModal />
      <CommandPalette />
      <Toasts />
    </div>
  );
}
