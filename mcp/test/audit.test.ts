import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyBoardAudit, auditBoard } from '../src/audit.js';
import { openDb } from '../src/db.js';
import * as repo from '../src/repo.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:'); });

describe('auditBoard', () => {
  it('returns active detail, compact closed context, relationships, and hygiene findings', () => {
    const project = repo.createProject(db, { name: 'P', source: 'you' });
    const dropped = repo.addTask(db, {
      project_id: project.id,
      title: 'Old dependency',
      status: 'dropped',
      priority: 'low',
      kind: 'chore',
      source: 'you',
    });
    const stale = repo.addTask(db, {
      project_id: project.id,
      title: 'Ship feature',
      description: 'full active body',
      status: 'next',
      source: 'you',
    });
    const parent = repo.addTask(db, {
      project_id: project.id,
      title: 'Parent',
      summary: 'Parent brief',
      paths: ['src/parent.ts'],
      priority: 'high',
      kind: 'feature',
      status: 'now',
      source: 'you',
    });
    repo.addTask(db, {
      project_id: project.id,
      parent_id: parent.id,
      title: 'Child',
      status: 'complete',
      priority: 'med',
      kind: 'feature',
      source: 'you',
    });
    repo.addTask(db, {
      project_id: project.id,
      title: 'ship-feature',
      status: 'complete',
      priority: 'med',
      kind: 'feature',
      source: 'you',
    });
    repo.linkTasks(db, stale.id, dropped.id, 'depends_on');
    db.prepare('UPDATE task SET updated_at=? WHERE id=?')
      .run('2020-01-01T00:00:00.000Z', stale.id);

    const result = auditBoard(db, project.id, { stale_after_days: 30 }) as any;
    expect(result.active.map((task: any) => task.ref).sort((a: number, b: number) => a - b))
      .toEqual([parent.ref, stale.ref].sort((a, b) => a - b));
    expect(result.active.find((task: any) => task.ref === stale.ref).details).toBe('full active body');
    expect(result.closed.length).toBe(3);
    expect(result.closed[0]).not.toHaveProperty('details');
    expect(result.relations.links).toContainEqual(expect.objectContaining({
      from_ref: stale.ref,
      to_ref: dropped.ref,
      type: 'depends_on',
    }));
    expect(result.findings.map((finding: any) => finding.code)).toEqual(expect.arrayContaining([
      'missing_metadata',
      'stale_active',
      'depends_on_dropped',
      'all_children_closed',
      'duplicate_title',
    ]));
    expect(result.repository.available).toBe(false);
  });

  it('collects read-only git evidence and labels commit mentions as evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibetasks-audit-git-'));
    try {
      execFileSync('git', ['init'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'audit@example.com'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'Audit Test'], { cwd: root });
      writeFileSync(join(root, 'exists.ts'), 'export const value = 1;\n');
      execFileSync('git', ['add', 'exists.ts'], { cwd: root });
      execFileSync('git', ['commit', '-m', 'feat: implement #1'], { cwd: root });

      const project = repo.createProject(db, { name: 'P', source: 'you' });
      db.prepare('UPDATE project SET repo_path=? WHERE id=?').run(root, project.id);
      const task = repo.addTask(db, {
        project_id: project.id,
        title: 'Implement',
        summary: 'Implement it',
        priority: 'high',
        kind: 'feature',
        paths: ['exists.ts', 'missing.ts'],
        source: 'you',
      });

      const result = auditBoard(db, project.id, { git_log_limit: 10 }) as any;
      expect(task.ref).toBe(1);
      expect(result.repository.available).toBe(true);
      expect(result.repository.commit_mentions).toContainEqual(expect.objectContaining({
        task_ref: 1,
        subject: 'feat: implement #1',
      }));
      expect(result.repository.scope_paths).toEqual(expect.arrayContaining([
        { task_ref: 1, path: 'exists.ts', status: 'exists' },
        { task_ref: 1, path: 'missing.ts', status: 'missing' },
      ]));
      expect(result.repository.caveat).toMatch(/evidence only/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('applyBoardAudit', () => {
  it('previews without mutation, then applies additions, updates, links, ordering, and recap atomically', () => {
    const project = repo.createProject(db, { name: 'P', source: 'you' });
    const first = repo.addTask(db, {
      project_id: project.id,
      title: 'First',
      status: 'next',
      priority: 'med',
      kind: 'feature',
      source: 'you',
    });
    const second = repo.addTask(db, {
      project_id: project.id,
      title: 'Second',
      status: 'next',
      priority: 'med',
      kind: 'feature',
      source: 'you',
    });
    const plan = {
      updates: [{
        task: `#${first.ref}`,
        status: 'now' as const,
        summary: 'Actively shipping',
        paths: ['src/first.ts'],
      }],
      additions: [{
        key: 'followup',
        title: 'Follow up',
        summary: 'New related work',
        priority: 'low' as const,
        kind: 'chore' as const,
        status: 'next' as const,
      }],
      links: [{
        action: 'link' as const,
        from: `#${second.ref}`,
        to: '$followup',
        type: 'related' as const,
      }],
      order: [
        { status: 'now' as const, tasks: [`#${first.ref}`] },
        { status: 'next' as const, tasks: ['$followup', `#${second.ref}`] },
      ],
      recap: '2026-06-08: Audited and reorganized the board; implementation is next.',
    };

    const preview = applyBoardAudit(db, project.id, plan) as any;
    expect(preview.mode).toBe('preview');
    expect(repo.countProjectTasks(db, project.id)).toBe(2);
    expect(repo.getTask(db, first.id)!.status).toBe('next');

    const applied = applyBoardAudit(db, project.id, { ...plan, confirm: true }) as any;
    expect(applied.mode).toBe('applied');
    expect(applied.created).toHaveLength(1);
    expect(repo.countProjectTasks(db, project.id)).toBe(3);
    expect(repo.getTask(db, first.id)).toMatchObject({
      status: 'now',
      summary: 'Actively shipping',
      paths: ['src/first.ts'],
    });
    const next = repo.listProjectTasks(db, project.id)
      .filter(task => task.status === 'next');
    expect(next.map(task => task.title)).toEqual(['Follow up', 'Second']);
    expect(repo.getMap(db, project.id).edges).toContainEqual({
      from_task_id: second.id,
      to_task_id: applied.created[0].id,
      type: 'related',
    });
    expect(repo.getNotes(db, project.id)!.recap).toMatch(/Audited and reorganized/);
  });

  it('rejects an incomplete final column order without mutating anything', () => {
    const project = repo.createProject(db, { name: 'P', source: 'you' });
    const first = repo.addTask(db, { project_id: project.id, title: 'First', source: 'you' });
    const second = repo.addTask(db, { project_id: project.id, title: 'Second', source: 'you' });

    expect(() => applyBoardAudit(db, project.id, {
      updates: [{ task: `#${first.ref}`, status: 'now' }],
      order: [{ status: 'next', tasks: [] }],
      confirm: true,
    })).toThrow(/must list every final task/i);

    expect(repo.countProjectTasks(db, project.id)).toBe(2);
    expect(repo.getTask(db, first.id)!.status).toBe('next');
    expect(repo.getTask(db, second.id)!.status).toBe('next');
  });

  it('rolls back earlier writes when a later database constraint fails', () => {
    const project = repo.createProject(db, { name: 'P', source: 'you' });
    const task = repo.addTask(db, {
      project_id: project.id,
      title: 'Existing',
      priority: 'med',
      kind: 'feature',
      source: 'you',
    });

    expect(() => applyBoardAudit(db, project.id, {
      additions: [{
        key: 'created_before_failure',
        title: 'Should roll back',
        priority: 'low',
        kind: 'chore',
      }],
      updates: [{ task: `#${task.ref}`, priority: 'invalid' as any }],
      confirm: true,
    })).toThrow();

    expect(repo.countProjectTasks(db, project.id)).toBe(1);
    expect(repo.getTask(db, task.id)!.priority).toBe('med');
  });
});
