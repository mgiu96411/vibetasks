PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS space (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#7c8cff',
  source TEXT NOT NULL CHECK(source IN ('claude','you')),
  space_id TEXT REFERENCES space(id) ON DELETE SET NULL,
  repo_path TEXT,
  position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task (
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
  reopened_at TEXT,
  ref INTEGER NOT NULL DEFAULT 0,
  version TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS task_link (
  from_task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  to_task_id   TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('depends_on','related')),
  PRIMARY KEY(from_task_id, to_task_id, type)
);
CREATE TABLE IF NOT EXISTS todo (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK(source IN ('claude','you')),
  position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS note (
  project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
  recap TEXT NOT NULL DEFAULT '', recap_at TEXT,
  goals TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_project ON task(project_id, status, position);
CREATE INDEX IF NOT EXISTS idx_todo_project ON todo(project_id, position);
