// Zustand store: holds the current snapshot, the active project, the
// All/Mine/Claude filter + Board/Graph view, and persisted layout sizes.
// Actions call api.* then refresh. A polling loop compares getDataVersion()
// every 600ms and reloads the snapshot whenever the DB's PRAGMA data_version
// changes (e.g. Claude wrote via the MCP).

import { create } from 'zustand';
import type { Snapshot, Status, Priority, Kind, LinkType } from 'shared';
import * as api from './api';

export type Filter = 'all' | 'mine' | 'claude';
export type View = 'board' | 'graph';

/** Full field set captured by the floating "New task" modal. */
export interface NewTaskInput {
  title: string;
  status: Status;
  priority: Priority;
  kind: Kind;
  /** Product Brief, stored in the legacy summary column. */
  summary: string;
  /** Product Details, stored in the legacy description column. */
  description: string;
}

export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

// ---- localStorage persistence (UI state only; never the SQLite data) -------
const LS = {
  sidebarW: 'vt.sidebarW',
  rightW: 'vt.rightW',
  project: 'vt.activeProject',
  view: 'vt.view',
  filter: 'vt.filter',
  terminalApp: 'vt.terminalApp',
  claudeBin: 'vt.claudeBin',
} as const;

/** First-class terminals with real launch recipes (commands.rs resolve_launch_args).
 *  `id` is the value persisted + passed to the Tauri commands; anything not in
 *  this list is treated as a Custom app (generic open(1) fallback). */
export const TERMINALS = [
  { id: 'Ghostty', label: 'Ghostty' },
  { id: 'Terminal', label: 'Terminal.app' },
  { id: 'iTerm', label: 'iTerm2' },
] as const;

export const getTerminalApp = () => localStorage.getItem(LS.terminalApp) || 'Ghostty';
export const setTerminalApp = (v: string) => localStorage.setItem(LS.terminalApp, v.trim() || 'Ghostty');
/** True when the persisted terminal is a Custom app (not a first-class one). */
export const isCustomTerminal = (v: string) => !TERMINALS.some((t) => t.id === v);
export const getClaudeBin = () => localStorage.getItem(LS.claudeBin) || '~/.local/bin/claude';
export const setClaudeBin = (v: string) => localStorage.setItem(LS.claudeBin, v.trim() || '~/.local/bin/claude');

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function lsNum(key: string, def: number): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : def;
}
function lsStr<T extends string>(key: string, allowed: readonly T[], def: T): T {
  const v = localStorage.getItem(key) as T | null;
  return v && allowed.includes(v) ? v : def;
}
const SIDEBAR = { def: 232, lo: 170, hi: 440 };
const RIGHT = { def: 320, lo: 240, hi: 560 };

interface State {
  snapshot: Snapshot | null;
  activeProjectId: string | null;
  filter: Filter;
  view: View;
  /** transient board search query (title / task# / body); NOT persisted */
  search: string;
  selectedTaskId: string | null;
  /** the card visually marked on the board as "last viewed"; survives closing
   *  the detail modal. Separate from selectedTaskId (which drives the modal). */
  highlightedTaskId: string | null;
  /** whether the floating "New task" modal is open */
  newTaskOpen: boolean;

  dataVersion: number;
  pollHandle: ReturnType<typeof setInterval> | null;

  // ---- layout sizes (px), persisted to localStorage ----
  sidebarW: number;
  rightW: number;
  resizeSidebar: (dx: number) => void;
  resizeRight: (dx: number) => void;

  // ---- view / selection ----
  setFilter: (f: Filter) => void;
  setView: (v: View) => void;
  setSearch: (q: string) => void;
  setActiveProject: (id: string) => Promise<void>;
  selectTask: (id: string | null) => void;
  clearHighlight: () => void;
  openNewTask: () => void;
  closeNewTask: () => void;

  // ---- core data ----
  refresh: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;

  // ---- spaces / projects ----
  createSpace: (name: string) => Promise<void>;
  renameSpace: (id: string, name: string) => Promise<void>;
  deleteSpace: (id: string) => Promise<void>;
  reorderSpaces: (ids: string[]) => Promise<void>;
  moveProjectToSpace: (projectId: string, spaceId: string) => Promise<void>;
  createProject: (name: string, spaceId?: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  // ---- tasks ----
  addTask: (title: string) => Promise<void>;
  addTaskTo: (status: Status, title: string) => Promise<void>;
  /** Create a task with the full field set (from the floating "New task" modal). */
  createTask: (input: NewTaskInput) => Promise<void>;
  addSubtask: (parentId: string, title: string) => Promise<void>;
  updateTask: (id: string, fields: api.UpdateTaskFields) => Promise<void>;
  moveTask: (id: string, status: Status) => Promise<void>;
  reorderTasks: (ids: string[]) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  setRefs: (id: string, paths?: string[], symbols?: string[]) => Promise<void>;

  // ---- priority convenience ----
  setPriority: (id: string, priority: Priority) => Promise<void>;

  // ---- links ----
  linkTasks: (from: string, to: string, type: LinkType) => Promise<void>;
  unlinkTasks: (from: string, to: string, type: LinkType) => Promise<void>;

  // ---- notes ----
  setNotes: (body: string) => Promise<void>;

  // ---- goal ----
  setGoal: (data: api.GoalData) => Promise<void>;

  // ---- toasts ----
  toasts: ToastItem[];
  pushToast: (t: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: number) => void;

  // ---- start button ----
  setProjectRepoPath: (id: string, repoPath: string) => Promise<void>;
  startTask: (id: string) => Promise<void>;
  openClaude: (projectId: string) => Promise<void>;
}

const POLL_MS = 600;

export const useStore = create<State>((set, get) => ({
  snapshot: null,
  activeProjectId: null,
  filter: lsStr<Filter>(LS.filter, ['all', 'mine', 'claude'], 'all'),
  view: lsStr<View>(LS.view, ['board', 'graph'], 'board'),
  search: '',
  selectedTaskId: null,
  highlightedTaskId: null,
  newTaskOpen: false,
  dataVersion: -1,
  pollHandle: null,

  sidebarW: clamp(lsNum(LS.sidebarW, SIDEBAR.def), SIDEBAR.lo, SIDEBAR.hi),
  rightW: clamp(lsNum(LS.rightW, RIGHT.def), RIGHT.lo, RIGHT.hi),

  resizeSidebar: (dx) =>
    set((s) => {
      const w = clamp(s.sidebarW + dx, SIDEBAR.lo, SIDEBAR.hi);
      localStorage.setItem(LS.sidebarW, String(w));
      return { sidebarW: w };
    }),
  // The handle sits on the center|right boundary: dragging right shrinks the
  // right panel, so subtract dx.
  resizeRight: (dx) =>
    set((s) => {
      const w = clamp(s.rightW - dx, RIGHT.lo, RIGHT.hi);
      localStorage.setItem(LS.rightW, String(w));
      return { rightW: w };
    }),

  setFilter: (filter) => {
    localStorage.setItem(LS.filter, filter);
    set({ filter });
  },
  setView: (view) => {
    localStorage.setItem(LS.view, view);
    set({ view });
  },
  setSearch: (search) => set({ search }),
  // Opening a task marks it highlighted too. Closing (id === null) leaves the
  // highlight in place so the board still shows what you were just viewing.
  selectTask: (selectedTaskId) =>
    set(selectedTaskId === null ? { selectedTaskId } : { selectedTaskId, highlightedTaskId: selectedTaskId }),
  clearHighlight: () => set({ highlightedTaskId: null }),
  openNewTask: () => set({ newTaskOpen: true }),
  closeNewTask: () => set({ newTaskOpen: false }),

  setActiveProject: async (id) => {
    localStorage.setItem(LS.project, id);
    set({ activeProjectId: id });
    await get().refresh();
  },

  refresh: async () => {
    let { activeProjectId } = get();

    // No active project yet → discover projects and pick the saved one (if it
    // still exists) or the first.
    if (!activeProjectId) {
      const probe = await api.getSnapshot('');
      if (probe.projects.length === 0) {
        set({ snapshot: probe, activeProjectId: null });
        return;
      }
      const saved = localStorage.getItem(LS.project);
      const pick =
        (saved && probe.projects.find((p) => p.id === saved)?.id) ||
        probe.projects[0].id;
      activeProjectId = pick;
      localStorage.setItem(LS.project, pick);
      set({ activeProjectId });
    }

    const snapshot = await api.getSnapshot(activeProjectId);
    set({ snapshot });
  },

  startPolling: () => {
    if (get().pollHandle) return;
    void (async () => {
      try {
        const v = await api.getDataVersion();
        set({ dataVersion: v });
        await get().refresh();
      } catch {
        // backend may not be ready on first tick; the interval will retry
      }
    })();

    const handle = setInterval(async () => {
      try {
        const v = await api.getDataVersion();
        if (v !== get().dataVersion) {
          set({ dataVersion: v });
          await get().refresh();
        }
      } catch {
        // ignore transient errors; keep polling
      }
    }, POLL_MS);

    set({ pollHandle: handle });
  },

  stopPolling: () => {
    const h = get().pollHandle;
    if (h) clearInterval(h);
    set({ pollHandle: null });
  },

  // ---- spaces / projects ----
  createSpace: async (name) => {
    await api.createSpace(name);
    await get().refresh();
  },
  renameSpace: async (id, name) => {
    await api.renameSpace(id, name);
    await get().refresh();
  },
  deleteSpace: async (id) => {
    await api.deleteSpace(id);
    await get().refresh();
  },
  reorderSpaces: async (ids) => {
    const snap = get().snapshot;
    if (snap) {
      const order = new Map(ids.map((sid, i) => [sid, i]));
      const positions = snap.spaces
        .filter((s) => order.has(s.id))
        .map((s) => s.position)
        .sort((a, b) => a - b);
      set({
        snapshot: {
          ...snap,
          spaces: snap.spaces.map((s) =>
            order.has(s.id)
              ? { ...s, position: positions[order.get(s.id)!] ?? s.position }
              : s,
          ),
        },
      });
    }
    await api.reorderSpaces(ids);
    await get().refresh();
  },
  moveProjectToSpace: async (projectId, spaceId) => {
    await api.moveProjectToSpace(projectId, spaceId);
    await get().refresh();
  },
  createProject: async (name, spaceId) => {
    const id = await api.createProject(name, spaceId);
    await get().setActiveProject(id);
  },
  renameProject: async (id, name) => {
    await api.renameProject(id, name);
    await get().refresh();
  },
  deleteProject: async (id) => {
    await api.deleteProject(id);
    if (get().activeProjectId === id) {
      localStorage.removeItem(LS.project);
      set({ activeProjectId: null });
    }
    await get().refresh();
  },

  // ---- tasks ----
  addTask: async (title) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    await api.addTask(pid, title);
    await get().refresh();
  },
  // Add a task directly into a given column. add_task inserts into 'next' by
  // default, so for other columns we create it then move it.
  addTaskTo: async (status, title) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const id = await api.addTask(pid, title);
    if (status !== 'next') await api.moveTask(id, status);
    await get().refresh();
  },
  // Full-field create (floating "New task" modal): add_task seeds title in 'next',
  // then we apply the non-default fields and move it to the chosen column.
  createTask: async ({ title, status, priority, kind, summary, description }) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const id = await api.addTask(pid, title.trim());
    const fields: api.UpdateTaskFields = {};
    if (priority !== 'none') fields.priority = priority;
    if (kind !== 'none') fields.kind = kind;
    if (summary.trim()) fields.summary = summary.trim();
    if (description.trim()) fields.description = description.trim();
    if (Object.keys(fields).length) await api.updateTask(id, fields);
    if (status !== 'next') await api.moveTask(id, status);
    await get().refresh();
  },
  addSubtask: async (parentId, title) => {
    await api.addSubtask(parentId, title);
    await get().refresh();
  },
  updateTask: async (id, fields) => {
    await api.updateTask(id, fields);
    await get().refresh();
  },
  moveTask: async (id, status) => {
    const snap = get().snapshot;
    if (snap) {
      set({
        snapshot: {
          ...snap,
          tasks: snap.tasks.map((t) => (t.id === id ? { ...t, status } : t)),
        },
      });
    }
    await api.moveTask(id, status);
    await get().refresh();
  },
  reorderTasks: async (ids) => {
    const snap = get().snapshot;
    if (snap) {
      const order = new Map(ids.map((tid, i) => [tid, i]));
      const positions = snap.tasks
        .filter((t) => order.has(t.id))
        .map((t) => t.position)
        .sort((a, b) => a - b);
      set({
        snapshot: {
          ...snap,
          tasks: snap.tasks.map((t) =>
            order.has(t.id)
              ? { ...t, position: positions[order.get(t.id)!] ?? t.position }
              : t,
          ),
        },
      });
    }
    await api.reorderTasks(ids);
    await get().refresh();
  },
  deleteTask: async (id) => {
    await api.deleteTask(id);
    if (get().selectedTaskId === id) set({ selectedTaskId: null });
    if (get().highlightedTaskId === id) set({ highlightedTaskId: null });
    await get().refresh();
  },
  setRefs: async (id, paths, symbols) => {
    await api.setRefs(id, paths, symbols);
    await get().refresh();
  },

  setPriority: async (id, priority) => {
    await api.updateTask(id, { priority });
    await get().refresh();
  },

  // ---- links ----
  linkTasks: async (from, to, type) => {
    await api.linkTasks(from, to, type);
    await get().refresh();
  },
  unlinkTasks: async (from, to, type) => {
    await api.unlinkTasks(from, to, type);
    await get().refresh();
  },

  // ---- notes ----
  setNotes: async (body) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    await api.setNotes(pid, body);
    await get().refresh();
  },

  setGoal: async (data) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    await api.setGoal(pid, data);
    await get().refresh();
  },

  // ---- toasts ----
  toasts: [],
  pushToast: ({ kind, text }) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    if (kind !== 'error') {
      setTimeout(() => get().dismissToast(id), 4000);
    }
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // ---- start button ----
  setProjectRepoPath: async (id, repoPath) => {
    try {
      await api.setProjectRepoPath(id, repoPath);
      await get().refresh();
    } catch (e) {
      get().pushToast({ kind: 'error', text: String(e) });
    }
  },
  startTask: async (id) => {
    try {
      const msg = await api.startTask(id, getTerminalApp(), getClaudeBin());
      get().pushToast({ kind: 'success', text: msg });
      await get().refresh();
    } catch (e) {
      get().pushToast({ kind: 'error', text: String(e) });
    }
  },
  openClaude: async (projectId) => {
    try {
      const msg = await api.openClaude(projectId, getTerminalApp(), getClaudeBin());
      get().pushToast({ kind: 'success', text: msg });
    } catch (e) {
      get().pushToast({ kind: 'error', text: String(e) });
    }
  },
}));
