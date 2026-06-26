import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Database } from 'better-sqlite3';
import * as r from './repo.js';
import * as audit from './audit.js';
import { basename } from 'node:path';

export function registerTools(s: McpServer, db: Database) {
  const resolveOpts = (name?: string) => ({
    explicit: name,
    envProject: process.env.VIBETASKS_PROJECT,
    cwdBase: basename(process.cwd()),
  });
  // Reads never create a board (a miss throws, listing existing boards); writes may
  // bootstrap a fresh repo but won't mint a parallel board from a typed name. See repo.ts.
  const projR = (name?: string) => r.resolveForRead(db, resolveOpts(name));
  const projW = (name?: string) => r.resolveForWrite(db, resolveOpts(name));
  const spaceId = (space?: string) => {
    if (!space) return undefined;
    const found = r.findSpace(db, space);
    if (!found) throw new Error(`No space matching "${space}".`);
    return found.id;
  };
  const ok = (id?: string) => ({ content: [{ type: 'text' as const, text: id ? `ok ${id}` : 'ok' }] });
  const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
  const briefField = z.string().max(240).describe(
    'Brief: one short map-visible sentence/handle, not the full task body. Stored in the legacy summary column.',
  );
  const detailsField = z.string().describe(
    'Details: full task body, constraints, acceptance criteria, edge cases, and implementation notes. Stored in the legacy description column.',
  );
  const legacySummaryField = z.string().max(240).describe('Legacy alias for brief. Prefer brief.');
  const legacyDescriptionField = z.string().describe('Legacy alias for details. Prefer details.');
  const textFields = {
    brief: briefField.optional(),
    details: detailsField.optional(),
    summary: legacySummaryField.optional(),
    description: legacyDescriptionField.optional(),
  };
  const normalizeTextFields = (a: {
    brief?: string; details?: string; summary?: string; description?: string;
  }) => {
    if (a.brief !== undefined && a.summary !== undefined && a.brief !== a.summary) {
      throw new Error('Use brief or legacy summary, not both with different values.');
    }
    if (a.details !== undefined && a.description !== undefined && a.details !== a.description) {
      throw new Error('Use details or legacy description, not both with different values.');
    }
    return {
      summary: a.brief ?? a.summary,
      description: a.details ?? a.description,
    };
  };
  const statusField = z.enum(['now', 'next', 'later', 'complete', 'dropped']);
  const priorityField = z.enum(['none', 'low', 'med', 'high']);
  const kindField = z.enum(['none', 'fix', 'feature', 'chore', 'rule', 'docs']);
  const auditUpdate = z.object({
    task: z.string().describe('Existing task selector: #ref or task id.'),
    title: z.string().optional(),
    ...textFields,
    priority: priorityField.optional(),
    kind: kindField.optional(),
    version: z.string().optional(),
    status: statusField.optional(),
    paths: z.array(z.string()).optional(),
    symbols: z.array(z.string()).optional(),
  });
  const auditAddition = z.object({
    key: z.string().describe('Batch-local key; later operations refer to it as $key.'),
    title: z.string(),
    ...textFields,
    priority: z.enum(['low', 'med', 'high']),
    kind: z.enum(['fix', 'feature', 'chore', 'rule', 'docs']),
    version: z.string().optional(),
    status: statusField.optional(),
    paths: z.array(z.string()).optional(),
    symbols: z.array(z.string()).optional(),
  });

  s.tool('list_spaces', 'List project spaces.', {}, async () => json(r.listSpaces(db)));
  s.tool('list_projects', 'List projects, including each project space_id.', {}, async () => json(r.listProjects(db)));
  s.tool('get_board', 'Compact board: all task cards (with has_details), capped Now Brief+Details, reopened list.', { project: z.string().optional() },
    async ({ project }) => json(r.getBoard(db, projR(project))));
  s.tool('get_map', 'Task map: capped Briefs, has_details, deps, refs; no Details bodies.', { project: z.string().optional() },
    async ({ project }) => json(r.getMap(db, projR(project))));
  s.tool('list_tasks', 'List refs, titles, status, priority, kind.', { project: z.string().optional() },
    async ({ project }) => json(r.listTasks(db, projR(project))));
  s.tool('get_task', 'Full Details body for one task.', { id: z.string() }, async ({ id }) => json(r.getTask(db, id)));
  s.tool('resume', 'Cheap resume. Map omitted unless include_map=true; Now includes capped Brief+Details.', { project: z.string().optional(), include_map: z.boolean().optional() },
    async ({ project, include_map }) => json(r.resume(db, projR(project), { include_map })));
  s.tool('audit_board', 'Audit active tasks, closed-task context, relationship gaps, stale metadata, and safe read-only git evidence.', {
    project: z.string().optional(),
    repo_path: z.string().optional().describe('Explicit repository path; overrides the project repo_path.'),
    stale_after_days: z.number().int().min(1).max(3650).optional(),
    git_log_limit: z.number().int().min(1).max(200).optional(),
  }, async ({ project, repo_path, stale_after_days, git_log_limit }) =>
    json(audit.auditBoard(db, projR(project), { repo_path, stale_after_days, git_log_limit })));
  s.tool('apply_board_audit', 'Preview, then atomically apply a reviewed board-audit plan. Dry-run unless confirm=true; no deletes.', {
    project: z.string().optional(),
    updates: z.array(auditUpdate).optional(),
    additions: z.array(auditAddition).optional(),
    links: z.array(z.object({
      action: z.enum(['link', 'unlink']),
      from: z.string().describe('Existing #ref/id or batch-local $key.'),
      to: z.string().describe('Existing #ref/id or batch-local $key.'),
      type: z.enum(['depends_on', 'related']),
    })).optional(),
    order: z.array(z.object({
      status: statusField,
      tasks: z.array(z.string()).describe('Complete final order for this column; use #ref/id or $key.'),
    })).optional(),
    recap: z.string().optional(),
    confirm: z.boolean().optional(),
  }, async ({ project, updates, additions, ...plan }) => {
    const normalizeUpdates = updates?.map(({ brief, details, summary, description, ...fields }) => ({
      ...fields,
      ...normalizeTextFields({ brief, details, summary, description }),
    }));
    const normalizeAdditions = additions?.map(({ brief, details, summary, description, ...fields }) => ({
      ...fields,
      ...normalizeTextFields({ brief, details, summary, description }),
    }));
    return json(audit.applyBoardAudit(db, projR(project), {
      ...plan,
      updates: normalizeUpdates,
      additions: normalizeAdditions,
    }));
  });
  s.tool('add_task', 'Add a task; defaults to Next. Use brief for the one-line handle and details for the body.', { project: z.string().optional(), title: z.string(),
    ...textFields,
    priority: priorityField.optional(), kind: kindField.optional(),
    version: z.string().optional(),
    status: statusField.optional(),
    paths: z.array(z.string()).optional(), symbols: z.array(z.string()).optional() },
    async (a) => {
      const { project, brief, details, summary, description, ...fields } = a;
      return ok(r.addTask(db, {
        ...fields,
        ...normalizeTextFields({ brief, details, summary, description }),
        project_id: projW(project),
        source: 'claude',
      }).id);
    });
  s.tool('add_tasks', 'Bulk add tasks to Next (one round-trip)', { project: z.string().optional(), titles: z.array(z.string()) },
    async ({ project, titles }) => { const pid = projW(project); titles.forEach(t => r.addTask(db, { project_id: pid, title: t, source: 'claude' })); return ok(); });
  s.tool('add_subtask', 'Add a subtask under a parent', { parent_id: z.string(), title: z.string() },
    async ({ parent_id, title }) => {
      const parent = r.getTask(db, parent_id);
      if (!parent) return text(`No task matching "${parent_id}".`);
      return ok(r.addTask(db, { project_id: parent.project_id, parent_id, title, source: 'claude' }).id);
    });
  s.tool('update_task', 'Update task fields. Prefer brief/details; summary/description are legacy aliases.', { id: z.string(), title: z.string().optional(), ...textFields,
    priority: priorityField.optional(),
    kind: kindField.optional(),
    version: z.string().optional(),
    status: statusField.optional() },
    async ({ id, brief, details, summary, description, ...f }) => {
      r.updateTask(db, id, { ...f, ...normalizeTextFields({ brief, details, summary, description }) });
      return ok(id);
    });
  s.tool('move_task', 'Move a task to a column: now | next | later | complete | dropped. Moving a task OUT of complete flags it as reopened (surfaced by get_board/resume).', { id: z.string(), status: statusField },
    async ({ id, status }) => { r.moveTask(db, id, status); return ok(id); });
  s.tool('reorder_tasks', 'Reorder by id list', { ids: z.array(z.string()) }, async ({ ids }) => { r.reorderTasks(db, ids); return ok(); });
  s.tool('delete_task', 'Delete a task', { id: z.string() }, async ({ id }) => { r.deleteTask(db, id); return ok(); });
  s.tool('set_refs', 'Set code refs (paths/symbols)', { id: z.string(), paths: z.array(z.string()).optional(), symbols: z.array(z.string()).optional() },
    async ({ id, paths, symbols }) => { r.setRefs(db, id, paths, symbols); return ok(id); });
  s.tool('link_tasks', 'Link tasks (depends_on|related)', { from: z.string(), to: z.string(), type: z.enum(['depends_on', 'related']) },
    async ({ from, to, type }) => { r.linkTasks(db, from, to, type); return ok(); });
  s.tool('unlink_tasks', 'Remove a task link', { from: z.string(), to: z.string(), type: z.enum(['depends_on', 'related']) },
    async ({ from, to, type }) => { r.unlinkTasks(db, from, to, type); return ok(); });
  s.tool('get_notes', 'Get project notes (freeform body + the walk-away recap)', { project: z.string().optional() }, async ({ project }) => json(r.getNotes(db, projR(project))));
  s.tool('set_notes', 'Replace the project freeform notes body', { project: z.string().optional(), body: z.string() }, async ({ project, body }) => { r.setNotes(db, projW(project), body); return ok(); });
  s.tool('set_recap', 'Write the project walk-away "last session" recap — short, dated, past-tense: what we did, how the open thread resolved, what is next. Shown to the human on return + in resume(). Call it at wrap-up. Stored separately from notes (never clobbers them).', { project: z.string().optional(), recap: z.string() }, async ({ project, recap }) => { r.setRecap(db, projW(project), recap); return ok(); });
  s.tool('get_goal', 'Get the project next-goal (milestone + subgoals + following_goal). Included automatically in get_board/resume when set.', { project: z.string().optional() }, async ({ project }) => json(r.getGoal(db, projR(project))));
  s.tool('set_goal', 'Set or replace the project next-goal used for milestone-driven prioritization. Pass empty strings to clear subgoals/following_goal. Omit project to use the session default.',
    { project: z.string().optional(), goal: z.string(), subgoals: z.array(z.string()).default([]), following_goal: z.string().default('') },
    async ({ project, goal, subgoals, following_goal }) => { r.setGoal(db, projW(project), { goal, subgoals, following_goal }); return ok(); });
  s.tool('create_space', 'Create a project space.', { name: z.string() },
    async ({ name }) => ok(r.createSpace(db, name).id));
  s.tool('rename_space', 'Rename a project space by exact name or id.',
    { space: z.string(), name: z.string() },
    async ({ space, name }) => {
      const found = r.findSpace(db, space);
      if (!found) return text(`No space matching "${space}".`);
      r.renameSpace(db, found.id, name);
      return ok(found.id);
    });
  s.tool('delete_space', 'Delete an empty project space. The default space is protected.',
    { space: z.string() },
    async ({ space }) => {
      const found = r.findSpace(db, space);
      if (!found) return text(`No space matching "${space}".`);
      const count = r.countSpaceProjects(db, found.id);
      if (count > 0) return text(`Refusing: "${found.name}" contains ${count} project(s). Move them first.`);
      r.deleteSpace(db, found.id);
      return ok();
    });
  s.tool('move_project_to_space', 'Move a project into a space.',
    { project: z.string(), space: z.string() },
    async ({ project, space }) => {
      const foundProject = r.findProject(db, project);
      const foundSpace = r.findSpace(db, space);
      if (!foundProject) return text(`No project matching "${project}".`);
      if (!foundSpace) return text(`No space matching "${space}".`);
      r.moveProjectToSpace(db, foundProject.id, foundSpace.id);
      return ok(foundProject.id);
    });
  s.tool('create_project', 'Create a project in Current projects or an explicit space.',
    { name: z.string(), color: z.string().optional(), space: z.string().optional() },
    async ({ name, color, space }) =>
      ok(r.createProject(db, { name, color, source: 'claude', space_id: spaceId(space) }).id));

  // ---- Project repair: fix messy/misnamed/duplicate boards without raw SQL ----
  s.tool('rename_project', 'Rename a project by exact name or id.',
    { project: z.string(), name: z.string() },
    async ({ project, name }) => {
      const p = r.findProject(db, project);
      if (!p) return text(`No project matching "${project}".`);
      r.renameProject(db, p.id, name);
      return ok(p.id);
    });
  s.tool('reassign_project_tasks', 'Move all tasks from one project into another.',
    { from: z.string(), into: z.string() },
    async ({ from, into }) => {
      const a = r.findProject(db, from);
      const b = r.findProject(db, into);
      if (!a || !b) return text(`No project matching ${!a ? `"${from}"` : `"${into}"`}.`);
      if (a.id === b.id) return text('Source and destination are the same project — nothing to do.');
      const moved = r.reassignProjectTasks(db, a.id, b.id);
      return text(`Moved ${moved} task(s) from "${a.name}" into "${b.name}". The empty "${a.name}" can now be delete_project'd.`);
    });
  s.tool('delete_project', 'Delete a project; non-empty requires confirm:true.',
    { project: z.string(), confirm: z.boolean().optional() },
    async ({ project, confirm }) => {
      const p = r.findProject(db, project);
      if (!p) return text(`No project matching "${project}".`);
      const n = r.countProjectTasks(db, p.id);
      if (n > 0 && !confirm) return text(`Refusing: "${p.name}" has ${n} task(s). Reassign them first (reassign_project_tasks), or pass confirm:true to delete the board AND its tasks.`);
      r.deleteProject(db, p.id);
      return ok();
    });
}
