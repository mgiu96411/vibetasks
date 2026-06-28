export type Source = 'claude' | 'you';
export type Status = 'now' | 'next' | 'later' | 'complete' | 'dropped';
export type Priority = 'none' | 'low' | 'med' | 'high';
// Item type/kind, orthogonal to status/priority. 'none' = untyped.
export type Kind = 'none' | 'fix' | 'feature' | 'chore' | 'rule' | 'docs';
export type LinkType = 'depends_on' | 'related';

export interface Space { id: string; name: string; position: number; created_at: string; updated_at: string; }
export interface Project { id: string; name: string; color: string; source: Source; space_id: string | null; repo_path: string | null; position: number; created_at: string; updated_at: string; }
export interface Task {
  id: string; project_id: string; parent_id: string | null;
  // Short, stable, human-referenceable number (global, monotonic). "task #ref".
  ref: number;
  // Product language: summary = Brief (short map-visible handle),
  // description = Details (full body loaded on demand).
  title: string; summary: string; description: string;
  status: Status; priority: Priority; kind: Kind;
  // Freeform release/epoch label (e.g. "v0.4.0"); '' = unversioned. Groups the Complete column.
  version: string;
  paths: string[]; symbols: string[];
  source: Source; position: number; created_at: string; updated_at: string;
  // Set when a task is moved OUT of 'complete' (reopened); cleared when completed again.
  reopened_at: string | null;
}
export interface Todo { id: string; project_id: string; text: string; done: boolean; source: Source; position: number; created_at: string; updated_at: string; }
export interface Goal { goal: string; subgoals: string[]; following_goal: string; }
export interface Note { project_id: string; body: string; updated_at: string; recap: string; recap_at: string | null; goals: string | null; guardrails: string | null; }
export interface TaskLink { from_task_id: string; to_task_id: string; type: LinkType; }

// Compact task card for model-facing board reads (no Details body). Includes subtasks.
export interface TaskCard { id: string; ref: number; title: string; status: Status; priority: Priority; kind: Kind; version: string; source: Source; parent_id: string | null; has_subtasks: boolean; has_details: boolean; reopened: boolean; }
export interface MapNode { id: string; ref: number; title: string; summary: string; has_details: boolean; status: Status; priority: Priority; kind: Kind; parent_id: string | null; paths: string[]; symbols: string[]; }
export interface MapView { nodes: MapNode[]; edges: TaskLink[]; }
// Full snapshot the desktop app renders.
export interface Snapshot { spaces: Space[]; projects: Project[]; tasks: Task[]; todos: Todo[]; note: Note | null; links: TaskLink[]; }
