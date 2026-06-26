import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Space, Project, Task, Todo, Note, TaskCard, MapView, Source, Status, Priority, Kind, LinkType } from 'shared';

const newId = (): string => randomUUID();
const nowIso = (): string => new Date().toISOString();
export const DEFAULT_SPACE_ID = 'space-current';

const rowToTask = (r: any): Task => ({ ...r, parent_id: r.parent_id ?? null,
  reopened_at: r.reopened_at ?? null,
  paths: JSON.parse(r.paths), symbols: JSON.parse(r.symbols) });

function nextPosition(db: Database, sql: string, args: any[]): number {
  const row = db.prepare(sql).get(...args) as { m: number | null };
  return (row?.m ?? 0) + 1;
}

function oneProjectByName(db: Database, name: string): Project | undefined {
  const rows = db.prepare('SELECT * FROM project WHERE name=? ORDER BY position LIMIT 2').all(name) as Project[];
  if (rows.length > 1) {
    throw new Error(`Multiple projects named "${name}". Target one by id, or rename/merge the duplicates first.`);
  }
  return rows[0];
}

function oneSpaceByName(db: Database, name: string): Space | undefined {
  const rows = db.prepare('SELECT * FROM space WHERE name=? ORDER BY position LIMIT 2').all(name) as Space[];
  if (rows.length > 1) {
    throw new Error(`Multiple spaces named "${name}". Target one by id, or rename the duplicates first.`);
  }
  return rows[0];
}

function requireSpace(db: Database, id: string): Space {
  const space = db.prepare('SELECT * FROM space WHERE id=?').get(id) as Space | undefined;
  if (!space) throw new Error(`No space matching "${id}".`);
  return space;
}

export const listSpaces = (db: Database): Space[] =>
  db.prepare('SELECT * FROM space ORDER BY position').all() as Space[];

export const findSpace = (db: Database, idOrName: string): Space | undefined =>
  (db.prepare('SELECT * FROM space WHERE id=?').get(idOrName) as Space | undefined) ??
  oneSpaceByName(db, idOrName);

export function createSpace(db: Database, name: string): Space {
  const existing = oneSpaceByName(db, name);
  if (existing) return existing;
  const now = nowIso();
  const id = newId();
  const position = nextPosition(db, 'SELECT MAX(position) m FROM space', []);
  db.prepare(`INSERT INTO space(id,name,position,created_at,updated_at)
    VALUES(?,?,?,?,?)`).run(id, name, position, now, now);
  return requireSpace(db, id);
}

export function renameSpace(db: Database, id: string, name: string): void {
  requireSpace(db, id);
  const existing = oneSpaceByName(db, name);
  if (existing && existing.id !== id) {
    throw new Error(`A space named "${name}" already exists.`);
  }
  db.prepare('UPDATE space SET name=?,updated_at=? WHERE id=?').run(name, nowIso(), id);
}

export const countSpaceProjects = (db: Database, space_id: string): number =>
  (db.prepare('SELECT COUNT(*) c FROM project WHERE space_id=?').get(space_id) as { c: number }).c;

export function deleteSpace(db: Database, id: string): void {
  const space = requireSpace(db, id);
  if (id === DEFAULT_SPACE_ID) {
    throw new Error(`"${space.name}" is the default space and cannot be deleted.`);
  }
  const count = countSpaceProjects(db, id);
  if (count > 0) {
    throw new Error(`"${space.name}" contains ${count} project(s). Move them before deleting the space.`);
  }
  db.prepare('DELETE FROM space WHERE id=?').run(id);
}

export function moveProjectToSpace(db: Database, project_id: string, space_id: string): void {
  requireSpace(db, space_id);
  const project = db.prepare('SELECT id FROM project WHERE id=?').get(project_id);
  if (!project) throw new Error(`No project matching "${project_id}".`);
  db.prepare('UPDATE project SET space_id=?,updated_at=? WHERE id=?')
    .run(space_id, nowIso(), project_id);
}

export function createProject(db: Database, i: { name: string; color?: string; source: Source; space_id?: string }): Project {
  const existing = oneProjectByName(db, i.name);
  if (existing) return existing;
  const spaceId = i.space_id ?? DEFAULT_SPACE_ID;
  requireSpace(db, spaceId);
  const now = nowIso(); const id = newId();
  const position = nextPosition(db, 'SELECT MAX(position) m FROM project', []);
  db.prepare(`INSERT INTO project(id,name,color,source,space_id,position,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(id, i.name, i.color ?? '#7c8cff', i.source, spaceId, position, now, now);
  return db.prepare('SELECT * FROM project WHERE id=?').get(id) as Project;
}
export const listProjects = (db: Database): Project[] =>
  db.prepare('SELECT * FROM project ORDER BY position').all() as Project[];
export function renameProject(db: Database, id: string, name: string): void {
  const existing = oneProjectByName(db, name);
  if (existing && existing.id !== id) {
    throw new Error(`A project named "${name}" already exists. Rename or merge it first.`);
  }
  db.prepare('UPDATE project SET name=?,updated_at=? WHERE id=?').run(name, nowIso(), id);
}
export const deleteProject = (db: Database, id: string): void => { db.prepare('DELETE FROM project WHERE id=?').run(id); };

export function ensureProject(db: Database, name: string, source: Source = 'claude'): Project {
  const found = oneProjectByName(db, name);
  return found ?? createProject(db, { name, source });
}
export const findProjectByName = (db: Database, name: string): Project | undefined =>
  oneProjectByName(db, name);

// A worktree/temp directory name (e.g. a session uuid) leaking in as a project name.
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ResolveOpts = { explicit?: string; envProject?: string; cwdBase: string };

// Error body for a name that matched no board — always lists the boards that DO exist,
// so the next call targets a real one by its exact name instead of re-inventing a typo
// (the resume("vibe-tasks") incident, where a guessed name minted an empty board).
function noBoardError(db: Database, name: string, hint: string): Error {
  const names = listProjects(db).map(p => `"${p.name}"`);
  const existing = names.length ? names.join(', ') : '(none yet)';
  return new Error(
    `Vibe Tasks: no board named "${name}". Existing boards: ${existing}. ${hint}`,
  );
}

// READ resolver — used by every read tool (get_board, get_map, list_tasks, resume,
// get_notes). It NEVER creates a board: a miss on any path throws, listing the real
// boards. Reading a board that doesn't exist is a caller error, not a reason to mint one.
export function resolveForRead(db: Database, opts: ResolveOpts): string {
  const name = (opts.explicit?.trim() || opts.envProject?.trim() || opts.cwdBase).trim();
  const found = findProjectByName(db, name);
  if (found) return found.id;
  throw noBoardError(
    db,
    name,
    'Pass project="<exact name>" to read one of them, or create_project to start a new board ' +
      '— do not retype a guessed name.',
  );
}

// WRITE resolver — used by write tools (add_task(s), set_notes, set_recap). It bootstraps
// the first board of a fresh repo, but refuses to mint a parallel board from a TYPED name
// (explicit arg / env) whenever any board already exists — that typed-name-beside-existing
// case is the duplicate-board bug. New boards are made deliberately via create_project.
// Priority: explicit arg, then VIBETASKS_PROJECT env, then the cwd basename.
export function resolveForWrite(db: Database, opts: ResolveOpts): string {
  const intentional = opts.explicit?.trim() || opts.envProject?.trim();
  if (intentional) {
    const found = findProjectByName(db, intentional);
    if (found) return found.id;
    // Minting from a typed name is only safe when there is no board to confuse it with.
    if (listProjects(db).length > 0) {
      throw noBoardError(
        db,
        intentional,
        'Refusing to auto-create a board from a typed name while others exist (it is usually a ' +
          'typo for one of them). Target an existing board by its exact name, or call ' +
          'create_project to make a genuinely new one.',
      );
    }
    return ensureProject(db, intentional, 'claude').id;
  }
  // cwd fallback — zero-config "each repo maps to its own board" bootstrap.
  const existing = findProjectByName(db, opts.cwdBase);
  if (existing) return existing.id;
  if (UUIDISH.test(opts.cwdBase)) {
    throw new Error(
      `Vibe Tasks: refusing to auto-create a project named "${opts.cwdBase}" — it looks like a ` +
        `worktree/temp directory, not a board. Set VIBETASKS_PROJECT to your board name in the MCP ` +
        `server env, pass project="<name>" on the call, or call create_project first.`,
    );
  }
  return ensureProject(db, opts.cwdBase, 'claude').id;
}

// Back-compat alias. The MCP read/write tools call resolveForRead/resolveForWrite
// directly; this preserves the original create-on-miss write semantics for any
// remaining caller.
export const resolveProjectId = resolveForWrite;

// ---- Project repair (fix messy boards without raw SQL) ----
// Find a project by exact id OR exact name (id first). For rename/delete/reassign
// the human/Claude targets a specific board, not the working-dir default.
export const findProject = (db: Database, idOrName: string): Project | undefined =>
  (db.prepare('SELECT * FROM project WHERE id=?').get(idOrName) as Project | undefined) ??
  findProjectByName(db, idOrName);

export const countProjectTasks = (db: Database, project_id: string): number =>
  (db.prepare('SELECT COUNT(*) c FROM task WHERE project_id=?').get(project_id) as { c: number }).c;

// Move every task (with its subtasks, links and #refs — all keyed by stable task id)
// from one project into another, in a transaction. The source's note is NOT moved
// (one note per project); callers typically delete the emptied source afterwards.
// Moved tasks are pushed past existing positions so ordering stays sane. No-op if
// from === into. Returns the number of tasks moved.
export function reassignProjectTasks(db: Database, fromId: string, toId: string): number {
  if (fromId === toId) return 0;
  const run = db.transaction(() => {
    const changes = db.prepare('UPDATE task SET project_id=?, position=position+1000000, updated_at=? WHERE project_id=?')
      .run(toId, nowIso(), fromId).changes;
    // Re-number refs in target project to eliminate any collisions after merge.
    db.prepare(`UPDATE task SET ref = (
      SELECT COUNT(*) FROM task t2
      WHERE t2.project_id = task.project_id
        AND (t2.created_at < task.created_at
          OR (t2.created_at = task.created_at AND t2.rowid <= task.rowid))
    ) WHERE project_id = ?`).run(toId);
    return changes;
  });
  return run() as number;
}

export function addTask(db: Database, i: {
  project_id: string; title: string; summary?: string; description?: string;
  status?: Status; priority?: Priority; kind?: Kind; version?: string; paths?: string[]; symbols?: string[];
  parent_id?: string | null; source: Source;
}): Task {
  // New tasks land in the Next column by default (queued, not yet started).
  const now = nowIso(); const id = newId(); const status: Status = i.status ?? 'next';
  const position = nextPosition(db,
    'SELECT MAX(position) m FROM task WHERE project_id=? AND status=?', [i.project_id, status]);
  db.prepare(`INSERT INTO task(id,project_id,parent_id,title,summary,description,status,priority,kind,version,paths,symbols,source,position,created_at,updated_at,ref)
    VALUES(@id,@project_id,@parent_id,@title,@summary,@description,@status,@priority,@kind,@version,@paths,@symbols,@source,@position,@created_at,@updated_at,(SELECT COALESCE(MAX(ref),0)+1 FROM task WHERE project_id=@project_id))`)
    .run({ id, project_id: i.project_id, parent_id: i.parent_id ?? null, title: i.title,
      summary: i.summary ?? '', description: i.description ?? '', status, priority: i.priority ?? 'none',
      kind: i.kind ?? 'none', version: i.version ?? '',
      paths: JSON.stringify(i.paths ?? []), symbols: JSON.stringify(i.symbols ?? []),
      source: i.source, position, created_at: now, updated_at: now });
  return rowToTask(db.prepare('SELECT * FROM task WHERE id=?').get(id));
}
export const getTask = (db: Database, id: string): Task | null => {
  const r = db.prepare('SELECT * FROM task WHERE id=?').get(id); return r ? rowToTask(r) : null; };
export const getTaskByRef = (db: Database, project_id: string, ref: number): Task | null => {
  const r = db.prepare('SELECT * FROM task WHERE project_id=? AND ref=?').get(project_id, ref);
  return r ? rowToTask(r) : null;
};
export const listProjectTasks = (db: Database, project_id: string): Task[] =>
  (db.prepare('SELECT * FROM task WHERE project_id=? ORDER BY status,position').all(project_id) as any[])
    .map(rowToTask);
export function resolveTaskInProject(db: Database, project_id: string, idOrRef: string): Task | null {
  const raw = idOrRef.trim();
  const ref = raw.match(/^#?(\d+)$/)?.[1];
  if (ref) return getTaskByRef(db, project_id, Number(ref));
  const task = getTask(db, raw);
  return task?.project_id === project_id ? task : null;
}

// Decide reopened_at on a status transition: cleared when entering complete, stamped
// when leaving complete, otherwise preserved.
function reopenedFor(prev: Status, next: Status, current: string | null): string | null {
  if (next === 'complete') return null;
  if (prev === 'complete') return nowIso();
  return current;
}

export function updateTask(db: Database, id: string, f: Partial<Pick<Task,'title'|'summary'|'description'|'priority'|'kind'|'version'|'paths'|'symbols'|'status'>>): void {
  const cur = getTask(db, id); if (!cur) return;
  // Callers (tool handlers) pass explicit-undefined for omitted fields; treat
  // those as "leave unchanged" so the spread can't null a NOT NULL column.
  const provided = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as typeof f;
  const merged = { ...cur, ...provided };
  const reopened_at = reopenedFor(cur.status, merged.status, cur.reopened_at);
  db.prepare(`UPDATE task SET title=?,summary=?,description=?,priority=?,kind=?,version=?,status=?,paths=?,symbols=?,reopened_at=?,updated_at=? WHERE id=?`)
    .run(merged.title, merged.summary, merged.description, merged.priority, merged.kind, merged.version, merged.status,
         JSON.stringify(merged.paths), JSON.stringify(merged.symbols), reopened_at, nowIso(), id);
}
export function moveTask(db: Database, id: string, status: Status): void {
  const cur = getTask(db, id); if (!cur) return;
  const position = nextPosition(db, 'SELECT MAX(position) m FROM task WHERE project_id=(SELECT project_id FROM task WHERE id=?) AND status=?', [id, status]);
  const reopened_at = reopenedFor(cur.status, status, cur.reopened_at);
  db.prepare('UPDATE task SET status=?,position=?,reopened_at=?,updated_at=? WHERE id=?').run(status, position, reopened_at, nowIso(), id);
}
export function reorderTasks(db: Database, ids: string[]): void {
  const stmt = db.prepare('UPDATE task SET position=?,updated_at=? WHERE id=?');
  const now = nowIso();
  db.transaction(() => ids.forEach((id, idx) => stmt.run(idx + 1, now, id)))();
}
export const deleteTask = (db: Database, id: string): void => { db.prepare('DELETE FROM task WHERE id=?').run(id); };
export function setRefs(db: Database, id: string, paths?: string[], symbols?: string[]): void {
  const cur = getTask(db, id); if (!cur) return;
  db.prepare('UPDATE task SET paths=?,symbols=?,updated_at=? WHERE id=?')
    .run(JSON.stringify(paths ?? cur.paths), JSON.stringify(symbols ?? cur.symbols), nowIso(), id);
}
// links
export function linkTasks(db: Database, from: string, to: string, type: LinkType): void {
  db.prepare('INSERT OR IGNORE INTO task_link(from_task_id,to_task_id,type) VALUES(?,?,?)').run(from, to, type); }
export function unlinkTasks(db: Database, from: string, to: string, type: LinkType): void {
  db.prepare('DELETE FROM task_link WHERE from_task_id=? AND to_task_id=? AND type=?').run(from, to, type); }
// todos
export function addTodo(db: Database, i: { project_id: string; text: string; source: Source }): Todo {
  const now = nowIso(); const id = newId();
  const position = nextPosition(db, 'SELECT MAX(position) m FROM todo WHERE project_id=?', [i.project_id]);
  db.prepare('INSERT INTO todo(id,project_id,text,done,source,position,created_at,updated_at) VALUES(?,?,?,0,?,?,?,?)')
    .run(id, i.project_id, i.text, i.source, position, now, now);
  return db.prepare('SELECT * FROM todo WHERE id=?').get(id) as Todo;
}
export const toggleTodo = (db: Database, id: string): void => { db.prepare('UPDATE todo SET done=1-done,updated_at=? WHERE id=?').run(nowIso(), id); };
export const updateTodo = (db: Database, id: string, text: string): void => { db.prepare('UPDATE todo SET text=?,updated_at=? WHERE id=?').run(text, nowIso(), id); };
export const deleteTodo = (db: Database, id: string): void => { db.prepare('DELETE FROM todo WHERE id=?').run(id); };
// notes / goal
export interface GoalData { goal: string; subgoals: string[]; following_goal: string; }
export function setGoal(db: Database, project_id: string, data: GoalData): void {
  const goals = JSON.stringify(data);
  const now = nowIso();
  db.prepare(`INSERT INTO note(project_id,body,updated_at,goals) VALUES(?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET goals=excluded.goals, updated_at=excluded.updated_at`)
    .run(project_id, '', now, goals);
}
export function getGoal(db: Database, project_id: string): GoalData | null {
  const row = db.prepare('SELECT goals FROM note WHERE project_id=?').get(project_id) as { goals: string | null } | undefined;
  if (!row?.goals) return null;
  try { return JSON.parse(row.goals) as GoalData; } catch { return null; }
}
export function setNotes(db: Database, project_id: string, body: string): void {
  db.prepare(`INSERT INTO note(project_id,body,updated_at) VALUES(?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`)
    .run(project_id, body, nowIso());
}
export const getNotes = (db: Database, project_id: string): Note | null =>
  (db.prepare('SELECT * FROM note WHERE project_id=?').get(project_id) as Note) ?? null;
// Walk-away recap: a short, dated "where we left off" written by Claude at wrap-up.
// Stored separately from the freeform `body` so it never clobbers human notes.
export function setRecap(db: Database, project_id: string, recap: string): void {
  const now = nowIso();
  db.prepare(`INSERT INTO note(project_id,body,updated_at,recap,recap_at) VALUES(?, '', ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET recap=excluded.recap, recap_at=excluded.recap_at`)
    .run(project_id, now, recap, now);
}

// ---- Token-efficient reads ----
const DESC_CAP = 600;
const SUMMARY_CAP = 240;
const REF_ITEM_CAP = 180;
const REF_LIST_CAP = 20;
const capText = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s;
const cap = (s: string) => capText(s, DESC_CAP);
const capRefs = (xs: string[]) => xs.slice(0, REF_LIST_CAP).map((x) => capText(x, REF_ITEM_CAP));

export interface BoardView {
  cards: TaskCard[];
  detail: Task[];
  reopened: { id: string; ref: number; title: string; status: Status; parent_id: string | null }[];
  goal?: GoalData;
}
export function getBoard(db: Database, project_id: string): BoardView {
  const tasks = listProjectTasks(db, project_id);
  const childCount = new Map<string, number>();
  tasks.forEach(t => { if (t.parent_id) childCount.set(t.parent_id, (childCount.get(t.parent_id) ?? 0) + 1); });
  const cards: TaskCard[] = tasks.map(t => ({
    id: t.id, ref: t.ref, title: t.title, status: t.status, priority: t.priority, kind: t.kind, version: t.version, source: t.source,
    parent_id: t.parent_id, has_subtasks: (childCount.get(t.id) ?? 0) > 0,
    has_details: t.description.trim().length > 0, reopened: !!t.reopened_at }));
  // Full detail only for the active "Now" column (the flat-context protocol).
  // Brief stays capped even in Now; Details gets the larger Now-body cap.
  const detail = tasks.filter(t => t.status === 'now').map(t => ({
    ...t,
    summary: capText(t.summary, SUMMARY_CAP),
    description: cap(t.description),
  }));
  // Tasks moved out of Complete — Claude should investigate these before unrelated work.
  const reopened = tasks.filter(t => t.reopened_at)
    .map(t => ({ id: t.id, ref: t.ref, title: t.title, status: t.status, parent_id: t.parent_id }));
  const goal = getGoal(db, project_id) ?? undefined;
  return { cards, detail, reopened, ...(goal ? { goal } : {}) };
}
// Compact list of every task with its reference number — for "work on #N" lookups.
export type TaskListItem = Pick<Task, 'ref' | 'id' | 'title' | 'status' | 'priority' | 'kind'>;
export function listTasks(db: Database, project_id: string): TaskListItem[] {
  return db.prepare('SELECT ref,id,title,status,priority,kind FROM task WHERE project_id=? ORDER BY ref').all(project_id) as TaskListItem[];
}
export function getMap(db: Database, project_id: string): MapView {
  const nodes = (db.prepare(`
      SELECT id,ref,title,summary,
        CASE WHEN length(trim(description)) > 0 THEN 1 ELSE 0 END AS has_details,
        status,priority,kind,parent_id,paths,symbols
      FROM task WHERE project_id=?
    `).all(project_id) as any[])
    .map(r => ({
      ...r,
      summary: capText(r.summary, SUMMARY_CAP),
      has_details: !!r.has_details,
      parent_id: r.parent_id ?? null,
      paths: capRefs(JSON.parse(r.paths)),
      symbols: capRefs(JSON.parse(r.symbols)),
    }));
  const ids = new Set(nodes.map(n => n.id));
  const edges = (db.prepare('SELECT from_task_id,to_task_id,type FROM task_link').all() as any[])
    .filter(e => ids.has(e.from_task_id) && ids.has(e.to_task_id));
  return { nodes, edges };
}
export function resume(db: Database, project_id: string, opts: { include_map?: boolean } = {}) {
  const board = getBoard(db, project_id);
  const titles = board.cards.map(c => ({ id: c.id, ref: c.ref, title: c.title, status: c.status }));
  const note = getNotes(db, project_id);
  // `recap` is the walk-away "last session" testimony (write-only — never fed back
  // in to produce the next one); the live board above is the present-tense source.
  const goal = board.goal;
  const base = { now: board.detail, titles, reopened: board.reopened,
    recap: note?.recap ?? '', recap_at: note?.recap_at ?? null, notes_excerpt: cap(note?.body ?? ''),
    ...(goal ? { goal } : {}) };
  return opts.include_map ? { ...base, map: getMap(db, project_id) } : base;
}
