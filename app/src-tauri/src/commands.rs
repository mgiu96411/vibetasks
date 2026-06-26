use rusqlite::{params, Connection, OptionalExtension, Row};
use std::sync::Mutex;
use tauri::State;

use crate::db;
use crate::models::{Note, Project, Snapshot, Space, Task, TaskLink, Todo};

/// Tauri-managed DB state: a single rusqlite connection behind a Mutex.
pub struct Db(pub Mutex<Connection>);

type CmdResult<T> = Result<T, String>;
const DEFAULT_SPACE_ID: &str = "space-current";

// ---- helpers ----------------------------------------------------------------

/// ISO-8601 UTC timestamp matching JS `new Date().toISOString()`
/// (e.g. `2026-05-29T12:34:56.789Z`). Computed by SQLite so we avoid a time crate.
fn now_iso(c: &Connection) -> String {
    c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| {
        r.get(0)
    })
    .unwrap_or_default()
}

/// `MAX(position)+1` for append-to-end semantics, mirroring repo.ts `nextPosition`.
fn next_position(c: &Connection, sql: &str, args: &[&dyn rusqlite::ToSql]) -> f64 {
    let m: Option<f64> = c
        .query_row(sql, args, |r| r.get::<_, Option<f64>>(0))
        .unwrap_or(None);
    m.unwrap_or(0.0) + 1.0
}

fn new_id() -> String {
    uuid_v4()
}

/// Minimal RFC-4122 v4 UUID generator (mirrors `crypto.randomUUID()` shape) without
/// adding a dependency. Uses SQLite's randomblob for entropy.
fn uuid_v4_from(bytes: [u8; 16]) -> String {
    let mut b = bytes;
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 1
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

fn uuid_v4() -> String {
    // Fallback entropy from system time if randomblob is unavailable at call site.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut seed = nanos as u64 ^ (std::process::id() as u64).wrapping_mul(0x9E3779B97F4A7C15);
    let mut bytes = [0u8; 16];
    for chunk in bytes.iter_mut() {
        // xorshift64
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        *chunk = (seed & 0xff) as u8;
    }
    uuid_v4_from(bytes)
}

fn parse_json_array(s: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(s).unwrap_or_default()
}

fn to_json_array(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string())
}

// ---- row mappers ------------------------------------------------------------

fn row_to_space(r: &Row) -> rusqlite::Result<Space> {
    Ok(Space {
        id: r.get("id")?,
        name: r.get("name")?,
        position: r.get("position")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn row_to_project(r: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get("id")?,
        name: r.get("name")?,
        color: r.get("color")?,
        source: r.get("source")?,
        space_id: r.get("space_id")?,
        repo_path: r.get("repo_path")?,
        position: r.get("position")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn row_to_task(r: &Row) -> rusqlite::Result<Task> {
    let paths: String = r.get("paths")?;
    let symbols: String = r.get("symbols")?;
    Ok(Task {
        id: r.get("id")?,
        project_id: r.get("project_id")?,
        parent_id: r.get("parent_id")?,
        title: r.get("title")?,
        summary: r.get("summary")?,
        description: r.get("description")?,
        status: r.get("status")?,
        priority: r.get("priority")?,
        kind: r.get("kind")?,
        version: r.get("version")?,
        paths: parse_json_array(&paths),
        symbols: parse_json_array(&symbols),
        source: r.get("source")?,
        position: r.get("position")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        reopened_at: r.get("reopened_at")?,
        reference: r.get("ref")?,
    })
}

fn row_to_todo(r: &Row) -> rusqlite::Result<Todo> {
    let done: i64 = r.get("done")?;
    Ok(Todo {
        id: r.get("id")?,
        project_id: r.get("project_id")?,
        text: r.get("text")?,
        done: done != 0,
        source: r.get("source")?,
        position: r.get("position")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

fn row_to_note(r: &Row) -> rusqlite::Result<Note> {
    Ok(Note {
        project_id: r.get("project_id")?,
        body: r.get("body")?,
        updated_at: r.get("updated_at")?,
        recap: r.get("recap")?,
        recap_at: r.get("recap_at")?,
        goals: r.get("goals")?,
    })
}

fn row_to_link(r: &Row) -> rusqlite::Result<TaskLink> {
    Ok(TaskLink {
        from_task_id: r.get("from_task_id")?,
        to_task_id: r.get("to_task_id")?,
        link_type: r.get("type")?,
    })
}

fn project_id_of_task(c: &Connection, id: &str) -> CmdResult<String> {
    c.query_row("SELECT project_id FROM task WHERE id=?", params![id], |r| {
        r.get(0)
    })
    .map_err(|e| e.to_string())
}

fn project_ids_by_name(c: &Connection, name: &str) -> CmdResult<Vec<String>> {
    let mut stmt = c
        .prepare("SELECT id FROM project WHERE name=? ORDER BY position LIMIT 2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![name], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

fn space_ids_by_name(c: &Connection, name: &str) -> CmdResult<Vec<String>> {
    let mut stmt = c
        .prepare("SELECT id FROM space WHERE name=? ORDER BY position LIMIT 2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![name], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

fn require_space(c: &Connection, id: &str) -> CmdResult<()> {
    let found = c
        .query_row("SELECT 1 FROM space WHERE id=?", params![id], |r| {
            r.get::<_, i64>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    if found.is_none() {
        return Err(format!("No space matching \"{id}\"."));
    }
    Ok(())
}

// ---- reads ------------------------------------------------------------------

#[tauri::command]
pub fn get_data_version(state: State<Db>) -> i64 {
    let c = state.0.lock().unwrap();
    db::data_version(&c)
}

#[tauri::command]
pub fn get_snapshot(state: State<Db>, project_id: String) -> CmdResult<Snapshot> {
    let c = state.0.lock().unwrap();

    let spaces = {
        let mut stmt = c
            .prepare("SELECT * FROM space ORDER BY position")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], row_to_space)
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let projects = {
        let mut stmt = c
            .prepare("SELECT * FROM project ORDER BY position")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], row_to_project)
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let tasks = {
        let mut stmt = c
            .prepare("SELECT * FROM task WHERE project_id=? ORDER BY status,position")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], row_to_task)
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let todos = {
        let mut stmt = c
            .prepare("SELECT * FROM todo WHERE project_id=? ORDER BY position")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], row_to_todo)
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    let note = c
        .query_row(
            "SELECT * FROM note WHERE project_id=?",
            params![project_id],
            row_to_note,
        )
        .optional()
        .map_err(|e| e.to_string())?;

    // Links among this project's tasks only.
    let links = {
        let mut stmt = c
            .prepare(
                "SELECT l.from_task_id, l.to_task_id, l.type FROM task_link l \
                 JOIN task tf ON tf.id = l.from_task_id \
                 JOIN task tt ON tt.id = l.to_task_id \
                 WHERE tf.project_id=? AND tt.project_id=?",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id, project_id], row_to_link)
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };

    Ok(Snapshot {
        spaces,
        projects,
        tasks,
        todos,
        note,
        links,
    })
}

// ---- spaces -----------------------------------------------------------------

#[tauri::command]
pub fn create_space(state: State<Db>, name: String) -> CmdResult<String> {
    let c = state.0.lock().unwrap();
    let existing = space_ids_by_name(&c, &name)?;
    if existing.len() > 1 {
        return Err(format!(
            "Multiple spaces named \"{name}\". Rename the duplicates first."
        ));
    }
    if let Some(id) = existing.first() {
        return Ok(id.clone());
    }
    let now = now_iso(&c);
    let id = new_id();
    let position = next_position(&c, "SELECT MAX(position) FROM space", &[]);
    c.execute(
        "INSERT INTO space(id,name,position,created_at,updated_at) VALUES(?,?,?,?,?)",
        params![id, name, position, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn rename_space(state: State<Db>, id: String, name: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    require_space(&c, &id)?;
    let existing = space_ids_by_name(&c, &name)?;
    if existing.iter().any(|existing_id| existing_id != &id) {
        return Err(format!("A space named \"{name}\" already exists."));
    }
    c.execute(
        "UPDATE space SET name=?,updated_at=? WHERE id=?",
        params![name, now_iso(&c), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_space(state: State<Db>, id: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    require_space(&c, &id)?;
    if id == DEFAULT_SPACE_ID {
        return Err("The default space cannot be deleted.".to_string());
    }
    let count: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM project WHERE space_id=?",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Err(format!(
            "This space contains {count} project(s). Move them before deleting it."
        ));
    }
    c.execute("DELETE FROM space WHERE id=?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reorder_spaces(state: State<Db>, ids: Vec<String>) -> CmdResult<()> {
    let mut c = state.0.lock().unwrap();
    let now = now_iso(&c);
    let tx = c.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE space SET position=?,updated_at=? WHERE id=?")
            .map_err(|e| e.to_string())?;
        for (idx, id) in ids.iter().enumerate() {
            stmt.execute(params![(idx as i64) + 1, now, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_project_to_space(
    state: State<Db>,
    project_id: String,
    space_id: String,
) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    require_space(&c, &space_id)?;
    let changed = c
        .execute(
            "UPDATE project SET space_id=?,updated_at=? WHERE id=?",
            params![space_id, now_iso(&c), project_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("No project matching \"{project_id}\"."));
    }
    Ok(())
}

// ---- projects ---------------------------------------------------------------

#[tauri::command]
pub fn create_project(
    state: State<Db>,
    name: String,
    space_id: Option<String>,
) -> CmdResult<String> {
    let c = state.0.lock().unwrap();
    let existing = project_ids_by_name(&c, &name)?;
    if existing.len() > 1 {
        return Err(format!(
            "Multiple projects named \"{name}\". Rename or merge the duplicates first."
        ));
    }
    if let Some(id) = existing.first() {
        return Ok(id.clone());
    }
    let space_id = space_id.unwrap_or_else(|| DEFAULT_SPACE_ID.to_string());
    require_space(&c, &space_id)?;
    let now = now_iso(&c);
    let id = new_id();
    let position = next_position(&c, "SELECT MAX(position) FROM project", &[]);
    c.execute(
        "INSERT INTO project(id,name,color,source,space_id,position,created_at,updated_at) \
         VALUES(?,?,?,?,?,?,?,?)",
        params![id, name, "#7c8cff", "you", space_id, position, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn rename_project(state: State<Db>, id: String, name: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    let existing = project_ids_by_name(&c, &name)?;
    if existing.iter().any(|existing_id| existing_id != &id) {
        return Err(format!(
            "A project named \"{name}\" already exists. Rename or merge it first."
        ));
    }
    let now = now_iso(&c);
    c.execute(
        "UPDATE project SET name=?,updated_at=? WHERE id=?",
        params![name, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_project(state: State<Db>, id: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    c.execute("DELETE FROM project WHERE id=?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- tasks ------------------------------------------------------------------

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn add_task(state: State<Db>, project_id: String, title: String) -> CmdResult<String> {
    let c = state.0.lock().unwrap();
    insert_task(&c, &project_id, None, &title)
}

#[tauri::command]
pub fn add_subtask(state: State<Db>, parent_id: String, title: String) -> CmdResult<String> {
    let c = state.0.lock().unwrap();
    let project_id = project_id_of_task(&c, &parent_id)?;
    insert_task(&c, &project_id, Some(&parent_id), &title)
}

/// Shared INSERT for tasks/subtasks; status defaults to 'todo', source='you'.
fn insert_task(
    c: &Connection,
    project_id: &str,
    parent_id: Option<&str>,
    title: &str,
) -> CmdResult<String> {
    let now = now_iso(c);
    let id = new_id();
    let status = "next";
    let position = next_position(
        c,
        "SELECT MAX(position) FROM task WHERE project_id=? AND status=?",
        &[&project_id, &status],
    );
    let next_ref: i64 = c
        .query_row(
            "SELECT COALESCE(MAX(ref),0)+1 FROM task WHERE project_id=?",
            params![project_id],
            |r| r.get(0),
        )
        .unwrap_or(1);
    c.execute(
        "INSERT INTO task(id,project_id,parent_id,title,summary,description,status,priority,kind,version,paths,symbols,source,position,created_at,updated_at,ref) \
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params![
            id,
            project_id,
            parent_id,
            title,
            "",
            "",
            status,
            "none",
            "none",
            "",
            "[]",
            "[]",
            "you",
            position,
            now,
            now,
            next_ref
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn update_task(
    state: State<Db>,
    id: String,
    title: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    priority: Option<String>,
    kind: Option<String>,
    version: Option<String>,
    status: Option<String>,
) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    // Merge with current row (mirrors repo.ts updateTask which keeps paths/symbols).
    let cur = c
        .query_row("SELECT * FROM task WHERE id=?", params![id], row_to_task)
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(cur) = cur else {
        return Ok(());
    };
    let now = now_iso(&c);
    let prev_status = cur.status.clone();
    let prev_reopened = cur.reopened_at.clone();
    let title = title.unwrap_or(cur.title);
    let summary = summary.unwrap_or(cur.summary);
    let description = description.unwrap_or(cur.description);
    let priority = priority.unwrap_or(cur.priority);
    let kind = kind.unwrap_or(cur.kind);
    let version = version.unwrap_or(cur.version);
    let status = status.unwrap_or(cur.status);
    // Mirror moveTask's reopen-from-complete marker when status changes via update.
    let reopened_at: Option<String> = if status == "complete" {
        None
    } else if prev_status == "complete" && status != "complete" {
        Some(now.clone())
    } else {
        prev_reopened
    };
    c.execute(
        "UPDATE task SET title=?,summary=?,description=?,priority=?,kind=?,version=?,status=?,paths=?,symbols=?,reopened_at=?,updated_at=? WHERE id=?",
        params![
            title,
            summary,
            description,
            priority,
            kind,
            version,
            status,
            to_json_array(&cur.paths),
            to_json_array(&cur.symbols),
            reopened_at,
            now,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Shared move logic (status transition + reopen marker + position append),
/// used by both the move_task command and start_task.
fn move_task_with(c: &Connection, id: &str, status: &str) -> CmdResult<()> {
    let now = now_iso(c);
    let prev: Option<(String, Option<String>)> = c
        .query_row(
            "SELECT status, reopened_at FROM task WHERE id=?",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((prev_status, prev_reopened)) = prev else {
        return Ok(());
    };
    let reopened_at: Option<String> = if status == "complete" {
        None
    } else if prev_status == "complete" {
        Some(now.clone())
    } else {
        prev_reopened
    };
    let position = next_position(
        c,
        "SELECT MAX(position) FROM task WHERE project_id=(SELECT project_id FROM task WHERE id=?) AND status=?",
        &[&id, &status],
    );
    c.execute(
        "UPDATE task SET status=?,position=?,reopened_at=?,updated_at=? WHERE id=?",
        params![status, position, reopened_at, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_task(state: State<Db>, id: String, status: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    move_task_with(&c, &id, &status)
}

#[tauri::command]
pub fn reorder_tasks(state: State<Db>, ids: Vec<String>) -> CmdResult<()> {
    let mut c = state.0.lock().unwrap();
    let now = now_iso(&c);
    let tx = c.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare("UPDATE task SET position=?,updated_at=? WHERE id=?")
            .map_err(|e| e.to_string())?;
        for (idx, id) in ids.iter().enumerate() {
            stmt.execute(params![(idx as i64) + 1, now, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_task(state: State<Db>, id: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    c.execute("DELETE FROM task WHERE id=?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_refs(
    state: State<Db>,
    id: String,
    paths: Option<Vec<String>>,
    symbols: Option<Vec<String>>,
) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    let cur = c
        .query_row("SELECT * FROM task WHERE id=?", params![id], row_to_task)
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(cur) = cur else {
        return Ok(());
    };
    let now = now_iso(&c);
    let paths = paths.unwrap_or(cur.paths);
    let symbols = symbols.unwrap_or(cur.symbols);
    c.execute(
        "UPDATE task SET paths=?,symbols=?,updated_at=? WHERE id=?",
        params![to_json_array(&paths), to_json_array(&symbols), now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- links ------------------------------------------------------------------

#[tauri::command]
pub fn link_tasks(
    state: State<Db>,
    from: String,
    to: String,
    #[allow(non_snake_case)] r#type: String,
) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    c.execute(
        "INSERT OR IGNORE INTO task_link(from_task_id,to_task_id,type) VALUES(?,?,?)",
        params![from, to, r#type],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn unlink_tasks(
    state: State<Db>,
    from: String,
    to: String,
    #[allow(non_snake_case)] r#type: String,
) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    c.execute(
        "DELETE FROM task_link WHERE from_task_id=? AND to_task_id=? AND type=?",
        params![from, to, r#type],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- todos ------------------------------------------------------------------

#[tauri::command]
pub fn add_todo(state: State<Db>, project_id: String, text: String) -> CmdResult<String> {
    let c = state.0.lock().unwrap();
    let now = now_iso(&c);
    let id = new_id();
    let position = next_position(
        &c,
        "SELECT MAX(position) FROM todo WHERE project_id=?",
        &[&project_id],
    );
    c.execute(
        "INSERT INTO todo(id,project_id,text,done,source,position,created_at,updated_at) \
         VALUES(?,?,?,0,?,?,?,?)",
        params![id, project_id, text, "you", position, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub fn toggle_todo(state: State<Db>, id: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    let now = now_iso(&c);
    c.execute(
        "UPDATE todo SET done=1-done,updated_at=? WHERE id=?",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_todo(state: State<Db>, id: String, text: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    let now = now_iso(&c);
    c.execute(
        "UPDATE todo SET text=?,updated_at=? WHERE id=?",
        params![text, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_todo(state: State<Db>, id: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    c.execute("DELETE FROM todo WHERE id=?", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- repo path --------------------------------------------------------------

/// Expand a leading `~` to the home directory and trim whitespace/trailing
/// slashes. Returns None for an empty input (meaning: clear the column).
fn normalize_repo_path(input: &str) -> Option<String> {
    let stripped = input
        .trim()
        .trim_matches('\'')
        .trim_matches('"')
        .trim()
        .trim_end_matches('/');
    if stripped.is_empty() {
        return None;
    }
    let expanded = if stripped == "~" {
        dirs::home_dir().map(|h| h.to_string_lossy().into_owned())?
    } else if let Some(rest) = stripped.strip_prefix("~/") {
        dirs::home_dir().map(|h| h.join(rest).to_string_lossy().into_owned())?
    } else {
        stripped.to_string()
    };
    Some(expanded)
}

#[tauri::command]
pub fn set_project_repo_path(state: State<Db>, id: String, repo_path: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    let normalized = normalize_repo_path(&repo_path);
    if let Some(ref p) = normalized {
        match std::fs::metadata(p) {
            Ok(m) if !m.is_dir() => return Err(format!("Path exists but is not a directory: {p}")),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(format!("Directory not found: {p}"))
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(format!("Permission denied: {p} — grant Files and Folders access in System Settings > Privacy & Security"))
            }
            Err(e) => return Err(format!("Cannot access path: {p} ({e})")),
        }
    }
    let changed = c
        .execute(
            "UPDATE project SET repo_path=?,updated_at=? WHERE id=?",
            params![normalized, now_iso(&c), id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("No project matching \"{id}\"."));
    }
    Ok(())
}

// ---- start task -------------------------------------------------------------

/// POSIX single-quote wrapper: replaces `'` with `'\''` so the result can be
/// embedded in a `'…'` shell word without injection risk.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Generic open(1) fallback for terminals other than Ghostty. Wraps an
/// already-built inner command (e.g. `exec '<claude>' '<prompt>'`) in
/// `/bin/zsh --login -c` so .zprofile/.zlogin load nvm/homebrew and put node
/// on PATH for MCP hooks, after setting the tab title.
fn open_fallback_args(
    terminal_app: &str,
    repo_path: &str,
    inner_cmd: &str,
    tab_title: &str,
) -> (String, Vec<String>) {
    let title_esc = tab_title.replace('\'', "'\\''");
    let shell_cmd = format!("printf '\\033]0;{title_esc}\\007'; {inner_cmd}");
    (
        "open".to_string(),
        vec![
            "-na".to_string(),
            terminal_app.to_string(),
            "--args".to_string(),
            format!("--working-directory={repo_path}"),
            "-e".to_string(),
            "/bin/zsh".to_string(),
            "--login".to_string(),
            "-c".to_string(),
            shell_cmd,
        ],
    )
}

/// Self-deleting launcher script written to /tmp and run by the terminal.
/// `#!/bin/zsh --login` puts nvm/homebrew/MCP-hook paths on PATH. When `cwd`
/// is set the script cd's into it first — Terminal.app and iTerm2 don't
/// reliably apply a working directory to an AppleScript-typed command, while
/// Ghostty sets it via AppleScript and passes `None`. The OSC escape titles the
/// tab/window.
fn launcher_script(shell_cmd: &str, tab_title: &str, cwd: Option<&str>) -> String {
    let title_esc = tab_title.replace('\'', "'\\''");
    let cd_line = match cwd {
        Some(dir) => format!("cd {} || exit 1\n", shell_quote(dir)),
        None => String::new(),
    };
    format!(
        "#!/bin/zsh --login\nrm -f \"$0\"\n{cd_line}printf '\\033]0;{title_esc}\\007'\n{shell_cmd}\n"
    )
}

/// Writes the launcher script to /tmp/vibetasks_launch_<id>.sh (0755) and
/// returns its path. `script_id` makes the filename unique (task ref for Start,
/// project id for Open Claude).
fn write_launcher(script_id: &str, script: &str) -> Result<String, String> {
    use std::os::unix::fs::PermissionsExt;
    let script_path = format!("/tmp/vibetasks_launch_{script_id}.sh");
    std::fs::write(&script_path, script)
        .map_err(|e| format!("Failed to write launcher script: {e}"))?;
    std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("Failed to chmod launcher script: {e}"))?;
    Ok(script_path)
}

/// Escapes a string for embedding inside an AppleScript "…" literal.
fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// AppleScript that opens a new tab in the front Ghostty window (or a new
/// window if Ghostty has none), running the launcher at `script_path`.
fn ghostty_applescript(repo_path: &str, script_path: &str) -> String {
    let repo_esc = applescript_escape(repo_path);
    let script_esc = applescript_escape(script_path);
    format!(
        r#"tell application "Ghostty"
    set cfg to new surface configuration
    set initial working directory of cfg to "{repo_esc}"
    set command of cfg to "{script_esc}"
    if (count windows) > 0 then
        new tab in front window with configuration cfg
    else
        new window with configuration cfg
    end if
end tell"#
    )
}

/// AppleScript that opens a Terminal.app window running the launcher at
/// `script_path` and titles it. Terminal.app's AppleScript can't reuse tabs the
/// way Ghostty/iTerm2 can, so each launch is a new window.
fn terminal_app_applescript(script_path: &str, tab_title: &str) -> String {
    let script_esc = applescript_escape(script_path);
    let title_esc = applescript_escape(tab_title);
    format!(
        r#"tell application "Terminal"
    activate
    do script "{script_esc}"
    set custom title of front window to "{title_esc}"
end tell"#
    )
}

/// AppleScript that opens a new tab in the current iTerm2 window (or a new
/// window if iTerm2 has none), running the launcher at `script_path`.
fn iterm_applescript(script_path: &str) -> String {
    let script_esc = applescript_escape(script_path);
    format!(
        r#"tell application "iTerm"
    activate
    if (count of windows) = 0 then
        create window with default profile
    else
        tell current window to create tab with default profile
    end if
    tell current session of current window to write text "{script_esc}"
end tell"#
    )
}

/// Resolves `(program, argv)` for running `inner_cmd` in the chosen terminal.
/// Ghostty/Terminal/iTerm each get a self-deleting /tmp launcher script driven
/// by AppleScript; any other value is treated as a Custom app via the generic
/// open(1) fallback. `inner_cmd` is the already-built `exec '<claude>' …`.
fn resolve_launch_args(
    terminal_app: &str,
    repo_path: &str,
    inner_cmd: &str,
    script_id: &str,
    tab_title: &str,
) -> Result<(String, Vec<String>), String> {
    let osascript =
        |applescript: String| ("osascript".to_string(), vec!["-e".to_string(), applescript]);
    match terminal_app {
        // Ghostty sets the working directory via AppleScript, so its script
        // doesn't cd itself.
        "Ghostty" => {
            let path = write_launcher(script_id, &launcher_script(inner_cmd, tab_title, None))?;
            Ok(osascript(ghostty_applescript(repo_path, &path)))
        }
        "Terminal" => {
            let path =
                write_launcher(script_id, &launcher_script(inner_cmd, tab_title, Some(repo_path)))?;
            Ok(osascript(terminal_app_applescript(&path, tab_title)))
        }
        "iTerm" => {
            let path =
                write_launcher(script_id, &launcher_script(inner_cmd, tab_title, Some(repo_path)))?;
            Ok(osascript(iterm_applescript(&path)))
        }
        other => Ok(open_fallback_args(other, repo_path, inner_cmd, tab_title)),
    }
}

/// In-memory double-launch guard: refuses a second Start for the same task
/// id inside the window. Process-lifetime state; nothing persisted.
pub struct LaunchGuard {
    window: std::time::Duration,
    recent: Mutex<std::collections::HashMap<String, std::time::Instant>>,
}

impl LaunchGuard {
    pub fn new(window: std::time::Duration) -> Self {
        Self { window, recent: Mutex::new(std::collections::HashMap::new()) }
    }
    pub fn try_begin(&self, id: &str) -> bool {
        let mut recent = self.recent.lock().unwrap();
        let now = std::time::Instant::now();
        recent.retain(|_, t| now.duration_since(*t) < self.window);
        if recent.contains_key(id) {
            return false;
        }
        recent.insert(id.to_string(), now);
        true
    }
}

fn launch_guard() -> &'static LaunchGuard {
    use std::sync::OnceLock;
    static GUARD: OnceLock<LaunchGuard> = OnceLock::new();
    GUARD.get_or_init(|| LaunchGuard::new(std::time::Duration::from_secs(120)))
}

fn is_executable_file(p: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

/// Detects a committed plan file among a task's `paths`: the first entry that
/// ends in `.md` and lives under a `plans/` path segment (case-insensitive).
/// Tool-agnostic by design — matches superpowers (`docs/superpowers/plans/…`),
/// PRP, or any `…/plans/*.md` convention without hard-wiring a tool name.
fn plan_path_in(paths: &[String]) -> Option<&str> {
    paths.iter().map(String::as_str).find(|p| {
        p.to_ascii_lowercase().ends_with(".md")
            && p.split('/').any(|seg| seg.eq_ignore_ascii_case("plans"))
    })
}

/// Builds the launch prompt for a Start session. The base is intentionally
/// minimal — it triggers `get_board`, which loads the full card. When the card's
/// `paths` carry a committed plan, a tool-agnostic execute-pointer is appended so
/// the session runs the existing plan instead of re-deriving one. Deliberately
/// does NOT name a specific skill (e.g. executing-plans), which may be absent on
/// the user's machine.
fn build_start_prompt(task_ref: i64, project_name: &str, paths: &[String]) -> String {
    let base = format!("work task #{task_ref} on the '{project_name}' Vibe Tasks board");
    match plan_path_in(paths) {
        Some(plan) => format!(
            "{base}. A committed plan for this task exists at {plan} — read and execute it (use your plan-execution workflow if you have one); do NOT re-plan."
        ),
        None => base,
    }
}

#[tauri::command]
pub fn start_task(
    state: State<Db>,
    id: String,
    terminal_app: String,
    claude_bin: String,
) -> CmdResult<String> {
    let (task_ref, project_name, repo_path, paths_json): (i64, String, Option<String>, String) = {
        let c = state.0.lock().unwrap();
        c.query_row(
            "SELECT t.ref, p.name, p.repo_path, t.paths FROM task t JOIN project p ON p.id = t.project_id WHERE t.id=?",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("No task matching \"{id}\"."))?
    };
    let paths = parse_json_array(&paths_json);
    let Some(repo_path) = repo_path.filter(|p| !p.is_empty()) else {
        return Err("Set the repo path in the sidebar first.".to_string());
    };
    if !std::path::Path::new(&repo_path).is_dir() {
        return Err(format!("Repo path no longer exists: {repo_path}"));
    }
    let claude = normalize_repo_path(&claude_bin)
        .ok_or_else(|| "Claude binary path is empty.".to_string())?;
    if !is_executable_file(std::path::Path::new(&claude)) {
        return Err(format!("Claude binary not found or not executable: {claude}"));
    }
    if !launch_guard().try_begin(&id) {
        return Err("Already started — check your terminal.".to_string());
    }

    let prompt = build_start_prompt(task_ref, &project_name, &paths);
    let shell_cmd = format!("exec {} {}", shell_quote(&claude), shell_quote(&prompt));
    let tab_title = format!("{project_name} #{task_ref}");
    let (program, args) = resolve_launch_args(
        &terminal_app,
        &repo_path,
        &shell_cmd,
        &task_ref.to_string(),
        &tab_title,
    )?;
    std::process::Command::new(&program)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to launch {terminal_app}: {e}"))?;

    {
        let c = state.0.lock().unwrap();
        move_task_with(&c, &id, "now")?;
    }
    Ok(format!("Launch requested — task #{task_ref} in {terminal_app}"))
}

/// Open a bare Claude session in a project's repo path — the same terminal
/// launch as `start_task` but with no task, no prompt, and no board change.
/// `id` is the project id.
#[tauri::command]
pub fn open_claude(
    state: State<Db>,
    id: String,
    terminal_app: String,
    claude_bin: String,
) -> CmdResult<String> {
    let (project_name, repo_path): (String, Option<String>) = {
        let c = state.0.lock().unwrap();
        c.query_row(
            "SELECT name, repo_path FROM project WHERE id=?",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("No project matching \"{id}\"."))?
    };
    let Some(repo_path) = repo_path.filter(|p| !p.is_empty()) else {
        return Err("Set the repo path first.".to_string());
    };
    if !std::path::Path::new(&repo_path).is_dir() {
        return Err(format!("Repo path no longer exists: {repo_path}"));
    }
    let claude = normalize_repo_path(&claude_bin)
        .ok_or_else(|| "Claude binary path is empty.".to_string())?;
    if !is_executable_file(std::path::Path::new(&claude)) {
        return Err(format!("Claude binary not found or not executable: {claude}"));
    }
    // Reuse the launch guard, keyed so it can't collide with a task Start.
    if !launch_guard().try_begin(&format!("open_claude:{id}")) {
        return Err("Already opening — check your terminal.".to_string());
    }

    let inner_cmd = format!("exec {}", shell_quote(&claude));
    let tab_title = project_name;
    let script_id = format!("claude_{id}");
    let (program, args) =
        resolve_launch_args(&terminal_app, &repo_path, &inner_cmd, &script_id, &tab_title)?;
    std::process::Command::new(&program)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to launch {terminal_app}: {e}"))?;

    Ok(format!("Opened Claude in {terminal_app}"))
}

// ---- terminal detection -----------------------------------------------------

/// `.app` bundle names (without the `.app` suffix) for each first-class
/// terminal id used by `resolve_launch_args`. The id is what the UI persists +
/// passes to start_task/open_claude; the bundle name is what we look for on disk.
fn terminal_bundle_name(id: &str) -> Option<&'static str> {
    match id {
        "Ghostty" => Some("Ghostty"),
        "Terminal" => Some("Terminal"),
        "iTerm" => Some("iTerm"),
        _ => None,
    }
}

/// True if an `.app` bundle named `<bundle>.app` exists in any standard macOS
/// app location. Terminal.app ships under /System/Applications/Utilities, the
/// others install into /Applications or ~/Applications.
fn terminal_is_installed(bundle: &str) -> bool {
    let mut dirs: Vec<std::path::PathBuf> = vec![
        std::path::PathBuf::from("/Applications"),
        std::path::PathBuf::from("/Applications/Utilities"),
        std::path::PathBuf::from("/System/Applications"),
        std::path::PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join("Applications"));
    }
    let app = format!("{bundle}.app");
    dirs.iter().any(|d| d.join(&app).is_dir())
}

/// Probes which first-class terminals (Ghostty / Terminal / iTerm) are actually
/// installed, so the UI can gray out the missing ones. Returns the subset of the
/// passed `ids` that resolve to an installed `.app`. Custom terminals (not in
/// the first-class list) are not probed — the UI treats those separately.
#[tauri::command]
pub fn detect_terminals(ids: Vec<String>) -> Vec<String> {
    ids.into_iter()
        .filter(|id| {
            terminal_bundle_name(id)
                .map(terminal_is_installed)
                .unwrap_or(false)
        })
        .collect()
}

// ---- notes / goal -----------------------------------------------------------

#[tauri::command]
pub fn set_goal(state: State<Db>, project_id: String, goals_json: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    let now = now_iso(&c);
    c.execute(
        "INSERT INTO note(project_id,body,updated_at,goals) VALUES(?,?,?,?) \
         ON CONFLICT(project_id) DO UPDATE SET goals=excluded.goals, updated_at=excluded.updated_at",
        params![project_id, "", now, goals_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_notes(state: State<Db>, project_id: String, body: String) -> CmdResult<()> {
    let c = state.0.lock().unwrap();
    let now = now_iso(&c);
    c.execute(
        "INSERT INTO note(project_id,body,updated_at) VALUES(?,?,?) \
         ON CONFLICT(project_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at",
        params![project_id, body, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_start_prompt, iterm_applescript, launcher_script, normalize_repo_path,
        open_fallback_args, plan_path_in, shell_quote, terminal_app_applescript,
        terminal_bundle_name, LaunchGuard,
    };
    use std::time::Duration;

    #[test]
    fn terminal_bundle_name_maps_first_class_ids_only() {
        assert_eq!(terminal_bundle_name("Ghostty"), Some("Ghostty"));
        assert_eq!(terminal_bundle_name("Terminal"), Some("Terminal"));
        assert_eq!(terminal_bundle_name("iTerm"), Some("iTerm"));
        // Custom / unknown ids aren't probed.
        assert_eq!(terminal_bundle_name("WezTerm"), None);
        assert_eq!(terminal_bundle_name(""), None);
    }

    #[test]
    fn plan_path_in_matches_only_md_under_a_plans_segment() {
        // superpowers / PRP / any `…/plans/*.md` convention — tool-agnostic.
        let paths = vec![
            "scripts/build_kits.py".to_string(),
            "docs/superpowers/plans/2026-06-26-self-hosted-item-generator.md".to_string(),
        ];
        assert_eq!(
            plan_path_in(&paths),
            Some("docs/superpowers/plans/2026-06-26-self-hosted-item-generator.md")
        );
        // Case-insensitive on both extension and segment.
        assert_eq!(
            plan_path_in(&["Docs/Plans/Design.MD".to_string()]),
            Some("Docs/Plans/Design.MD")
        );
        // No `plans` segment, or non-md, or a lookalike segment → no match.
        assert_eq!(plan_path_in(&["docs/plan.md".to_string()]), None);
        assert_eq!(plan_path_in(&["docs/plans/notes.txt".to_string()]), None);
        assert_eq!(plan_path_in(&["src/myplans/x.md".to_string()]), None);
        assert_eq!(plan_path_in(&[]), None);
    }

    #[test]
    fn build_start_prompt_is_bare_without_a_plan() {
        // Unchanged behavior when no plan is linked — base prompt only.
        assert_eq!(
            build_start_prompt(305, "Task Manager", &["src/lib.rs".to_string()]),
            "work task #305 on the 'Task Manager' Vibe Tasks board"
        );
        assert_eq!(
            build_start_prompt(1, "X", &[]),
            "work task #1 on the 'X' Vibe Tasks board"
        );
    }

    #[test]
    fn build_start_prompt_appends_execute_pointer_when_plan_linked() {
        let paths = vec!["docs/superpowers/plans/2026-06-26-foo.md".to_string()];
        let p = build_start_prompt(106, "Rift Engine", &paths);
        assert!(p.starts_with("work task #106 on the 'Rift Engine' Vibe Tasks board"));
        assert!(p.contains("docs/superpowers/plans/2026-06-26-foo.md"));
        assert!(p.contains("do NOT re-plan"));
        // Tool-agnostic: must not hard-name a skill that may be absent.
        assert!(!p.contains("executing-plans"));
    }

    #[test]
    fn normalize_expands_tilde_and_strips_trailing_slash() {
        let home = dirs::home_dir().unwrap().to_string_lossy().into_owned();
        assert_eq!(normalize_repo_path("~/x/"), Some(format!("{home}/x")));
        assert_eq!(normalize_repo_path("  /tmp/repo/  "), Some("/tmp/repo".into()));
        assert_eq!(normalize_repo_path(""), None);
        assert_eq!(normalize_repo_path("   "), None);
    }

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("hello world"), "'hello world'");
        assert_eq!(shell_quote("/usr/bin/claude"), "'/usr/bin/claude'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(
            shell_quote("work task #305 on the 'Task Manager' Vibe Tasks board"),
            "'work task #305 on the '\\''Task Manager'\\'' Vibe Tasks board'"
        );
    }

    #[test]
    fn open_fallback_uses_login_shell_wrapper_for_custom_apps() {
        let inner = "exec '/usr/local/bin/claude' 'work task #305 on the '\\''Task Manager'\\'' Vibe Tasks board'";
        let (program, args) =
            open_fallback_args("WezTerm", "/tmp/my repo", inner, "Task Manager #305");
        assert_eq!(program, "open");
        assert_eq!(
            args,
            vec![
                "-na".to_string(),
                "WezTerm".to_string(),
                "--args".to_string(),
                "--working-directory=/tmp/my repo".to_string(),
                "-e".to_string(),
                "/bin/zsh".to_string(),
                "--login".to_string(),
                "-c".to_string(),
                format!("printf '\\033]0;Task Manager #305\\007'; {inner}"),
            ]
        );
    }

    #[test]
    fn launcher_script_has_login_shebang_and_self_deletes() {
        let script = launcher_script(
            "exec '/usr/bin/claude' 'work task #1 on the Task Manager Vibe Tasks board'",
            "Task Manager #1",
            None,
        );
        assert!(script.starts_with("#!/bin/zsh --login\n"));
        assert!(script.contains("rm -f \"$0\""));
        assert!(script.contains("printf '\\033]0;Task Manager #1\\007'"));
        assert!(script.contains("exec '/usr/bin/claude'"));
        // No cwd → no cd line.
        assert!(!script.contains("cd '"));
    }

    #[test]
    fn launcher_script_cds_into_repo_when_cwd_set() {
        let script = launcher_script("exec '/usr/bin/claude'", "T #1", Some("/tmp/my repo"));
        assert!(script.contains("cd '/tmp/my repo' || exit 1"));
    }

    #[test]
    fn terminal_app_applescript_runs_launcher_and_sets_title() {
        let script = terminal_app_applescript("/tmp/vibetasks_launch_1.sh", "Task Manager #1");
        assert!(script.contains("tell application \"Terminal\""));
        assert!(script.contains("do script \"/tmp/vibetasks_launch_1.sh\""));
        assert!(script.contains("set custom title of front window to \"Task Manager #1\""));
    }

    #[test]
    fn iterm_applescript_writes_launcher_into_a_tab() {
        let script = iterm_applescript("/tmp/vibetasks_launch_1.sh");
        assert!(script.contains("tell application \"iTerm\""));
        assert!(script.contains("create tab with default profile"));
        assert!(script.contains("write text \"/tmp/vibetasks_launch_1.sh\""));
    }

    #[test]
    fn iterm_applescript_escapes_double_quotes_in_path() {
        let script = iterm_applescript("/tmp/weird\"path.sh");
        assert!(script.contains("\"/tmp/weird\\\"path.sh\""));
    }

    #[test]
    fn ghostty_applescript_opens_new_tab_in_front_window() {
        let script = super::ghostty_applescript("/tmp/my repo", "/tmp/vibetasks_launch_1.sh");
        assert!(script.contains("new tab in front window with configuration cfg"));
        assert!(script.contains("\"/tmp/my repo\""));
        assert!(script.contains("\"/tmp/vibetasks_launch_1.sh\""));
    }

    #[test]
    fn ghostty_applescript_falls_back_to_new_window_when_no_windows() {
        let script = super::ghostty_applescript("/tmp/repo", "/tmp/launch.sh");
        assert!(script.contains("new window with configuration cfg"));
    }

    #[test]
    fn ghostty_applescript_escapes_double_quotes_in_paths() {
        let script = super::ghostty_applescript("/tmp/weird\"path", "/tmp/launch.sh");
        assert!(script.contains("\"/tmp/weird\\\"path\""));
    }

    #[test]
    fn launch_guard_blocks_within_window_allows_after() {
        let guard = LaunchGuard::new(Duration::from_millis(50));
        assert!(guard.try_begin("t1"));
        assert!(!guard.try_begin("t1"));
        assert!(guard.try_begin("t2"));
        std::thread::sleep(Duration::from_millis(60));
        assert!(guard.try_begin("t1"));
    }
}
