use serde::{Deserialize, Serialize};

/// Mirrors `shared/src/types.ts`. `source` is `'claude' | 'you'`, `status` is
/// `'now' | 'next' | 'later' | 'complete' | 'dropped'`, `priority` is `'none' | 'low' | 'med' | 'high'`,
/// link `type` is `'depends_on' | 'related'`. We keep them as plain `String`s to mirror
/// the loose TS unions and the DB's CHECK-constrained text columns.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Space {
    pub id: String,
    pub name: String,
    pub position: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub source: String,
    pub space_id: Option<String>,
    /// Where the Start button launches Claude; None until the human sets it.
    pub repo_path: Option<String>,
    pub position: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub summary: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    /// Item type/kind: 'none' | 'fix' | 'feature' | 'chore' | 'rule' | 'docs'.
    pub kind: String,
    /// Freeform release/epoch label (e.g. "v0.4.0"); '' = unversioned.
    pub version: String,
    /// Stored as JSON text in SQLite; parsed to a string array here.
    pub paths: Vec<String>,
    /// Stored as JSON text in SQLite; parsed to a string array here.
    pub symbols: Vec<String>,
    pub source: String,
    pub position: f64,
    pub created_at: String,
    pub updated_at: String,
    /// Set when a task is moved out of 'complete' (reopened); null otherwise.
    pub reopened_at: Option<String>,
    /// Short, stable, human-referenceable number (serialized as "ref").
    #[serde(rename = "ref")]
    pub reference: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Todo {
    pub id: String,
    pub project_id: String,
    pub text: String,
    pub done: bool,
    pub source: String,
    pub position: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub project_id: String,
    pub body: String,
    pub updated_at: String,
    /// Walk-away "last session" recap (Claude-written at wrap-up; read-only in the app).
    pub recap: String,
    pub recap_at: Option<String>,
    /// JSON-encoded Goal {goal, subgoals, following_goal}. None = no goal set.
    pub goals: Option<String>,
    /// JSON-encoded array of short inviolable project rules. None = none set.
    pub guardrails: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskLink {
    pub from_task_id: String,
    pub to_task_id: String,
    #[serde(rename = "type")]
    pub link_type: String,
}

/// Full snapshot the desktop app renders for a single project (plus the project rail).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub spaces: Vec<Space>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub todos: Vec<Todo>,
    pub note: Option<Note>,
    pub links: Vec<TaskLink>,
}
