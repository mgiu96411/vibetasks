import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { runCli } from '../src/cli.js';
import * as repo from '../src/repo.js';

const paths: string[] = [];

function tempDbPath(): string {
  const path = join(tmpdir(), `vt-cli-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  paths.push(path);
  return path;
}

afterEach(() => {
  for (const path of paths.splice(0)) {
    ['', '-wal', '-shm'].forEach((suffix) => rmSync(path + suffix, { force: true }));
  }
});

async function run(args: string[], dbPath: string) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(args, {
    cwd: '/tmp/repo',
    env: { VIBETASKS_DB: dbPath },
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
  });
  return { code, stdout, stderr };
}

describe('CLI facade', () => {
  it('lists tasks in compact line mode', async () => {
    const path = tempDbPath();
    const db = openDb(path);
    const p = repo.createProject(db, { name: 'Task Manager', source: 'you' });
    const task = repo.addTask(db, {
      project_id: p.id,
      title: 'Build reversible CLI',
      priority: 'high',
      kind: 'feature',
      source: 'you',
    });
    db.close();

    const res = await run(['list', '--project', 'Task Manager'], path);
    expect(res.code).toBe(0);
    expect(res.stderr).toBe('');
    expect(res.stdout).toContain(`T #${task.ref} next high feature "Build reversible CLI"`);
  });

  it('read commands never create a typo board', async () => {
    const path = tempDbPath();
    let db = openDb(path);
    repo.createProject(db, { name: 'Task Manager', source: 'you' });
    db.close();

    const res = await run(['list', '--project', 'typo-board'], path);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Task Manager');

    db = openDb(path);
    expect(repo.listProjects(db).map((p) => p.name)).toEqual(['Task Manager']);
    db.close();
  });

  it('adds tasks through repo logic and returns a tiny ack', async () => {
    const path = tempDbPath();
    const res = await run([
      'add',
      'Build',
      'CLI',
      '--project',
      'Task Manager',
      '--priority',
      'high',
      '--kind',
      'feature',
    ], path);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^ok #1 /);

    const db = openDb(path);
    const p = repo.findProjectByName(db, 'Task Manager')!;
    const task = repo.listTasks(db, p.id)[0] as any;
    expect(task.title).toBe('Build CLI');
    expect(task.status).toBe('next');
    expect(task.priority).toBe('high');
    expect(task.kind).toBe('feature');
    expect(repo.getTask(db, task.id)!.source).toBe('claude');
    db.close();
  });

  it('accepts Brief/Details aliases while storing in the compatible columns', async () => {
    const path = tempDbPath();
    const res = await run([
      'add',
      'Capture',
      'contract',
      '--project',
      'Task Manager',
      '--brief',
      'One-line handle',
      '--details',
      'Full body with acceptance criteria.',
    ], path);
    expect(res.code).toBe(0);

    const db = openDb(path);
    const p = repo.findProjectByName(db, 'Task Manager')!;
    const task = repo.getTask(db, repo.listTasks(db, p.id)[0].id)!;
    expect(task.summary).toBe('One-line handle');
    expect(task.description).toBe('Full body with acceptance criteria.');
    db.close();

    const shown = await run(['task', '#1', '--project', 'Task Manager'], path);
    expect(shown.stdout).toContain('brief "One-line handle"');
    expect(shown.stdout).toContain('details "Full body with acceptance criteria."');
  });

  it('rejects overlong Briefs before creating a board', async () => {
    const path = tempDbPath();
    const res = await run([
      'add',
      'Too much brief',
      '--project',
      'Task Manager',
      '--brief',
      'x'.repeat(241),
    ], path);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Brief must be 240');

    const db = openDb(path);
    expect(repo.listProjects(db)).toEqual([]);
    db.close();
  });

  it('moves tasks by #ref through repo logic, preserving reopened semantics', async () => {
    const path = tempDbPath();
    let db = openDb(path);
    const p = repo.createProject(db, { name: 'Task Manager', source: 'you' });
    const task = repo.addTask(db, { project_id: p.id, title: 'Reopen me', status: 'complete', source: 'you' });
    db.close();

    const res = await run(['move', `#${task.ref}`, 'now', '--project', 'Task Manager'], path);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(`ok #${task.ref} now\n`);

    db = openDb(path);
    const moved = repo.getTask(db, task.id)!;
    expect(moved.status).toBe('now');
    expect(moved.reopened_at).toBeTruthy();
    db.close();
  });

  it('invalid ref writes fail before mutating', async () => {
    const path = tempDbPath();
    let db = openDb(path);
    const p = repo.createProject(db, { name: 'Task Manager', source: 'you' });
    const task = repo.addTask(db, { project_id: p.id, title: 'Stay put', status: 'next', source: 'you' });
    db.close();

    const res = await run(['move', '#999', 'complete', '--project', 'Task Manager'], path);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('No task #999');

    db = openDb(path);
    expect(repo.getTask(db, task.id)!.status).toBe('next');
    db.close();
  });

  it('unknown commands do not even create the database file', async () => {
    const path = tempDbPath();
    const res = await run(['definitely-not-a-command'], path);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Unknown command');
    expect(existsSync(path)).toBe(false);
  });

  it('invalid add options fail before creating a board', async () => {
    const path = tempDbPath();
    const res = await run(['add', 'Bad', '--project', 'Task Manager', '--kind', 'bogus'], path);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Invalid kind');

    const db = openDb(path);
    expect(repo.listProjects(db)).toEqual([]);
    db.close();
  });

  it('bad move statuses fail before mutating', async () => {
    const path = tempDbPath();
    let db = openDb(path);
    const p = repo.createProject(db, { name: 'Task Manager', source: 'you' });
    const task = repo.addTask(db, { project_id: p.id, title: 'Stay next', status: 'next', source: 'you' });
    db.close();

    const res = await run(['move', `#${task.ref}`, 'bogus', '--project', 'Task Manager'], path);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Invalid status');

    db = openDb(path);
    expect(repo.getTask(db, task.id)!.status).toBe('next');
    db.close();
  });

  it('refs are project-scoped: a ref that exists only in project A is not found in project B', async () => {
    const path = tempDbPath();
    let db = openDb(path);
    const a = repo.createProject(db, { name: 'A', source: 'you' });
    const b = repo.createProject(db, { name: 'B', source: 'you' });
    // Project A gets refs 1 and 2; project B gets only ref 1.
    repo.addTask(db, { project_id: a.id, title: 'A-task-1', status: 'next', source: 'you' });
    const taskA2 = repo.addTask(db, { project_id: a.id, title: 'Do not move', status: 'next', source: 'you' });
    repo.addTask(db, { project_id: b.id, title: 'Other board task', status: 'next', source: 'you' });
    db.close();

    // taskA2 has ref 2 in project A; project B only has ref 1 — lookup must fail.
    expect(taskA2.ref).toBe(2);
    const res = await run(['move', '#2', 'complete', '--project', 'B'], path);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('No task #2');

    db = openDb(path);
    expect(repo.getTask(db, taskA2.id)!.status).toBe('next');
    db.close();
  });
});
