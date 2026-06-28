use rusqlite::Connection;
use std::{fs, path::PathBuf};

const SCHEMA_VERSION: i64 = 11;

/// Resolve the DB path: `VIBETASKS_DB` env override, else `~/.vibetasks/vibetasks.db`.
/// Ensures the parent directory exists.
pub fn db_path() -> PathBuf {
    let dir = dirs::home_dir().expect("home dir").join(".vibetasks");
    fs::create_dir_all(&dir).ok();
    std::env::var("VIBETASKS_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dir.join("vibetasks.db"))
}

/// Open the shared SQLite DB with WAL + busy_timeout + foreign_keys, apply the
/// canonical schema (embedded copy of `shared/src/schema.sql`), then migrate.
pub fn open() -> Connection {
    let c = Connection::open(db_path()).expect("open db");
    c.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
    )
    .expect("set pragmas");
    c.execute_batch(include_str!("../schema.sql"))
        .expect("apply schema");
    migrate(&c);
    c
}

/// One-time migration mirroring `mcp/src/db.ts`: rebuild the `task` table when it
/// predates now/next/later/complete/dropped or lacks `reopened_at` (SQLite can't
/// ALTER a CHECK constraint). Gated by PRAGMA user_version so it runs once.
/// v8: add project.repo_path (where the Start button launches Claude; human-set).
fn migrate(c: &Connection) {
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if version >= SCHEMA_VERSION {
        return;
    }
    let task_sql: String = c
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='task'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    let needs_rebuild = !task_sql.is_empty()
        && (task_sql.contains("'in_progress'")
            || task_sql.contains("'todo'")
            || !task_sql.contains("reopened_at"));

    if needs_rebuild {
        c.execute_batch("PRAGMA foreign_keys=OFF;").ok();
        c.execute_batch(
            "BEGIN;
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
             COMMIT;",
        )
        .expect("migrate task table");
        c.execute_batch("PRAGMA foreign_keys=ON;").ok();
    }

    // v3: add the `kind` column when missing (SQLite allows ADD COLUMN with a
    // CHECK + constant default — no table rebuild). Mirrors mcp/src/db.ts.
    let has_kind = {
        let mut stmt = c
            .prepare("PRAGMA table_info(task)")
            .expect("table_info(task)");
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .expect("table_info rows")
            .filter_map(|x| x.ok())
            .collect();
        cols.iter().any(|n| n == "kind")
    };
    if !has_kind {
        c.execute_batch(
            "ALTER TABLE task ADD COLUMN kind TEXT NOT NULL DEFAULT 'none' CHECK(kind IN ('none','fix','feature','chore','rule','docs'));",
        )
        .expect("add kind column");
    }

    // v4: add the `ref` column (short global reference number) when missing, then
    // backfill existing tasks sequentially by creation order. Mirrors mcp/src/db.ts.
    let has_ref = {
        let mut stmt = c
            .prepare("PRAGMA table_info(task)")
            .expect("table_info(task)");
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .expect("table_info rows")
            .filter_map(|x| x.ok())
            .collect();
        cols.iter().any(|n| n == "ref")
    };
    if !has_ref {
        c.execute_batch(
            "ALTER TABLE task ADD COLUMN ref INTEGER NOT NULL DEFAULT 0;
             UPDATE task SET ref = (
               SELECT COUNT(*) FROM task t2
               WHERE t2.created_at < task.created_at
                  OR (t2.created_at = task.created_at AND t2.rowid <= task.rowid)
             ) WHERE ref = 0;",
        )
        .expect("add+backfill ref column");
    }

    // v5: add the walk-away recap columns to `note` when missing (Claude writes
    // the "last session" summary into `recap`; `recap_at` stamps it). Mirrors mcp/src/db.ts.
    let has_recap = {
        let mut stmt = c
            .prepare("PRAGMA table_info(note)")
            .expect("table_info(note)");
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .expect("table_info rows")
            .filter_map(|x| x.ok())
            .collect();
        cols.iter().any(|n| n == "recap")
    };
    if !has_recap {
        c.execute_batch(
            "ALTER TABLE note ADD COLUMN recap TEXT NOT NULL DEFAULT '';
             ALTER TABLE note ADD COLUMN recap_at TEXT;",
        )
        .expect("add recap columns");
    }

    // v6: freeform `version` label on task (groups the Complete column). Mirrors mcp/src/db.ts.
    let has_version = {
        let mut stmt = c
            .prepare("PRAGMA table_info(task)")
            .expect("table_info(task)");
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .expect("table_info rows")
            .filter_map(|x| x.ok())
            .collect();
        cols.iter().any(|n| n == "version")
    };
    if !has_version {
        c.execute_batch("ALTER TABLE task ADD COLUMN version TEXT NOT NULL DEFAULT '';")
            .expect("add version column");
    }

    // v7: workspace-level project spaces. The nullable FK lets SQLite add the
    // column without rebuilding `project`; all existing rows are backfilled.
    let has_space_id = {
        let mut stmt = c
            .prepare("PRAGMA table_info(project)")
            .expect("table_info(project)");
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .expect("table_info rows")
            .filter_map(|x| x.ok())
            .collect();
        cols.iter().any(|n| n == "space_id")
    };
    if !has_space_id {
        c.execute_batch(
            "ALTER TABLE project ADD COLUMN space_id TEXT REFERENCES space(id) ON DELETE SET NULL;",
        )
        .expect("add project space_id");
    }
    c.execute_batch(
        "INSERT OR IGNORE INTO space(id,name,position,created_at,updated_at)
           VALUES('space-current','Current projects',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
         INSERT OR IGNORE INTO space(id,name,position,created_at,updated_at)
           VALUES('space-finished','Finished projects',2,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
         INSERT OR IGNORE INTO space(id,name,position,created_at,updated_at)
           VALUES('space-open-sourcer','Open Sourcer',3,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
         UPDATE project SET space_id='space-current' WHERE space_id IS NULL;
         CREATE INDEX IF NOT EXISTS idx_project_space ON project(space_id, position);",
    )
    .expect("seed project spaces");

    // v8: where the Start button launches Claude for this project. Human-set
    // via the sidebar; the MCP reads but never writes it. Mirrors mcp/src/db.ts.
    let has_repo_path = {
        let mut stmt = c
            .prepare("PRAGMA table_info(project)")
            .expect("table_info(project)");
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .expect("table_info rows")
            .filter_map(|x| x.ok())
            .collect();
        cols.iter().any(|n| n == "repo_path")
    };
    if !has_repo_path {
        c.execute_batch("ALTER TABLE project ADD COLUMN repo_path TEXT;")
            .expect("add project repo_path");
    }

    // v9: re-number refs per-project (was global). Order by creation time within
    // each project so existing chronological order is preserved.
    if version < 9 {
        c.execute_batch(
            "UPDATE task SET ref = (
               SELECT COUNT(*) FROM task t2
               WHERE t2.project_id = task.project_id
                 AND (t2.created_at < task.created_at
                   OR (t2.created_at = task.created_at AND t2.rowid <= task.rowid))
             );",
        )
        .expect("v9: renumber refs per-project");
    }

    // v10: add goals column to note (JSON-encoded milestone + subgoals + following_goal).
    let has_goals = {
        let mut stmt = c
            .prepare("PRAGMA table_info(note)")
            .expect("table_info(note)");
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .expect("table_info rows")
            .filter_map(|x| x.ok())
            .collect();
        cols.iter().any(|n| n == "goals")
    };
    if !has_goals {
        c.execute_batch("ALTER TABLE note ADD COLUMN goals TEXT DEFAULT NULL;")
            .expect("add goals column");
    }

    // v11: guardrails column on note (JSON array of short inviolable rules).
    let has_guardrails = {
        let mut stmt = c.prepare("PRAGMA table_info(note)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|x| x.ok())
            .collect();
        cols.iter().any(|n| n == "guardrails")
    };
    if !has_guardrails {
        c.execute_batch("ALTER TABLE note ADD COLUMN guardrails TEXT DEFAULT NULL;")
            .expect("add guardrails column");
    }

    c.execute_batch(&format!("PRAGMA user_version={SCHEMA_VERSION};"))
        .ok();
}

/// `PRAGMA data_version` — bumps when another connection commits. Used by the app's
/// polling loop for live refresh.
pub fn data_version(c: &Connection) -> i64 {
    c.query_row("PRAGMA data_version", [], |r| r.get(0))
        .expect("data_version")
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    /// v7→v8: repo_path is added to a pre-v8 project table and data survives.
    #[test]
    fn migrate_v7_to_v8_adds_repo_path() {
        let c = Connection::open_in_memory().expect("open");
        c.execute_batch(
            "CREATE TABLE space (id TEXT PRIMARY KEY, name TEXT NOT NULL,
               position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#7c8cff',
               source TEXT NOT NULL CHECK(source IN ('claude','you')),
               space_id TEXT REFERENCES space(id) ON DELETE SET NULL,
               position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE task (id TEXT PRIMARY KEY,
               project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
               parent_id TEXT REFERENCES task(id) ON DELETE CASCADE,
               title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
               status TEXT NOT NULL CHECK(status IN ('now','next','later','complete','dropped')),
               priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none','low','med','high')),
               kind TEXT NOT NULL DEFAULT 'none' CHECK(kind IN ('none','fix','feature','chore','rule','docs')),
               paths TEXT NOT NULL DEFAULT '[]', symbols TEXT NOT NULL DEFAULT '[]',
               source TEXT NOT NULL CHECK(source IN ('claude','you')),
               position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
               reopened_at TEXT,
               ref INTEGER NOT NULL DEFAULT 0,
               version TEXT NOT NULL DEFAULT '');
             CREATE TABLE note (project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
               body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
               recap TEXT NOT NULL DEFAULT '', recap_at TEXT);
             INSERT INTO space VALUES('space-current','Current projects',1,'2026-01-01','2026-01-01');
             INSERT INTO project VALUES('p','P','#7c8cff','you','space-current',1,'2026-01-01','2026-01-01');
             PRAGMA user_version=7;",
        )
        .expect("build v7 db");

        super::migrate(&c);

        let has_col: bool = {
            let mut stmt = c.prepare("PRAGMA table_info(project)").unwrap();
            let cols: Vec<String> = stmt
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .filter_map(|x| x.ok())
                .collect();
            cols.iter().any(|n| n == "repo_path")
        };
        assert!(has_col, "repo_path column missing after migrate");

        let (id, repo_path): (String, Option<String>) = c
            .query_row("SELECT id, repo_path FROM project WHERE id='p'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .expect("project survived");
        assert_eq!(id, "p");
        assert_eq!(repo_path, None);

        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, super::SCHEMA_VERSION);
    }
}
