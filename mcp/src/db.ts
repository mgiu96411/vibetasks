import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../shared/src/schema.sql'), 'utf8');

const SCHEMA_VERSION = 10;

// One-time migrations, gated by PRAGMA user_version (mirrored in
// app/src-tauri/src/db.rs — keep the two in sync):
//   v2: rebuild the `task` table when it predates now/next/later/complete/dropped
//       (old CHECK = todo/in_progress/complete) or lacks `reopened_at` — SQLite
//       can't ALTER a CHECK constraint, so we recreate the table and remap status.
//   v3: add the `kind` column (fix/feature/chore/rule/docs) when missing.
//   v4: add the `ref` column (short global reference number) + backfill by age.
//   v5: add `recap` + `recap_at` to `note` (the walk-away "last session" summary).
//   v6: add the freeform `version` column to task (groups the Complete column).
//   v7: add project spaces, seed the three starter spaces, and place existing
//       projects in Current projects.
//   v8: add project.repo_path (where the Start button launches Claude; human-set).
//   v9: switch ref from global counter to per-project counter — re-number all
//       existing tasks 1..n within each project ordered by creation time.
function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version >= SCHEMA_VERSION) return;

  const taskSql =
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='task'").get() as
      | { sql?: string }
      | undefined)?.sql ?? '';
  const needsRebuild =
    !!taskSql &&
    (taskSql.includes("'in_progress'") ||
      taskSql.includes("'todo'") ||
      !taskSql.includes('reopened_at'));

  if (needsRebuild) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE task_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          parent_id TEXT REFERENCES task(id) ON DELETE CASCADE,
          title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK(status IN ('now','next','later','complete','dropped')),
          priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none','low','med','high')),
          kind TEXT NOT NULL DEFAULT 'none' CHECK(kind IN ('none','fix','feature','chore','rule','docs')),
          paths TEXT NOT NULL DEFAULT '[]', symbols TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL CHECK(source IN ('claude','you')),
          position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          reopened_at TEXT
        );
        INSERT INTO task_new (id,project_id,parent_id,title,summary,description,status,priority,paths,symbols,source,position,created_at,updated_at,reopened_at)
        SELECT id,project_id,parent_id,title,summary,description,
          CASE status WHEN 'todo' THEN 'next' WHEN 'in_progress' THEN 'now' WHEN 'complete' THEN 'complete'
            WHEN 'now' THEN 'now' WHEN 'next' THEN 'next' WHEN 'later' THEN 'later' WHEN 'dropped' THEN 'dropped'
            ELSE 'next' END,
          priority,paths,symbols,source,position,created_at,updated_at,NULL
        FROM task;
        DROP TABLE task;
        ALTER TABLE task_new RENAME TO task;
        CREATE INDEX IF NOT EXISTS idx_task_project ON task(project_id, status, position);
      `);
    })();
    db.pragma('foreign_keys = ON');
  }

  // v3: add the `kind` column when missing (no table rebuild needed — SQLite
  // allows ADD COLUMN with a CHECK constraint and a constant default).
  const hasKind = (db.prepare('PRAGMA table_info(task)').all() as { name: string }[])
    .some((c) => c.name === 'kind');
  if (!hasKind) {
    db.exec("ALTER TABLE task ADD COLUMN kind TEXT NOT NULL DEFAULT 'none' CHECK(kind IN ('none','fix','feature','chore','rule','docs'))");
  }

  // v4: add the `ref` column (short global reference number) when missing, then
  // backfill existing tasks sequentially by creation order (1..n).
  const hasRef = (db.prepare('PRAGMA table_info(task)').all() as { name: string }[])
    .some((c) => c.name === 'ref');
  if (!hasRef) {
    db.exec('ALTER TABLE task ADD COLUMN ref INTEGER NOT NULL DEFAULT 0');
    db.exec(`UPDATE task SET ref = (
      SELECT COUNT(*) FROM task t2
      WHERE t2.created_at < task.created_at
         OR (t2.created_at = task.created_at AND t2.rowid <= task.rowid)
    ) WHERE ref = 0`);
  }

  // v5: add the walk-away recap columns to `note` when missing (Claude writes
  // the "last session" summary into `recap` at wrap-up; `recap_at` stamps it).
  const noteCols = (db.prepare('PRAGMA table_info(note)').all() as { name: string }[]).map((c) => c.name);
  if (!noteCols.includes('recap')) {
    db.exec("ALTER TABLE note ADD COLUMN recap TEXT NOT NULL DEFAULT ''");
    db.exec('ALTER TABLE note ADD COLUMN recap_at TEXT');
  }

  // v6: freeform `version` label on task (groups the Complete column by release).
  const hasVersion = (db.prepare('PRAGMA table_info(task)').all() as { name: string }[])
    .some((c) => c.name === 'version');
  if (!hasVersion) {
    db.exec("ALTER TABLE task ADD COLUMN version TEXT NOT NULL DEFAULT ''");
  }

  // v7: workspace-level project sections. `space_id` stays nullable at the
  // schema level so SQLite can add it without rebuilding the project table;
  // normal writes always assign it, and the migration backfills every row.
  const hasSpaceId = (db.prepare('PRAGMA table_info(project)').all() as { name: string }[])
    .some((c) => c.name === 'space_id');
  if (!hasSpaceId) {
    db.exec('ALTER TABLE project ADD COLUMN space_id TEXT REFERENCES space(id) ON DELETE SET NULL');
  }
  const seededAt = new Date().toISOString();
  const seed = db.prepare(
    'INSERT OR IGNORE INTO space(id,name,position,created_at,updated_at) VALUES(?,?,?,?,?)',
  );
  seed.run('space-current', 'Current projects', 1, seededAt, seededAt);
  seed.run('space-finished', 'Finished projects', 2, seededAt, seededAt);
  seed.run('space-open-sourcer', 'Open Sourcer', 3, seededAt, seededAt);
  db.prepare("UPDATE project SET space_id='space-current' WHERE space_id IS NULL").run();
  db.exec('CREATE INDEX IF NOT EXISTS idx_project_space ON project(space_id, position)');

  // v8: path the Start button uses to launch Claude for this project. Human-set
  // via the sidebar; the MCP reads but never writes it. Mirrors app/src-tauri/src/db.rs.
  const projectCols2 = (db.prepare('PRAGMA table_info(project)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!projectCols2.includes('repo_path')) {
    db.exec('ALTER TABLE project ADD COLUMN repo_path TEXT;');
  }

  // v9: re-number refs per-project (was global). Order by creation time within
  // each project so existing chronological order is preserved.
  if (version < 9) {
    db.exec(`UPDATE task SET ref = (
      SELECT COUNT(*) FROM task t2
      WHERE t2.project_id = task.project_id
        AND (t2.created_at < task.created_at
          OR (t2.created_at = task.created_at AND t2.rowid <= task.rowid))
    )`);
  }

  // v10: goals column on note (JSON milestone + subgoals + following_goal).
  const noteCols2 = (db.prepare('PRAGMA table_info(note)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!noteCols2.includes('goals')) {
    db.exec('ALTER TABLE note ADD COLUMN goals TEXT DEFAULT NULL;');
  }

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
export const dataVersion = (db: Database.Database): number =>
  (db.pragma('data_version', { simple: true }) as number);
