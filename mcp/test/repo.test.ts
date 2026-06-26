import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDb } from '../src/db.js';
import * as repo from '../src/repo.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('projects', () => {
  it('creates and lists a project', () => {
    const p = repo.createProject(db, { name: 'Vibe Tasks', source: 'you' });
    expect(p.id).toBeTruthy();
    expect(p.space_id).toBe(repo.DEFAULT_SPACE_ID);
    expect(repo.listProjects(db).map(x => x.name)).toEqual(['Vibe Tasks']);
  });

  it('lists projects in position order', () => {
    repo.createProject(db, { name: 'A', source: 'you' });
    repo.createProject(db, { name: 'B', source: 'claude' });
    repo.createProject(db, { name: 'C', source: 'you' });
    expect(repo.listProjects(db).map(x => x.name)).toEqual(['A', 'B', 'C']);
  });

  it('ensureProject is idempotent by name', () => {
    const a = repo.ensureProject(db, 'Repo', 'claude');
    const b = repo.ensureProject(db, 'Repo', 'claude');
    expect(a.id).toBe(b.id);
    expect(repo.listProjects(db).length).toBe(1);
  });

  it('createProject is idempotent by exact name', () => {
    const a = repo.createProject(db, { name: 'Repo', source: 'you' });
    const b = repo.createProject(db, { name: 'Repo', source: 'claude' });
    expect(b.id).toBe(a.id);
    expect(repo.listProjects(db).length).toBe(1);
  });

  it('renameProject refuses to create a duplicate exact name', () => {
    const a = repo.createProject(db, { name: 'A', source: 'you' });
    const b = repo.createProject(db, { name: 'B', source: 'you' });
    expect(() => repo.renameProject(db, b.id, 'A')).toThrow(/already exists/i);
    expect(repo.listProjects(db).map(x => x.name)).toEqual(['A', 'B']);
    repo.renameProject(db, a.id, 'A');
    expect(repo.findProject(db, a.id)!.name).toBe('A');
  });
});

describe('spaces', () => {
  it('seeds Current projects, Finished projects, and Open Sourcer in order', () => {
    expect(repo.listSpaces(db).map((space) => space.name)).toEqual([
      'Current projects',
      'Finished projects',
      'Open Sourcer',
    ]);
  });

  it('creates, renames, and finds a custom space idempotently', () => {
    const first = repo.createSpace(db, 'Client work');
    const again = repo.createSpace(db, 'Client work');
    expect(again.id).toBe(first.id);
    expect(repo.findSpace(db, 'Client work')!.id).toBe(first.id);
    expect(repo.findSpace(db, first.id)!.name).toBe('Client work');

    repo.renameSpace(db, first.id, 'Consulting');
    expect(repo.findSpace(db, first.id)!.name).toBe('Consulting');
  });

  it('refuses duplicate names, deleting the default space, and deleting non-empty spaces', () => {
    const a = repo.createSpace(db, 'A');
    const b = repo.createSpace(db, 'B');
    expect(() => repo.renameSpace(db, b.id, 'A')).toThrow(/already exists/i);
    expect(() => repo.deleteSpace(db, repo.DEFAULT_SPACE_ID)).toThrow(/default/i);

    repo.createProject(db, { name: 'In A', source: 'you', space_id: a.id });
    expect(repo.countSpaceProjects(db, a.id)).toBe(1);
    expect(() => repo.deleteSpace(db, a.id)).toThrow(/move them/i);
  });

  it('moves a project between spaces and permits deleting the emptied custom space', () => {
    const a = repo.createSpace(db, 'A');
    const b = repo.createSpace(db, 'B');
    const project = repo.createProject(db, { name: 'P', source: 'you', space_id: a.id });

    repo.moveProjectToSpace(db, project.id, b.id);
    expect(repo.findProject(db, project.id)!.space_id).toBe(b.id);
    expect(repo.countSpaceProjects(db, a.id)).toBe(0);
    repo.deleteSpace(db, a.id);
    expect(repo.findSpace(db, a.id)).toBeUndefined();
  });

  it('rejects unknown spaces for project creation and moves', () => {
    expect(() => repo.createProject(db, {
      name: 'No home',
      source: 'you',
      space_id: 'missing',
    })).toThrow(/no space/i);
    const project = repo.createProject(db, { name: 'P', source: 'you' });
    expect(() => repo.moveProjectToSpace(db, project.id, 'missing')).toThrow(/no space/i);
  });
});

describe('project resolution (resolveProjectId)', () => {
  it('uses an explicit name over everything else (find-or-create)', () => {
    const id = repo.resolveProjectId(db, { explicit: 'Acme App', envProject: 'X', cwdBase: 'wt' });
    expect(repo.listProjects(db).find(p => p.id === id)!.name).toBe('Acme App');
  });

  it('prefers VIBETASKS_PROJECT env over the cwd basename', () => {
    const id = repo.resolveProjectId(db, { envProject: 'My Board', cwdBase: 'some-worktree' });
    expect(repo.listProjects(db).find(p => p.id === id)!.name).toBe('My Board');
  });

  it('matches an existing project by cwd basename WITHOUT creating a new one', () => {
    const p = repo.createProject(db, { name: 'Repo X', source: 'you' });
    const before = repo.listProjects(db).length;
    const id = repo.resolveProjectId(db, { cwdBase: 'Repo X' });
    expect(id).toBe(p.id);
    expect(repo.listProjects(db).length).toBe(before);
  });

  it('REFUSES to auto-create a board from a uuid-looking worktree dir', () => {
    expect(() => repo.resolveProjectId(db, { cwdBase: '2ae15ac6-14c8-48b4-bfe2-b73fdae555fa' }))
      .toThrow(/refusing to auto-create/i);
    expect(repo.listProjects(db).length).toBe(0); // nothing created
  });

  it('still auto-creates from a normal cwd basename (zero-config first use)', () => {
    const id = repo.resolveProjectId(db, { cwdBase: 'my-app' });
    expect(repo.listProjects(db).find(p => p.id === id)!.name).toBe('my-app');
  });
});

// The safety: a READ must never mint a board, and a typed name that misses while
// other boards exist must NOT create a parallel empty board (the resume("vibe-tasks")
// incident — a read auto-created a duplicate of "Task Manager").
describe('resolveForRead — reads never create', () => {
  it('matches an existing board by explicit name', () => {
    const p = repo.createProject(db, { name: 'Task Manager', source: 'you' });
    expect(repo.resolveForRead(db, { explicit: 'Task Manager', cwdBase: 'wt' })).toBe(p.id);
  });

  it('matches by env, then by cwd basename', () => {
    const a = repo.createProject(db, { name: 'My Board', source: 'you' });
    const b = repo.createProject(db, { name: 'Repo X', source: 'you' });
    expect(repo.resolveForRead(db, { envProject: 'My Board', cwdBase: 'Repo X' })).toBe(a.id);
    expect(repo.resolveForRead(db, { cwdBase: 'Repo X' })).toBe(b.id);
  });

  it('THROWS listing existing boards on an unknown name, creating nothing', () => {
    repo.createProject(db, { name: 'Task Manager', source: 'you' });
    expect(() => repo.resolveForRead(db, { explicit: 'vibe-tasks', cwdBase: 'wt' }))
      .toThrow(/Task Manager/);
    expect(repo.listProjects(db).map(p => p.name)).toEqual(['Task Manager']); // nothing minted
  });

  it('throws on a cwd miss too (a read of a nonexistent board is an error, not a create)', () => {
    expect(() => repo.resolveForRead(db, { cwdBase: 'nope' })).toThrow();
    expect(repo.listProjects(db).length).toBe(0);
  });
});

describe('resolveForWrite — writes bootstrap, but never mint from a typed name beside existing boards', () => {
  it('bootstraps the first board from an explicit name when the DB is empty', () => {
    const id = repo.resolveForWrite(db, { explicit: 'Brand New', cwdBase: 'wt' });
    expect(repo.listProjects(db).find(p => p.id === id)!.name).toBe('Brand New');
  });

  it('bootstraps a new repo board from the cwd basename even when other boards exist', () => {
    repo.createProject(db, { name: 'Other Repo', source: 'you' });
    const id = repo.resolveForWrite(db, { cwdBase: 'fresh-repo' });
    expect(repo.listProjects(db).find(p => p.id === id)!.name).toBe('fresh-repo');
  });

  it('REFUSES to mint a board from an explicit/typed name when other boards already exist', () => {
    repo.createProject(db, { name: 'Task Manager', source: 'you' });
    expect(() => repo.resolveForWrite(db, { explicit: 'vibe-tasks', cwdBase: 'wt' }))
      .toThrow(/Task Manager/);
    expect(repo.listProjects(db).map(p => p.name)).toEqual(['Task Manager']); // no parallel board
  });

  it('still refuses a uuid-looking worktree dir on the cwd path', () => {
    expect(() => repo.resolveForWrite(db, { cwdBase: '2ae15ac6-14c8-48b4-bfe2-b73fdae555fa' }))
      .toThrow(/refusing to auto-create/i);
  });

  it('matches an existing board by explicit name without creating', () => {
    const p = repo.createProject(db, { name: 'Task Manager', source: 'you' });
    const before = repo.listProjects(db).length;
    expect(repo.resolveForWrite(db, { explicit: 'Task Manager', cwdBase: 'wt' })).toBe(p.id);
    expect(repo.listProjects(db).length).toBe(before);
  });
});

describe('project repair (rename / reassign / delete)', () => {
  it('findProject matches by id or by exact name', () => {
    const p = repo.createProject(db, { name: 'Acme App', source: 'you' });
    expect(repo.findProject(db, p.id)!.id).toBe(p.id);
    expect(repo.findProject(db, 'Acme App')!.id).toBe(p.id);
    expect(repo.findProject(db, 'nope')).toBeUndefined();
  });

  it('reassignProjectTasks moves every task (subtasks, links, #refs follow) and empties the source', () => {
    const a = repo.createProject(db, { name: 'A', source: 'you' });
    const b = repo.createProject(db, { name: 'B', source: 'you' });
    const parent = repo.addTask(db, { project_id: a.id, title: 'P', source: 'you' });
    const child = repo.addTask(db, { project_id: a.id, title: 'C', parent_id: parent.id, source: 'you' });
    const other = repo.addTask(db, { project_id: a.id, title: 'O', source: 'you' });
    repo.linkTasks(db, parent.id, other.id, 'depends_on');

    const moved = repo.reassignProjectTasks(db, a.id, b.id);
    expect(moved).toBe(3);
    expect(repo.countProjectTasks(db, a.id)).toBe(0);
    expect(repo.countProjectTasks(db, b.id)).toBe(3);

    const movedChild = repo.getTask(db, child.id)!;
    expect(movedChild.project_id).toBe(b.id);
    expect(movedChild.parent_id).toBe(parent.id); // subtask link intact
    expect(movedChild.ref).toBe(child.ref);       // ref unchanged (globally unique)
    expect(repo.getMap(db, b.id).edges.length).toBe(1); // task_link followed
  });

  it('reassignProjectTasks into the same project is a no-op (self-merge guard)', () => {
    const a = repo.createProject(db, { name: 'A', source: 'you' });
    repo.addTask(db, { project_id: a.id, title: 'T', source: 'you' });
    expect(repo.reassignProjectTasks(db, a.id, a.id)).toBe(0);
    expect(repo.countProjectTasks(db, a.id)).toBe(1);
  });

  it('countProjectTasks backs the delete guard', () => {
    const a = repo.createProject(db, { name: 'A', source: 'you' });
    expect(repo.countProjectTasks(db, a.id)).toBe(0);
    repo.addTask(db, { project_id: a.id, title: 'T', source: 'you' });
    expect(repo.countProjectTasks(db, a.id)).toBe(1);
  });
});

describe('tasks', () => {
  it('append position increments per status independently', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t1 = repo.addTask(db, { project_id: p.id, title: 'next1', status: 'next', source: 'you' });
    const t2 = repo.addTask(db, { project_id: p.id, title: 'next2', status: 'next', source: 'you' });
    const n1 = repo.addTask(db, { project_id: p.id, title: 'now1', status: 'now', source: 'you' });
    expect(t1.position).toBe(1);
    expect(t2.position).toBe(2);
    // 'now' starts its own sequence at 1
    expect(n1.position).toBe(1);
  });

  it('addTask defaults to the next column', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you' });
    expect(t.status).toBe('next');
  });

  it('moveTask re-appends to the end of the new column', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTask(db, { project_id: p.id, title: 'A', status: 'next', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'X', status: 'complete', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'Y', status: 'complete', source: 'you' });
    repo.moveTask(db, a.id, 'complete');
    const moved = repo.getTask(db, a.id)!;
    expect(moved.status).toBe('complete');
    expect(moved.position).toBe(3); // appended after X(1), Y(2)
  });

  it('reorderTasks sets positions 1..n', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you' });
    const b = repo.addTask(db, { project_id: p.id, title: 'B', source: 'you' });
    const c = repo.addTask(db, { project_id: p.id, title: 'C', source: 'you' });
    repo.reorderTasks(db, [c.id, a.id, b.id]);
    expect(repo.getTask(db, c.id)!.position).toBe(1);
    expect(repo.getTask(db, a.id)!.position).toBe(2);
    expect(repo.getTask(db, b.id)!.position).toBe(3);
  });

  it('updateTask merges partial fields and parses paths/symbols round-trip', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you', paths: ['src/a.ts'], symbols: ['foo'] });
    repo.updateTask(db, t.id, { title: 'A2', priority: 'high' });
    const cur = repo.getTask(db, t.id)!;
    expect(cur.title).toBe('A2');
    expect(cur.priority).toBe('high');
    expect(cur.paths).toEqual(['src/a.ts']);
    expect(cur.symbols).toEqual(['foo']);
  });

  it('updateTask ignores explicit-undefined fields instead of nulling columns', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t = repo.addTask(db, { project_id: p.id, title: 'A', summary: 'keep me', description: 'body', source: 'you' });
    // Tool handlers pass { summary: undefined } when brief/details are omitted;
    // that must mean "leave unchanged", not "write NULL" (task.summary is NOT NULL).
    repo.updateTask(db, t.id, { status: 'complete', summary: undefined, description: undefined });
    const cur = repo.getTask(db, t.id)!;
    expect(cur.status).toBe('complete');
    expect(cur.summary).toBe('keep me');
    expect(cur.description).toBe('body');
  });

  it('setRefs updates paths/symbols, leaving unspecified ones intact', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you', paths: ['old.ts'], symbols: ['s'] });
    repo.setRefs(db, t.id, ['new.ts']);
    const cur = repo.getTask(db, t.id)!;
    expect(cur.paths).toEqual(['new.ts']);
    expect(cur.symbols).toEqual(['s']);
  });

  it('subtasks: addTask with parent_id is tracked as a child', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const parent = repo.addTask(db, { project_id: p.id, title: 'Parent', source: 'you' });
    const child = repo.addTask(db, { project_id: p.id, title: 'Child', parent_id: parent.id, source: 'you' });
    expect(child.parent_id).toBe(parent.id);
    const board = repo.getBoard(db, p.id);
    const parentCard = board.cards.find(c => c.id === parent.id)!;
    const childCard = board.cards.find(c => c.id === child.id)!;
    expect(parentCard.has_subtasks).toBe(true);
    expect(childCard.parent_id).toBe(parent.id);
    expect(childCard.has_subtasks).toBe(false);
  });
});

describe('reopen-from-complete', () => {
  it('moveTask stamps reopened_at when leaving complete and clears it on re-complete', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t = repo.addTask(db, { project_id: p.id, title: 'A', status: 'complete', source: 'you' });
    expect(repo.getTask(db, t.id)!.reopened_at).toBeNull();

    repo.moveTask(db, t.id, 'now');
    expect(repo.getTask(db, t.id)!.reopened_at).toBeTruthy();
    const board = repo.getBoard(db, p.id);
    expect(board.reopened.map(x => x.id)).toContain(t.id);
    expect(board.cards.find(c => c.id === t.id)!.reopened).toBe(true);

    repo.moveTask(db, t.id, 'complete');
    expect(repo.getTask(db, t.id)!.reopened_at).toBeNull();
    expect(repo.getBoard(db, p.id).reopened.length).toBe(0);
  });

  it('updateTask changing status out of complete also flags reopened', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t = repo.addTask(db, { project_id: p.id, title: 'A', status: 'complete', source: 'you' });
    repo.updateTask(db, t.id, { status: 'later' });
    expect(repo.getTask(db, t.id)!.reopened_at).toBeTruthy();
  });

  it('reopened subtasks are surfaced in getBoard', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const parent = repo.addTask(db, { project_id: p.id, title: 'Parent', source: 'you' });
    const child = repo.addTask(db, { project_id: p.id, parent_id: parent.id, title: 'Child', status: 'complete', source: 'you' });
    repo.moveTask(db, child.id, 'next');
    const reopened = repo.getBoard(db, p.id).reopened.find(x => x.id === child.id)!;
    expect(reopened.parent_id).toBe(parent.id);
    expect(reopened.title).toBe('Child');
  });
});

describe('links', () => {
  it('linkTasks / unlinkTasks add and remove edges (idempotent insert)', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you' });
    const b = repo.addTask(db, { project_id: p.id, title: 'B', source: 'you' });
    repo.linkTasks(db, a.id, b.id, 'depends_on');
    repo.linkTasks(db, a.id, b.id, 'depends_on'); // ignored dup
    expect(repo.getMap(db, p.id).edges.length).toBe(1);
    repo.unlinkTasks(db, a.id, b.id, 'depends_on');
    expect(repo.getMap(db, p.id).edges.length).toBe(0);
  });
});

describe('todos', () => {
  it('toggleTodo flips done', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t = repo.addTodo(db, { project_id: p.id, text: 'ship it', source: 'you' });
    expect(t.done).toBe(0);
    repo.toggleTodo(db, t.id);
    expect((db.prepare('SELECT done FROM todo WHERE id=?').get(t.id) as any).done).toBe(1);
    repo.toggleTodo(db, t.id);
    expect((db.prepare('SELECT done FROM todo WHERE id=?').get(t.id) as any).done).toBe(0);
  });

  it('addTodo appends position per project', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTodo(db, { project_id: p.id, text: 'a', source: 'you' });
    const b = repo.addTodo(db, { project_id: p.id, text: 'b', source: 'you' });
    expect(a.position).toBe(1);
    expect(b.position).toBe(2);
  });
});

describe('notes', () => {
  it('setNotes upserts (insert then update)', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    repo.setNotes(db, p.id, 'first');
    expect(repo.getNotes(db, p.id)!.body).toBe('first');
    repo.setNotes(db, p.id, 'second');
    expect(repo.getNotes(db, p.id)!.body).toBe('second');
    expect((db.prepare('SELECT COUNT(*) c FROM note WHERE project_id=?').get(p.id) as any).c).toBe(1);
  });

  it('getNotes returns null when none', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    expect(repo.getNotes(db, p.id)).toBeNull();
  });
});

describe('cascade delete', () => {
  it('deleting a project removes its tasks, todos, notes, links', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you' });
    const b = repo.addTask(db, { project_id: p.id, title: 'B', source: 'you' });
    repo.linkTasks(db, a.id, b.id, 'related');
    repo.addTodo(db, { project_id: p.id, text: 't', source: 'you' });
    repo.setNotes(db, p.id, 'note');
    repo.deleteProject(db, p.id);
    expect((db.prepare('SELECT COUNT(*) c FROM task').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) c FROM todo').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) c FROM note').get() as any).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) c FROM task_link').get() as any).c).toBe(0);
  });

  it('deleting a parent task cascades to subtasks', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const parent = repo.addTask(db, { project_id: p.id, title: 'Parent', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'Child', parent_id: parent.id, source: 'you' });
    repo.deleteTask(db, parent.id);
    expect((db.prepare('SELECT COUNT(*) c FROM task').get() as any).c).toBe(0);
  });
});

describe('token contract: getBoard', () => {
  it('detail only for the Now column, capped at 600 (+ ellipsis); non-now excluded from detail', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'A', summary: 'b'.repeat(500), description: 'x'.repeat(900), status: 'now', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'B', description: 'should be hidden', status: 'next', source: 'you' });
    const b = repo.getBoard(db, p.id);
    const a = b.detail.find(d => d.title === 'A')!;
    expect(a.summary.length).toBeLessThanOrEqual(241); // SUMMARY_CAP (+ ellipsis)
    expect(a.summary.endsWith('…')).toBe(true);
    expect(a.description.length).toBeLessThanOrEqual(601); // DESC_CAP (+ ellipsis)
    expect(a.description.endsWith('…')).toBe(true);
    expect(b.cards.find(c => c.title === 'B')).toBeTruthy();
    expect(b.cards.find(c => c.title === 'B')!.has_details).toBe(true);
    expect(b.detail.find(d => d.title === 'B')).toBeFalsy();
    expect((b.cards.find(c => c.title === 'B') as any).description).toBeUndefined();
  });

  it('short Now descriptions are returned untruncated (no ellipsis)', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'A', description: 'short body', status: 'now', source: 'you' });
    const a = repo.getBoard(db, p.id).detail.find(d => d.title === 'A')!;
    expect(a.description).toBe('short body');
  });

  it('cards include all tasks across statuses; non-now tasks have no detail', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const parent = repo.addTask(db, { project_id: p.id, title: 'NX', status: 'next', source: 'claude' });
    repo.addTask(db, { project_id: p.id, title: 'NW', status: 'now', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'D', description: 'done body', status: 'complete', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'DR', status: 'dropped', source: 'you' });
    repo.addTask(db, { project_id: p.id, parent_id: parent.id, title: 'SUB', status: 'next', source: 'you' });
    const b = repo.getBoard(db, p.id);
    expect(b.cards.map(c => c.title).sort()).toEqual(['D', 'DR', 'NW', 'NX', 'SUB']);
    expect(b.detail.map(d => d.title)).toEqual(['NW']);
    expect(b.cards.find(c => c.title === 'NX')!.source).toBe('claude');
    expect(b.cards.find(c => c.title === 'SUB')!.parent_id).toBe(parent.id);
  });
});

describe('token contract: getMap', () => {
  it('nodes carry summary/paths/symbols but NO description; edges only between included tasks', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTask(db, { project_id: p.id, title: 'A', summary: 'auth flow',
      description: 'long body here', paths: ['src/auth.ts'], symbols: ['login'], source: 'you' });
    const b = repo.addTask(db, { project_id: p.id, title: 'B', summary: 'ui', source: 'you' });
    repo.linkTasks(db, a.id, b.id, 'depends_on');
    const m = repo.getMap(db, p.id);
    const na = m.nodes.find(n => n.title === 'A')! as any;
    const nb = m.nodes.find(n => n.title === 'B')! as any;
    expect(na.summary).toBe('auth flow');
    expect(na.has_details).toBe(true);
    expect(nb.has_details).toBe(false);
    expect(na.paths).toEqual(['src/auth.ts']);
    expect(na.symbols).toEqual(['login']);
    expect(na.description).toBeUndefined();
    expect(m.edges).toEqual([{ from_task_id: a.id, to_task_id: b.id, type: 'depends_on' }]);
  });

  it('caps long summaries and large ref lists', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    repo.addTask(db, {
      project_id: p.id,
      title: 'A',
      summary: 's'.repeat(500),
      paths: Array.from({ length: 25 }, (_, i) => `${'p'.repeat(220)}-${i}`),
      symbols: Array.from({ length: 25 }, (_, i) => `${'sym'.repeat(80)}-${i}`),
      source: 'you',
    });
    const node = repo.getMap(db, p.id).nodes[0];
    expect(node.summary.length).toBeLessThanOrEqual(241);
    expect(node.paths.length).toBe(20);
    expect(node.symbols.length).toBe(20);
    expect(node.paths[0].length).toBeLessThanOrEqual(181);
    expect(node.symbols[0].length).toBeLessThanOrEqual(181);
  });

  it('map excludes edges that reference tasks outside the project', () => {
    const p1 = repo.createProject(db, { name: 'P1', source: 'you' });
    const p2 = repo.createProject(db, { name: 'P2', source: 'you' });
    const a = repo.addTask(db, { project_id: p1.id, title: 'A', source: 'you' });
    const x = repo.addTask(db, { project_id: p2.id, title: 'X', source: 'you' });
    repo.linkTasks(db, a.id, x.id, 'related');
    expect(repo.getMap(db, p1.id).edges.length).toBe(0);
  });
});

describe('token contract: resume', () => {
  it('returns {now, titles, reopened, recap, recap_at, notes_excerpt} without the map by default', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const parent = repo.addTask(db, { project_id: p.id, title: 'NW', description: 'y'.repeat(700), status: 'now', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'NX', status: 'next', source: 'you' });
    repo.addTask(db, { project_id: p.id, parent_id: parent.id, title: 'SUB', status: 'next', source: 'you' });
    repo.setNotes(db, p.id, 'z'.repeat(800));

    const res = repo.resume(db, p.id);
    expect(Object.keys(res).sort()).toEqual(['notes_excerpt', 'now', 'recap', 'recap_at', 'reopened', 'titles']);

    // now: full tasks, capped
    expect(res.now.map(t => t.title)).toEqual(['NW']);
    expect(res.now[0].description.length).toBeLessThanOrEqual(601);

    // titles list all tasks, including subtasks
    expect(res.titles.map(t => t.title).sort()).toEqual(['NW', 'NX', 'SUB']);
    expect(res.titles[0]).toHaveProperty('status');

    expect(res.notes_excerpt.length).toBeLessThanOrEqual(601);
    expect(res.notes_excerpt.endsWith('…')).toBe(true);
  });

  it('includes the map only when requested', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    repo.addTask(db, { project_id: p.id, title: 'A', source: 'you' });
    const res = repo.resume(db, p.id, { include_map: true });
    expect(res).toHaveProperty('map');
    expect(res.map).toHaveProperty('nodes');
    expect(res.map).toHaveProperty('edges');
  });

  it('notes_excerpt is empty string when there are no notes', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    expect(repo.resume(db, p.id).notes_excerpt).toBe('');
  });

  it('setRecap stores a dated recap separate from the freeform body (no clobber)', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    repo.setNotes(db, p.id, 'freeform human note');
    repo.setRecap(db, p.id, 'Last session: fixed the MCP migration; next is the panel rework.');
    const n = repo.getNotes(db, p.id)!;
    expect(n.body).toBe('freeform human note'); // recap did NOT clobber the body
    expect(n.recap).toContain('fixed the MCP migration');
    expect(n.recap_at).toBeTruthy();
    const res = repo.resume(db, p.id);
    expect(res.recap).toContain('fixed the MCP migration');
    expect(res.notes_excerpt).toBe('freeform human note');
  });
});

describe('migration: 3-column → 5-column rebuild', () => {
  it('remaps todo→next, in_progress→now, keeps complete; preserves subtasks + links; adds reopened_at', () => {
    const path = join(tmpdir(), `vt-migrate-${process.pid}-${Date.now()}.db`);
    const cleanup = () => ['', '-wal', '-shm'].forEach(s => rmSync(path + s, { force: true }));
    cleanup();
    try {
      // Hand-build an OLD-schema DB (old CHECK, no reopened_at, user_version 0).
      const old = new Database(path);
      old.pragma('foreign_keys = ON');
      old.exec(`
        CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#7c8cff',
          source TEXT NOT NULL CHECK(source IN ('claude','you')), position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE task (id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          parent_id TEXT REFERENCES task(id) ON DELETE CASCADE,
          title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK(status IN ('todo','in_progress','complete')),
          priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none','low','med','high')),
          paths TEXT NOT NULL DEFAULT '[]', symbols TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL CHECK(source IN ('claude','you')),
          position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE task_link (from_task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
          to_task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('depends_on','related')), PRIMARY KEY(from_task_id,to_task_id,type));
        CREATE TABLE todo (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL CHECK(source IN ('claude','you')),
          position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE note (project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE, body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      `);
      const now = '2026-01-01T00:00:00.000Z';
      old.prepare("INSERT INTO project VALUES('p','P','#7c8cff','you',1,?,?)").run(now, now);
      const ins = old.prepare("INSERT INTO task(id,project_id,parent_id,title,summary,description,status,priority,paths,symbols,source,position,created_at,updated_at) VALUES(?,?,?,?,'','',?,'none','[]','[]','you',1,?,?)");
      ins.run('t1', 'p', null, 'TodoTask', 'todo', now, now);
      ins.run('t2', 'p', null, 'IpTask', 'in_progress', now, now);
      ins.run('t3', 'p', null, 'DoneTask', 'complete', now, now);
      ins.run('s1', 'p', 't1', 'SubTask', 'todo', now, now);
      old.prepare("INSERT INTO task_link VALUES('t1','t2','depends_on')").run();
      old.close();

      // Reopen via openDb → triggers the migration.
      const migrated = openDb(path);
      const statuses = Object.fromEntries(
        (migrated.prepare('SELECT id,status FROM task').all() as any[]).map(r => [r.id, r.status]));
      expect(statuses).toEqual({ t1: 'next', t2: 'now', t3: 'complete', s1: 'next' });
      expect((migrated.prepare('SELECT reopened_at FROM task WHERE id=?').get('t1') as any).reopened_at).toBeNull();
      expect((migrated.prepare('SELECT parent_id FROM task WHERE id=?').get('s1') as any).parent_id).toBe('t1');
      expect((migrated.prepare('SELECT COUNT(*) c FROM task_link').get() as any).c).toBe(1);
      // v3 + v4 also run: kind column (default 'none') + ref backfilled 1..n by age.
      expect((migrated.prepare('SELECT kind FROM task WHERE id=?').get('t1') as any).kind).toBe('none');
      expect((migrated.prepare('SELECT ref FROM task ORDER BY ref').all() as any[]).map(r => r.ref)).toEqual([1, 2, 3, 4]);
      expect((migrated.prepare('SELECT space_id FROM project WHERE id=?').get('p') as any).space_id)
        .toBe(repo.DEFAULT_SPACE_ID);
      expect((migrated.prepare('SELECT name FROM space ORDER BY position').all() as any[])
        .map((row) => row.name)).toEqual([
          'Current projects',
          'Finished projects',
          'Open Sourcer',
        ]);
      expect(migrated.pragma('user_version', { simple: true })).toBe(10);
      migrated.close();
    } finally {
      cleanup();
    }
  });

  it('v3: adds the kind column to a v2 DB (user_version 2 → 3)', () => {
    const path = join(tmpdir(), `vt-migrate-v3-${process.pid}-${Date.now()}.db`);
    const cleanup = () => ['', '-wal', '-shm'].forEach(s => rmSync(path + s, { force: true }));
    cleanup();
    try {
      // A v2-schema DB: 5 statuses + reopened_at, user_version 2, but NO kind column.
      const v2 = new Database(path);
      v2.exec(`
        CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#7c8cff',
          source TEXT NOT NULL CHECK(source IN ('claude','you')), position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE task (id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          parent_id TEXT REFERENCES task(id) ON DELETE CASCADE,
          title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK(status IN ('now','next','later','complete','dropped')),
          priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none','low','med','high')),
          paths TEXT NOT NULL DEFAULT '[]', symbols TEXT NOT NULL DEFAULT '[]',
          source TEXT NOT NULL CHECK(source IN ('claude','you')),
          position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reopened_at TEXT);
      `);
      const now = '2026-01-01T00:00:00.000Z';
      v2.prepare("INSERT INTO project VALUES('p','P','#7c8cff','you',1,?,?)").run(now, now);
      v2.prepare("INSERT INTO task(id,project_id,parent_id,title,summary,description,status,priority,paths,symbols,source,position,created_at,updated_at,reopened_at) VALUES('t','p',NULL,'T','','','next','none','[]','[]','you',1,?,?,NULL)").run(now, now);
      v2.pragma('user_version = 2');
      v2.close();

      const migrated = openDb(path);
      expect((migrated.prepare('SELECT kind FROM task WHERE id=?').get('t') as any).kind).toBe('none');
      expect((migrated.prepare('SELECT ref FROM task WHERE id=?').get('t') as any).ref).toBe(1);
      expect((migrated.prepare('SELECT space_id FROM project WHERE id=?').get('p') as any).space_id)
        .toBe(repo.DEFAULT_SPACE_ID);
      expect(migrated.pragma('user_version', { simple: true })).toBe(10);
      migrated.close();
    } finally {
      cleanup();
    }
  });
});

describe('migration v8: project.repo_path', () => {
  it('adds a nullable repo_path column to a v7 DB and preserves projects', () => {
    const path = join(tmpdir(), `vt-migrate-v8-${process.pid}-${Date.now()}.db`);
    const cleanup = () => ['', '-wal', '-shm'].forEach(s => rmSync(path + s, { force: true }));
    cleanup();
    try {
      // Build a v7-shaped DB: spaces exist, project has space_id, NO repo_path.
      const old = new Database(path);
      old.exec(`
        CREATE TABLE space (id TEXT PRIMARY KEY, name TEXT NOT NULL,
          position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#7c8cff',
          source TEXT NOT NULL CHECK(source IN ('claude','you')),
          space_id TEXT REFERENCES space(id) ON DELETE SET NULL,
          position REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      `);
      old.prepare("INSERT INTO space VALUES('space-current','Current projects',1,'2026-01-01','2026-01-01')").run();
      old.prepare("INSERT INTO project VALUES('p','P','#7c8cff','you','space-current',1,'2026-01-01','2026-01-01')").run();
      old.pragma('user_version = 7');
      old.close();

      const migrated = openDb(path);
      const cols = (migrated.prepare('PRAGMA table_info(project)').all() as any[]).map(c => c.name);
      expect(cols).toContain('repo_path');
      const row = migrated.prepare('SELECT id, repo_path FROM project WHERE id=?').get('p') as any;
      expect(row.id).toBe('p');
      expect(row.repo_path).toBeNull();
      expect(migrated.pragma('user_version', { simple: true })).toBe(10);
      migrated.close();
    } finally { cleanup(); }
  });
});

describe('kind (item type)', () => {
  it('defaults to none, round-trips via addTask/updateTask, surfaces on board + map', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you' });
    expect(a.kind).toBe('none');
    const b = repo.addTask(db, { project_id: p.id, title: 'B', kind: 'feature', status: 'now', source: 'you' });
    expect(b.kind).toBe('feature');
    repo.updateTask(db, a.id, { kind: 'fix' });
    expect(repo.getTask(db, a.id)!.kind).toBe('fix');
    const board = repo.getBoard(db, p.id);
    expect(board.cards.find(c => c.id === a.id)!.kind).toBe('fix');
    expect(board.cards.find(c => c.id === b.id)!.kind).toBe('feature');
    expect((repo.getMap(db, p.id).nodes.find(n => n.id === b.id) as any).kind).toBe('feature');
  });

  it('rejects an invalid kind via the CHECK constraint', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const t = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you' });
    expect(() => db.prepare('UPDATE task SET kind=? WHERE id=?').run('bogus', t.id)).toThrow();
  });
});

describe('ref (reference number)', () => {
  it('assigns increasing global refs on insert', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTask(db, { project_id: p.id, title: 'A', source: 'you' });
    const b = repo.addTask(db, { project_id: p.id, title: 'B', source: 'you' });
    expect(a.ref).toBeGreaterThan(0);
    expect(b.ref).toBe(a.ref + 1);
  });

  it('refs are per-project (each project starts at 1)', () => {
    const p1 = repo.createProject(db, { name: 'P1', source: 'you' });
    const p2 = repo.createProject(db, { name: 'P2', source: 'you' });
    const a = repo.addTask(db, { project_id: p1.id, title: 'A', source: 'you' });
    const b = repo.addTask(db, { project_id: p1.id, title: 'B', source: 'you' });
    const x = repo.addTask(db, { project_id: p2.id, title: 'X', source: 'you' });
    expect(a.ref).toBe(1);
    expect(b.ref).toBe(2);
    expect(x.ref).toBe(1); // P2 restarts at 1
  });

  it('listTasks returns every task with its ref, ordered by ref', () => {
    const p = repo.createProject(db, { name: 'P', source: 'you' });
    const a = repo.addTask(db, { project_id: p.id, title: 'A', status: 'now', source: 'you' });
    const b = repo.addTask(db, { project_id: p.id, title: 'B', status: 'later', source: 'you' });
    const list = repo.listTasks(db, p.id) as any[];
    expect(list.map((t) => t.ref)).toEqual([a.ref, b.ref]);
    expect(list[0]).toMatchObject({ id: a.id, title: 'A', status: 'now' });
    expect(list[1]).toMatchObject({ id: b.id, title: 'B', status: 'later' });
  });
});
