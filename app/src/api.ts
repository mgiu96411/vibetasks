// Typed invoke() wrappers over every Tauri command exposed by src-tauri/src/commands.rs.
// Tauri converts Rust snake_case command params to camelCase on the JS side, so the
// argument keys below use camelCase (projectId, parentId, from, to, type, ...).

import { invoke } from '@tauri-apps/api/core';
import type { Snapshot, Status, Priority, Kind, LinkType } from 'shared';

// ---- reads ----------------------------------------------------------------

export const getSnapshot = (projectId: string) =>
  invoke<Snapshot>('get_snapshot', { projectId });

export const getDataVersion = () => invoke<number>('get_data_version');

// ---- projects -------------------------------------------------------------

export const createSpace = (name: string) =>
  invoke<string>('create_space', { name });

export const renameSpace = (id: string, name: string) =>
  invoke<void>('rename_space', { id, name });

export const deleteSpace = (id: string) =>
  invoke<void>('delete_space', { id });

export const reorderSpaces = (ids: string[]) =>
  invoke<void>('reorder_spaces', { ids });

export const moveProjectToSpace = (projectId: string, spaceId: string) =>
  invoke<void>('move_project_to_space', { projectId, spaceId });

export const createProject = (name: string, spaceId?: string) =>
  invoke<string>('create_project', { name, spaceId: spaceId ?? null });

export const renameProject = (id: string, name: string) =>
  invoke<void>('rename_project', { id, name });

export const deleteProject = (id: string) =>
  invoke<void>('delete_project', { id });

// ---- tasks ----------------------------------------------------------------

export const addTask = (projectId: string, title: string) =>
  invoke<string>('add_task', { projectId, title });

export const addSubtask = (parentId: string, title: string) =>
  invoke<string>('add_subtask', { parentId, title });

export interface UpdateTaskFields {
  title?: string;
  summary?: string;
  description?: string;
  priority?: Priority;
  kind?: Kind;
  version?: string;
  status?: Status;
}

export const updateTask = (id: string, fields: UpdateTaskFields) =>
  invoke<void>('update_task', {
    id,
    title: fields.title ?? null,
    summary: fields.summary ?? null,
    description: fields.description ?? null,
    priority: fields.priority ?? null,
    kind: fields.kind ?? null,
    version: fields.version ?? null,
    status: fields.status ?? null,
  });

export const moveTask = (id: string, status: Status) =>
  invoke<void>('move_task', { id, status });

export const reorderTasks = (ids: string[]) =>
  invoke<void>('reorder_tasks', { ids });

export const deleteTask = (id: string) => invoke<void>('delete_task', { id });

export const setRefs = (
  id: string,
  paths?: string[],
  symbols?: string[],
) =>
  invoke<void>('set_refs', {
    id,
    paths: paths ?? null,
    symbols: symbols ?? null,
  });

// ---- links ----------------------------------------------------------------

export const linkTasks = (from: string, to: string, type: LinkType) =>
  invoke<void>('link_tasks', { from, to, type });

export const unlinkTasks = (from: string, to: string, type: LinkType) =>
  invoke<void>('unlink_tasks', { from, to, type });

// ---- notes ----------------------------------------------------------------

export const setNotes = (projectId: string, body: string) =>
  invoke<void>('set_notes', { projectId, body });

export interface GoalData { goal: string; subgoals: string[]; following_goal: string; }

export const setGoal = (projectId: string, data: GoalData) =>
  invoke<void>('set_goal', { projectId, goalsJson: JSON.stringify(data) });

export const setGuardrails = (projectId: string, items: string[]) =>
  invoke<void>('set_guardrails', { projectId, items });

// ---- start button ---------------------------------------------------------

export const setProjectRepoPath = (id: string, repoPath: string) =>
  invoke<void>('set_project_repo_path', { id, repoPath });

/** Returns the success message; rejects with the error string on failure. */
export const startTask = (id: string, terminalApp: string, claudeBin: string) =>
  invoke<string>('start_task', { id, terminalApp, claudeBin });

/** Opens a bare Claude session in the project's repo path — no task, no prompt. */
export const openClaude = (id: string, terminalApp: string, claudeBin: string) =>
  invoke<string>('open_claude', { id, terminalApp, claudeBin });

/** Given first-class terminal ids, returns the subset that have an installed
 *  `.app` bundle — used to gray out missing options in the terminal picker. */
export const detectTerminals = (ids: string[]) =>
  invoke<string[]>('detect_terminals', { ids });
