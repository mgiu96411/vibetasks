// Global ⌘K command palette. Opens on Cmd/Ctrl+K, closes on Escape. Offers a
// fuzzy-filtered list of commands derived from the current snapshot:
//   - Switch to <project>           -> store.setActiveProject
//   - New task                      -> store.addTask (palette flips into a
//     title-input mode; window.prompt is a no-op in Tauri's webview)
//   - Toggle Board / Graph view     -> store.setView
//   - Jump to <task>                -> store.selectTask (opens TaskDetail)
// Arrow keys move the highlight; Enter runs the highlighted command.

import { useEffect, useMemo, useState } from 'react';
import { useStore, getTerminalApp, setTerminalApp, getClaudeBin, setClaudeBin } from '../store';

interface Command {
  id: string;
  label: string;
  hint?: string;
  /** Leave the palette open after running (e.g. to enter input mode). */
  keepOpen?: boolean;
  run: () => void;
}

// Tiny subsequence fuzzy matcher: every char of `q` must appear in order.
function fuzzy(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of q.toLowerCase()) {
    i = t.indexOf(ch, i);
    if (i === -1) return false;
    i++;
  }
  return true;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  // 'commands' lists/filters commands; 'new-task' turns the input into a
  // task-title field (native prompt() never shows in the Tauri webview).
  const [mode, setMode] = useState<'commands' | 'new-task' | 'terminal-app' | 'claude-bin'>('commands');

  const snapshot = useStore((s) => s.snapshot);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const selectTask = useStore((s) => s.selectTask);
  const addTask = useStore((s) => s.addTask);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const pushToast = useStore((s) => s.pushToast);

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setCursor(0);
        setMode('commands');
      } else if (e.key === 'Escape') {
        setOpen(false);
        setMode('commands');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const projects = snapshot?.projects ?? [];
    const tasks = (snapshot?.tasks ?? []).filter((t) => t.parent_id === null);

    const cmds: Command[] = [];

    cmds.push({
      id: 'view-toggle',
      label: view === 'board' ? 'Switch to Graph view' : 'Switch to Board view',
      hint: 'View',
      run: () => setView(view === 'board' ? 'graph' : 'board'),
    });

    cmds.push({
      id: 'new-task',
      label: 'New task',
      hint: 'Create',
      keepOpen: true,
      run: () => {
        setMode('new-task');
        setQuery('');
        setCursor(0);
      },
    });

    cmds.push({
      id: 'set-terminal-app',
      label: `Set terminal app… (current: ${getTerminalApp()})`,
      hint: 'Settings',
      keepOpen: true,
      run: () => { setMode('terminal-app'); setQuery(''); },
    });
    cmds.push({
      id: 'set-claude-bin',
      label: `Set Claude binary… (current: ${getClaudeBin()})`,
      hint: 'Settings',
      keepOpen: true,
      run: () => { setMode('claude-bin'); setQuery(''); },
    });

    for (const p of projects) {
      cmds.push({
        id: `proj-${p.id}`,
        label: `Switch to ${p.name}`,
        hint: 'Project',
        run: () => void setActiveProject(p.id),
      });
    }

    for (const t of tasks) {
      cmds.push({
        id: `task-${t.id}`,
        label: `Jump to: ${t.title}`,
        hint: 'Task',
        run: () => selectTask(t.id),
      });
    }

    return cmds;
  }, [snapshot, view, activeProjectId, setView, setActiveProject, selectTask, addTask]);

  const filtered = useMemo(
    () => commands.filter((c) => fuzzy(query, c.label)),
    [commands, query],
  );

  // Keep the cursor within bounds when the filtered list shrinks.
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  if (!open) return null;

  function runAt(i: number) {
    const cmd = filtered[i];
    if (!cmd) return;
    cmd.run();
    if (!cmd.keepOpen) setOpen(false);
  }

  function commitNewTask() {
    const title = query.trim();
    if (title && activeProjectId) void addTask(title);
    setQuery('');
    setMode('commands');
    setOpen(false);
  }

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          key={mode}
          className="palette-input"
          autoFocus
          placeholder={
            mode === 'new-task' ? 'New task title…'
            : mode === 'terminal-app' ? 'Terminal app name (e.g. Ghostty)…'
            : mode === 'claude-bin' ? 'Path to claude binary…'
            : 'Type a command or task…'
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (mode === 'new-task') {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNewTask();
              }
              return;
            }
            if (mode === 'terminal-app') {
              if (e.key === 'Enter') {
                e.preventDefault();
                setTerminalApp(query);
                pushToast({ kind: 'info', text: `Terminal app: ${getTerminalApp()}` });
                setQuery('');
                setMode('commands');
                setOpen(false);
              }
              return;
            }
            if (mode === 'claude-bin') {
              if (e.key === 'Enter') {
                e.preventDefault();
                setClaudeBin(query);
                pushToast({ kind: 'info', text: `Claude binary: ${getClaudeBin()}` });
                setQuery('');
                setMode('commands');
                setOpen(false);
              }
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              runAt(cursor);
            }
          }}
        />
        {mode === 'new-task' ? (
          <div className="palette-list">
            <div className="palette-empty">
              Enter to create in the active project · Esc to cancel
            </div>
          </div>
        ) : (mode === 'terminal-app' || mode === 'claude-bin') ? (
          <div className="palette-list">
            <div className="palette-empty">Enter to save · Esc to cancel</div>
          </div>
        ) : (
          <div className="palette-list">
            {filtered.length === 0 && (
              <div className="palette-empty">No matches</div>
            )}
            {filtered.map((c, i) => (
              <div
                key={c.id}
                className={`palette-item${i === cursor ? ' active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => runAt(i)}
              >
                <span className="palette-label">{c.label}</span>
                {c.hint && <span className="palette-hint">{c.hint}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
