#!/usr/bin/env node
// Phone snapshot exporter (council 2026-06-02, path D — "snapshot first").
//
// Reads the Vibe Tasks SQLite READ-ONLY (its own readonly connection — it is
// NOT a writer; it never migrates, never holds the WAL write lock) and emits a
// fully self-contained, offline `board.html` + machine-readable `board.json`
// into an iCloud folder so the phone sees the board (last-synced state, works
// even with the Mac asleep). Read-only by design — writes stay Claude-on-Mac.
//
// Run: `npm run snapshot` (compiled) or `tsx src/snapshot.ts` (dev).
// Env:
//   VIBETASKS_DB           override DB path (default ~/.vibetasks/vibetasks.db)
//   VIBETASKS_SNAPSHOT_DIR override output dir (default iCloud Drive/VibeTasks)
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const dbPath = process.env.VIBETASKS_DB ?? join(homedir(), '.vibetasks', 'vibetasks.db');
const outDir = process.env.VIBETASKS_SNAPSHOT_DIR ??
  join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'VibeTasks');

const COLUMNS: [string, string][] = [
  ['now', 'Now'], ['next', 'Next'], ['later', 'Later'],
  ['complete', 'Complete'], ['dropped', 'Dropped'],
];

interface Row { [k: string]: any }

function readBoard() {
  // readonly + fileMustExist: a pure reader. No openDb(), so no migration/WAL writes.
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const hasSpaces = !!db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='space'",
    ).get();
    const spaces = hasSpaces
      ? db.prepare('SELECT * FROM space ORDER BY position').all() as Row[]
      : [{ id: 'space-current', name: 'Current projects', position: 1 }];
    const projects = db.prepare('SELECT * FROM project ORDER BY position').all() as Row[];
    const out = projects.map((p) => {
      const tasks = db.prepare(
        'SELECT * FROM task WHERE project_id=? ORDER BY status,position').all(p.id) as Row[];
      const note = db.prepare('SELECT recap,recap_at,body FROM note WHERE project_id=?').get(p.id) as Row | undefined;
      return {
        id: p.id, name: p.name, color: p.color, space_id: p.space_id ?? 'space-current',
        recap: note?.recap ?? '', recap_at: note?.recap_at ?? null,
        counts: COLUMNS.reduce<Record<string, number>>((a, [s]) => {
          a[s] = tasks.filter((t) => t.status === s).length; return a; }, {}),
        tasks: tasks.map((t) => ({
          id: t.id, ref: t.ref, title: t.title, status: t.status,
          priority: t.priority, kind: t.kind, version: t.version,
          source: t.source, parent_id: t.parent_id ?? null,
          reopened: !!t.reopened_at,
          brief: t.summary ?? '',
          summary: t.summary ?? '', // legacy key for existing board.json readers
          has_details: String(t.description ?? '').trim().length > 0,
        })),
      };
    });
    return {
      generated_at: new Date().toISOString(),
      spaces: spaces.map((space) => ({ id: space.id, name: space.name, position: space.position })),
      projects: out,
    };
  } finally {
    db.close();
  }
}

const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function renderHtml(data: ReturnType<typeof readBoard>): string {
  const when = new Date(data.generated_at);
  const stamp = when.toLocaleString();
  const projectsNav = data.spaces.map((space) => {
    const links = data.projects
      .filter((project) => project.space_id === space.id)
      .map((project) => `<a href="#p-${esc(project.id)}">${esc(project.name)}</a>`)
      .join('');
    return links ? `<span class="nav-space">${esc(space.name)}</span>${links}` : '';
  }).join('');

  const card = (t: Row) => {
    const badges = [
      t.reopened ? `<span class="b reopened">⟲ reopened</span>` : '',
      t.priority && t.priority !== 'none' ? `<span class="b pri-${esc(t.priority)}">${esc(t.priority)}</span>` : '',
      t.kind && t.kind !== 'none' ? `<span class="b kind">${esc(t.kind)}</span>` : '',
      t.version ? `<span class="b ver">${esc(t.version)}</span>` : '',
      t.source === 'you' ? `<span class="b you">you</span>` : '',
      t.parent_id ? `<span class="b sub">subtask</span>` : '',
    ].filter(Boolean).join('');
    return `<div class="card${t.parent_id ? ' is-sub' : ''}">
      <div class="card-top"><span class="ref">#${esc(t.ref)}</span>${badges}</div>
      <div class="title">${esc(t.title)}</div>
    </div>`;
  };

  const projectSection = (p: Row) => {
    const cols = COLUMNS.map(([status, label]) => {
      const cards = p.tasks.filter((t: Row) => t.status === status);
      const body = cards.length
        ? cards.map(card).join('')
        : `<div class="empty">—</div>`;
      return `<section class="col col-${status}">
        <h3>${label} <span class="count">${cards.length}</span></h3>
        ${body}
      </section>`;
    }).join('');
    const recap = p.recap
      ? `<div class="recap"><b>Last session${p.recap_at ? ' · ' + esc(new Date(p.recap_at).toLocaleString()) : ''}</b><br>${esc(p.recap)}</div>`
      : '';
    return `<article class="project" id="p-${esc(p.id)}">
      <h2><span class="dot" style="background:${esc(p.color || '#7c8cff')}"></span>${esc(p.name)}</h2>
      ${recap}
      <div class="board">${cols}</div>
    </article>`;
  };

  const spaceSections = data.spaces.map((space) => {
    const projects = data.projects.filter((project) => project.space_id === space.id);
    if (!projects.length) return '';
    return `<section class="space">
      <h2 class="space-title">${esc(space.name)} <span>${projects.length}</span></h2>
      ${projects.map(projectSection).join('')}
    </section>`;
  }).join('');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Vibe Tasks — board</title>
<style>
  :root{--bg:#0e0f13;--panel:#171922;--panel2:#1e2130;--line:#272b3a;--fg:#e7e9f0;--mut:#8b90a4;--accent:#7c8cff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro",system-ui,sans-serif;-webkit-text-size-adjust:100%}
  header{position:sticky;top:0;z-index:5;background:rgba(14,15,19,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:max(env(safe-area-inset-top),10px) 14px 8px}
  header h1{margin:0;font-size:16px;letter-spacing:.2px}
  .stale{color:var(--mut);font-size:12px;margin-top:2px}
  nav{display:flex;gap:8px;overflow-x:auto;padding:8px 0 2px;-webkit-overflow-scrolling:touch}
  .nav-space{flex:0 0 auto;align-self:center;color:var(--fg);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  nav a{flex:0 0 auto;color:var(--mut);text-decoration:none;font-size:13px;background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:4px 10px}
  main{padding:12px}
  .space-title{display:flex;align-items:center;gap:8px;margin:12px 0 8px;color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.7px}
  .space-title span{background:var(--panel2);border-radius:999px;padding:1px 7px;font-size:10px}
  .project{margin:0 0 26px}
  .project h2{display:flex;align-items:center;gap:8px;font-size:18px;margin:8px 0 6px}
  .dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto}
  .recap{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:8px 10px;font-size:13px;color:#cfd3e3;margin:0 0 10px}
  .board{display:grid;grid-template-columns:repeat(5,minmax(220px,1fr));gap:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:6px}
  @media(max-width:760px){.board{grid-auto-flow:column;grid-template-columns:none;grid-auto-columns:80%}}
  .col{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px;min-width:0}
  .col h3{margin:2px 4px 8px;font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);display:flex;justify-content:space-between}
  .col-now h3{color:var(--accent)}
  .count{background:var(--panel2);border-radius:999px;padding:0 7px;font-size:11px;color:var(--mut)}
  .card{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 9px;margin-bottom:7px}
  .card.is-sub{margin-left:10px;border-left:2px solid var(--accent)}
  .card-top{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:4px}
  .title{font-size:13.5px;color:var(--fg)}
  .ref{color:var(--mut);font-size:11px;font-variant-numeric:tabular-nums}
  .b{font-size:10px;border-radius:5px;padding:1px 6px;border:1px solid var(--line);color:var(--mut);text-transform:uppercase;letter-spacing:.3px}
  .b.pri-high{color:#ff8a8a;border-color:#5a2b2b}.b.pri-med{color:#ffd27a;border-color:#5a4a23}.b.pri-low{color:#9ad0ff;border-color:#244a5a}
  .b.kind{color:#b9a7ff;border-color:#3a3470}.b.ver{color:#7fe0c0;border-color:#23514a}
  .b.you{color:#0e0f13;background:var(--accent);border-color:var(--accent)}
  .b.reopened{color:#ffb454;border-color:#5a4423}.b.sub{color:var(--mut)}
  .empty{color:var(--mut);font-size:12px;text-align:center;padding:6px 0}
</style></head><body>
<header>
  <h1>Vibe Tasks</h1>
  <div class="stale">Snapshot · ${esc(stamp)} · read-only (last-synced state)</div>
  <nav>${projectsNav}</nav>
</header>
<main>${spaceSections}</main>
</body></html>`;
}

function main() {
  const data = readBoard();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), JSON.stringify(data, null, 2));
  writeFileSync(join(outDir, 'board.html'), renderHtml(data));
  const total = data.projects.reduce((a, p) => a + p.tasks.length, 0);
  process.stderr.write(
    `[vibetasks snapshot] ${data.projects.length} projects, ${total} tasks → ${outDir}\n`);
}

main();
