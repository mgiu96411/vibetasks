// Seeds a demo project into ~/.vibetasks/vibetasks.db so the desktop app has
// something to show. Idempotent: only adds tasks if the demo project is empty.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb } from '../mcp/dist/db.js';
import * as r from '../mcp/dist/repo.js';

const dir = join(homedir(), '.vibetasks');
mkdirSync(dir, { recursive: true });
const db = openDb(process.env.VIBETASKS_DB ?? join(dir, 'vibetasks.db'));

const proj = r.ensureProject(db, 'Vibe Tasks Demo', 'claude');

if (r.getBoard(db, proj.id).cards.length === 0) {
  const t = (o) => r.addTask(db, { project_id: proj.id, source: 'claude', ...o });

  t({ title: 'Pick stack: Tauri + React', status: 'complete', priority: 'med' });
  t({ title: 'Lock layout: Command Center', status: 'complete', priority: 'low' });
  const mcp = t({ title: 'Build MCP server (tests green)', status: 'complete', priority: 'high' });

  const live = t({
    title: 'Wire live refresh via data_version',
    status: 'now', priority: 'high',
    summary: 'App polls PRAGMA data_version every 600ms and reloads on change',
    description: 'The desktop app polls PRAGMA data_version; when Claude writes through the MCP, the value bumps and the board/graph/todos/notes reload automatically. This is what makes Claude’s edits appear without a refresh.',
    paths: ['app/src/store.ts', 'app/src-tauri/src/db.rs'], symbols: ['startPolling', 'data_version'],
  });

  const graph = t({ title: 'Polish graph view', status: 'next', priority: 'med', paths: ['app/src/components/GraphView.tsx'] });
  const palette = t({ title: 'Add command palette actions', status: 'later', priority: 'low' });
  t({ title: 'Write README install steps', status: 'next', priority: 'low' });
  // a manually-authored task to show coexistence (no claude marker)
  r.addTask(db, { project_id: proj.id, source: 'you', title: 'Buy a domain for the landing page', status: 'later', priority: 'none' });
  // a task we decided NOT to do — lands in Dropped
  t({ title: 'Multi-user cloud sync', status: 'dropped', priority: 'none', summary: 'Out of scope for v1 (YAGNI).' });

  // subtasks under "Polish graph view"
  r.addTask(db, { project_id: proj.id, parent_id: graph.id, source: 'claude', title: 'dagre layered layout', status: 'next' });
  r.addTask(db, { project_id: proj.id, parent_id: graph.id, source: 'claude', title: 'edge styles (depends/related)', status: 'next' });

  // links
  r.linkTasks(db, live.id, mcp.id, 'depends_on');
  r.linkTasks(db, graph.id, palette.id, 'related');

  // todos
  r.addTodo(db, { project_id: proj.id, source: 'claude', text: 'Try dragging a card between columns' });
  r.addTodo(db, { project_id: proj.id, source: 'claude', text: 'Press ⌘K to open the command palette' });
  r.addTodo(db, { project_id: proj.id, source: 'you', text: 'Delete this demo project when done' });

  // notes
  r.setNotes(db, proj.id, 'Demo project seeded by Claude.\nColumns: Now / Next / Later / Complete / Dropped.\nData lives in ~/.vibetasks/vibetasks.db (SQLite, WAL).\nClaude edits via the MCP server; the app live-refreshes via data_version polling.');

  console.log('Seeded demo project with', r.getBoard(db, proj.id).cards.length, 'top-level cards.');
} else {
  console.log('Demo project already has tasks; left unchanged.');
}
