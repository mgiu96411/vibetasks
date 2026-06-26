import type { Database } from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Kind, LinkType, Priority, Status, Task } from 'shared';
import * as repo from './repo.js';

const ACTIVE_STATUSES = new Set<Status>(['now', 'next', 'later']);
const CLOSED_STATUSES = new Set<Status>(['complete', 'dropped']);
const DETAIL_CAP = 2000;
const BRIEF_CAP = 240;
const MAX_GIT_LINES = 200;

const cap = (value: string, limit: number): string =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

const taskLabel = (task: Pick<Task, 'ref' | 'title'>): string => `#${task.ref} ${task.title}`;

type Finding = {
  code: string;
  severity: 'info' | 'warning';
  task_refs: number[];
  message: string;
  fields?: string[];
};

type AuditOptions = {
  repo_path?: string;
  stale_after_days?: number;
  git_log_limit?: number;
};

type AuditUpdate = {
  task: string;
  title?: string;
  summary?: string;
  description?: string;
  priority?: Priority;
  kind?: Kind;
  version?: string;
  status?: Status;
  paths?: string[];
  symbols?: string[];
};

type AuditAddition = {
  key: string;
  title: string;
  summary?: string;
  description?: string;
  priority: Exclude<Priority, 'none'>;
  kind: Exclude<Kind, 'none'>;
  version?: string;
  status?: Status;
  paths?: string[];
  symbols?: string[];
};

type AuditLink = {
  action: 'link' | 'unlink';
  from: string;
  to: string;
  type: LinkType;
};

type AuditOrder = {
  status: Status;
  tasks: string[];
};

export type BoardAuditPlan = {
  updates?: AuditUpdate[];
  additions?: AuditAddition[];
  links?: AuditLink[];
  order?: AuditOrder[];
  recap?: string;
  confirm?: boolean;
};

function compactTask(task: Task, includeDetails: boolean) {
  return {
    id: task.id,
    ref: task.ref,
    title: task.title,
    brief: cap(task.summary, BRIEF_CAP),
    ...(includeDetails ? { details: cap(task.description, DETAIL_CAP) } : {}),
    status: task.status,
    priority: task.priority,
    kind: task.kind,
    version: task.version,
    parent_id: task.parent_id,
    paths: task.paths,
    symbols: task.symbols,
    reopened_at: task.reopened_at,
    updated_at: task.updated_at,
  };
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function gitLines(repoPath: string, args: string[]): string[] {
  const output = execFileSync('git', ['--no-optional-locks', '-C', repoPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_PAGER: 'cat' },
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output.split('\n').map(line => line.trimEnd()).filter(Boolean);
}

function optionalGitLines(repoPath: string, args: string[]): string[] {
  try {
    return gitLines(repoPath, args);
  } catch {
    return [];
  }
}

function repositoryEvidence(projectRepoPath: string | null, explicitRepoPath: string | undefined,
  tasks: Task[], gitLogLimit: number) {
  const requestedPath = explicitRepoPath?.trim() || projectRepoPath?.trim();
  if (!requestedPath) {
    return { available: false, reason: 'No repo_path argument or project repo path is configured.' };
  }
  if (!isAbsolute(requestedPath)) {
    return {
      available: false,
      requested_path: requestedPath,
      reason: 'Repository path must be absolute; relative paths are not resolved against the MCP process directory.',
    };
  }

  const candidate = resolve(requestedPath);
  try {
    if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
      return { available: false, requested_path: candidate, reason: 'Repository path is not a directory.' };
    }
    const root = gitLines(candidate, ['rev-parse', '--show-toplevel'])[0];
    if (!root) return { available: false, requested_path: candidate, reason: 'Git root was not found.' };

    const requestedLimit = Number.isFinite(gitLogLimit) ? gitLogLimit : 80;
    const limit = Math.max(1, Math.min(requestedLimit, MAX_GIT_LINES));
    const status = optionalGitLines(root, ['status', '--short']).slice(0, MAX_GIT_LINES);
    const log = optionalGitLines(root, [
      'log',
      `-${limit}`,
      '--date=short',
      '--pretty=format:%h%x09%ad%x09%s',
    ]).map(line => {
      const [hash, date, ...subject] = line.split('\t');
      return { hash, date, subject: subject.join('\t') };
    });
    const tags = optionalGitLines(root, [
      'for-each-ref',
      '--sort=-creatordate',
      '--format=%(refname:short)',
      'refs/tags',
    ]).slice(0, 50);

    const commit_mentions = tasks.flatMap(task => {
      const pattern = new RegExp(`(^|\\D)#${task.ref}(\\D|$)`);
      return log.filter(commit => pattern.test(commit.subject))
        .map(commit => ({ task_ref: task.ref, ...commit }));
    });

    const scope_paths = tasks.flatMap(task => task.paths.map(taskPath => {
      if (/[*?[\]{}]/.test(taskPath)) {
        return { task_ref: task.ref, path: taskPath, status: 'pattern' };
      }
      const absolute = isAbsolute(taskPath) ? resolve(taskPath) : resolve(root, taskPath);
      const rel = relative(root, absolute);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        return { task_ref: task.ref, path: taskPath, status: 'outside_repo' };
      }
      return {
        task_ref: task.ref,
        path: taskPath,
        status: existsSync(absolute) ? 'exists' : 'missing',
      };
    }));

    return {
      available: true,
      requested_path: candidate,
      root,
      status,
      recent_commits: log,
      tags,
      commit_mentions,
      scope_paths,
      caveat: 'Commit mentions and path existence are evidence only; inspect targeted code before changing task status.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { available: false, requested_path: candidate, reason: `Git inspection failed: ${message}` };
  }
}

export function auditBoard(db: Database, projectId: string, options: AuditOptions = {}) {
  const project = repo.findProject(db, projectId);
  if (!project) throw new Error(`No project matching "${projectId}".`);
  const tasks = repo.listProjectTasks(db, projectId);
  const active = tasks.filter(task => ACTIVE_STATUSES.has(task.status));
  const closed = tasks.filter(task => CLOSED_STATUSES.has(task.status));
  const byId = new Map(tasks.map(task => [task.id, task]));
  const edges = repo.getMap(db, projectId).edges;
  const childIds = new Map<string, string[]>();
  tasks.forEach(task => {
    if (!task.parent_id) return;
    childIds.set(task.parent_id, [...(childIds.get(task.parent_id) ?? []), task.id]);
  });

  const relationIds = new Map(tasks.map(task => [task.id, new Set<string>()]));
  childIds.forEach((children, parent) => children.forEach(child => {
    relationIds.get(parent)?.add(child);
    relationIds.get(child)?.add(parent);
  }));
  edges.forEach(edge => {
    relationIds.get(edge.from_task_id)?.add(edge.to_task_id);
    relationIds.get(edge.to_task_id)?.add(edge.from_task_id);
  });

  const findings: Finding[] = [];
  for (const task of active) {
    const missing = [
      ...(task.priority === 'none' ? ['priority'] : []),
      ...(task.kind === 'none' ? ['kind'] : []),
      ...(!task.summary.trim() ? ['brief'] : []),
      ...(task.paths.length === 0 ? ['scope_paths'] : []),
    ];
    if (missing.length) {
      findings.push({
        code: 'missing_metadata',
        severity: 'warning',
        task_refs: [task.ref],
        message: `${taskLabel(task)} is missing ${missing.join(', ')}.`,
        fields: missing,
      });
    }
    if (task.reopened_at) {
      findings.push({
        code: 'reopened',
        severity: 'warning',
        task_refs: [task.ref],
        message: `${taskLabel(task)} was reopened and needs completion or re-scoping.`,
      });
    }
    if ((relationIds.get(task.id)?.size ?? 0) === 0) {
      findings.push({
        code: 'isolated_active',
        severity: 'info',
        task_refs: [task.ref],
        message: `${taskLabel(task)} has no parent, child, dependency, or related-task connection.`,
      });
    }
  }

  const staleDays = Math.max(1, options.stale_after_days ?? 30);
  const staleBefore = Date.now() - staleDays * 24 * 60 * 60 * 1000;
  active.forEach(task => {
    const updated = Date.parse(task.updated_at);
    if (Number.isFinite(updated) && updated < staleBefore) {
      findings.push({
        code: 'stale_active',
        severity: 'warning',
        task_refs: [task.ref],
        message: `${taskLabel(task)} has not changed in at least ${staleDays} days.`,
      });
    }
  });

  edges.forEach(edge => {
    if (edge.type !== 'depends_on') return;
    const from = byId.get(edge.from_task_id);
    const to = byId.get(edge.to_task_id);
    if (from && to && ACTIVE_STATUSES.has(from.status) && to.status === 'dropped') {
      findings.push({
        code: 'depends_on_dropped',
        severity: 'warning',
        task_refs: [from.ref, to.ref],
        message: `${taskLabel(from)} depends on dropped ${taskLabel(to)}.`,
      });
    }
  });

  active.forEach(parent => {
    const children = (childIds.get(parent.id) ?? []).map(id => byId.get(id)!).filter(Boolean);
    if (children.length && children.every(child => CLOSED_STATUSES.has(child.status))) {
      findings.push({
        code: 'all_children_closed',
        severity: 'info',
        task_refs: [parent.ref, ...children.map(child => child.ref)],
        message: `${taskLabel(parent)} has only closed children and may be ready to close or rewrite.`,
      });
    }
  });

  const titleGroups = new Map<string, Task[]>();
  tasks.forEach(task => {
    const key = normalizeTitle(task.title);
    if (key) titleGroups.set(key, [...(titleGroups.get(key) ?? []), task]);
  });
  titleGroups.forEach(group => {
    if (group.length < 2 || !group.some(task => ACTIVE_STATUSES.has(task.status))) return;
    findings.push({
      code: 'duplicate_title',
      severity: 'warning',
      task_refs: group.map(task => task.ref),
      message: `Tasks ${group.map(taskLabel).join(', ')} have duplicate normalized titles.`,
    });
  });

  const activeIds = new Set(active.map(task => task.id));
  const seen = new Set<string>();
  const components: number[][] = [];
  for (const task of active) {
    if (seen.has(task.id)) continue;
    const stack = [task.id];
    const refs: number[] = [];
    seen.add(task.id);
    while (stack.length) {
      const id = stack.pop()!;
      const current = byId.get(id);
      if (current) refs.push(current.ref);
      relationIds.get(id)?.forEach(next => {
        if (activeIds.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      });
    }
    components.push(refs.sort((a, b) => a - b));
  }

  return {
    project: { id: project.id, name: project.name, repo_path: project.repo_path },
    generated_at: new Date().toISOString(),
    parameters: { stale_after_days: staleDays, git_log_limit: options.git_log_limit ?? 80 },
    active: active.map(task => compactTask(task, true)),
    closed: closed.map(task => compactTask(task, false)),
    relations: {
      links: edges.map(edge => {
        const from = byId.get(edge.from_task_id)!;
        const to = byId.get(edge.to_task_id)!;
        return {
          from_ref: from.ref,
          from_status: from.status,
          to_ref: to.ref,
          to_status: to.status,
          type: edge.type,
        };
      }),
      parent_children: [...childIds.entries()].map(([parentId, children]) => ({
        parent_ref: byId.get(parentId)?.ref,
        child_refs: children.map(id => byId.get(id)?.ref).filter((ref): ref is number => ref !== undefined),
      })),
      active_components: components,
      isolated_active_refs: active
        .filter(task => (relationIds.get(task.id)?.size ?? 0) === 0)
        .map(task => task.ref),
    },
    findings,
    repository: repositoryEvidence(
      project.repo_path,
      options.repo_path,
      active,
      options.git_log_limit ?? 80,
    ),
    workflow: [
      'Treat findings and git evidence as review leads, not automatic status decisions.',
      'Inspect targeted repository files before declaring a task complete, stale, superseded, or unrelated.',
      'Build a reviewed reorganization plan, call apply_board_audit without confirm for validation, then repeat with confirm=true.',
    ],
  };
}

type ResolvedSelector = {
  key: string;
  label: string;
  task?: Task;
  alias?: string;
};

type PreparedPlan = {
  preview: Record<string, unknown>;
  updates: { input: AuditUpdate; resolved: ResolvedSelector }[];
  additions: AuditAddition[];
  links: { input: AuditLink; from: ResolvedSelector; to: ResolvedSelector }[];
  order: { status: Status; resolved: ResolvedSelector[] }[];
};

function preparePlan(db: Database, projectId: string, plan: BoardAuditPlan): PreparedPlan {
  const tasks = repo.listProjectTasks(db, projectId);
  const labels = new Map(tasks.map(task => [task.id, `#${task.ref}`]));
  const additions = plan.additions ?? [];
  const aliasKeys = new Set<string>();
  additions.forEach(addition => {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(addition.key)) {
      throw new Error(`Addition key "${addition.key}" must start with a letter and contain only letters, numbers, _ or -.`);
    }
    if (aliasKeys.has(addition.key)) throw new Error(`Duplicate addition key "$${addition.key}".`);
    if (!addition.title.trim()) throw new Error(`Addition "$${addition.key}" needs a title.`);
    if (!['low', 'med', 'high'].includes(addition.priority) ||
        !['fix', 'feature', 'chore', 'rule', 'docs'].includes(addition.kind)) {
      throw new Error(`Addition "$${addition.key}" requires a non-none priority and kind.`);
    }
    aliasKeys.add(addition.key);
    labels.set(`alias:${addition.key}`, `$${addition.key}`);
  });

  const resolveSelector = (selector: string, allowAlias: boolean): ResolvedSelector => {
    const value = selector.trim();
    if (value.startsWith('$')) {
      const alias = value.slice(1);
      if (!allowAlias) throw new Error(`Selector "${selector}" cannot refer to a new task here.`);
      if (!aliasKeys.has(alias)) throw new Error(`Unknown addition selector "${selector}".`);
      return { key: `alias:${alias}`, label: `$${alias}`, alias };
    }
    const task = repo.resolveTaskInProject(db, projectId, value);
    if (!task) throw new Error(`No task matching "${selector}" in this project.`);
    return { key: task.id, label: `#${task.ref}`, task };
  };

  const updateIds = new Set<string>();
  const updates = (plan.updates ?? []).map(input => {
    const resolved = resolveSelector(input.task, false);
    if (updateIds.has(resolved.key)) throw new Error(`Task ${resolved.label} is updated more than once.`);
    if (Object.keys(input).every(key => key === 'task' || input[key as keyof AuditUpdate] === undefined)) {
      throw new Error(`Update for ${resolved.label} has no fields.`);
    }
    updateIds.add(resolved.key);
    return { input, resolved };
  });

  const finalStatuses = new Map(tasks.map(task => [task.id, task.status]));
  updates.forEach(({ input, resolved }) => {
    if (input.status) finalStatuses.set(resolved.key, input.status);
  });
  additions.forEach(addition => finalStatuses.set(`alias:${addition.key}`, addition.status ?? 'next'));

  const links = (plan.links ?? []).map(input => {
    const from = resolveSelector(input.from, true);
    const to = resolveSelector(input.to, true);
    if (from.key === to.key) throw new Error(`Refusing self-link for ${from.label}.`);
    if (input.action === 'unlink' && (from.alias || to.alias)) {
      throw new Error(`Cannot unlink a newly added task (${from.label} -> ${to.label}).`);
    }
    return { input, from, to };
  });
  const linkKeys = new Set<string>();
  links.forEach(({ input, from, to }) => {
    const key = `${from.key}\0${to.key}\0${input.type}`;
    if (linkKeys.has(key)) {
      throw new Error(`Link ${from.label} -> ${to.label} (${input.type}) is changed more than once.`);
    }
    linkKeys.add(key);
  });

  const orderStatuses = new Set<Status>();
  const order = (plan.order ?? []).map(entry => {
    if (orderStatuses.has(entry.status)) throw new Error(`Column "${entry.status}" is ordered more than once.`);
    orderStatuses.add(entry.status);
    const resolved = entry.tasks.map(selector => resolveSelector(selector, true));
    const actual = new Set(resolved.map(item => item.key));
    if (actual.size !== resolved.length) throw new Error(`Order for "${entry.status}" contains a duplicate task.`);
    const expected = new Set([...finalStatuses.entries()]
      .filter(([, status]) => status === entry.status)
      .map(([key]) => key));
    const missing = [...expected].filter(key => !actual.has(key)).map(key => labels.get(key) ?? key);
    const unexpected = [...actual].filter(key => !expected.has(key)).map(key => labels.get(key) ?? key);
    if (missing.length || unexpected.length) {
      throw new Error(
        `Order for "${entry.status}" must list every final task in that column exactly once.` +
        `${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}` +
        `${unexpected.length ? ` Unexpected: ${unexpected.join(', ')}.` : ''}`,
      );
    }
    return { status: entry.status, resolved };
  });

  const preview = {
    mode: 'preview',
    project_id: projectId,
    counts: {
      updates: updates.length,
      additions: additions.length,
      link_changes: links.length,
      ordered_columns: order.length,
      recap: plan.recap !== undefined,
    },
    updates: updates.map(({ input, resolved }) => ({
      task: resolved.label,
      fields: Object.keys(input).filter(key => key !== 'task' && input[key as keyof AuditUpdate] !== undefined),
      status: input.status,
    })),
    additions: additions.map(addition => ({
      selector: `$${addition.key}`,
      title: addition.title,
      status: addition.status ?? 'next',
      priority: addition.priority,
      kind: addition.kind,
    })),
    links: links.map(({ input, from, to }) => ({
      action: input.action,
      from: from.label,
      to: to.label,
      type: input.type,
    })),
    order: order.map(entry => ({
      status: entry.status,
      tasks: entry.resolved.map(item => item.label),
    })),
    confirm_instruction: 'Review this preview, then repeat the same call with confirm=true to apply it atomically.',
  };

  if (!updates.length && !additions.length && !links.length && !order.length && plan.recap === undefined) {
    throw new Error('Board audit plan is empty.');
  }

  return { preview, updates, additions, links, order };
}

export function applyBoardAudit(db: Database, projectId: string, plan: BoardAuditPlan) {
  if (!plan.confirm) return preparePlan(db, projectId, plan).preview;

  const run = db.transaction(() => {
    const prepared = preparePlan(db, projectId, plan);
    const aliases = new Map<string, Task>();
    for (const addition of prepared.additions) {
      aliases.set(addition.key, repo.addTask(db, {
        project_id: projectId,
        title: addition.title,
        summary: addition.summary,
        description: addition.description,
        priority: addition.priority,
        kind: addition.kind,
        version: addition.version,
        status: addition.status,
        paths: addition.paths,
        symbols: addition.symbols,
        source: 'claude',
      }));
    }

    for (const { input, resolved } of prepared.updates) {
      const { task: _selector, status, ...fields } = input;
      if (status && status !== resolved.task!.status) repo.moveTask(db, resolved.task!.id, status);
      repo.updateTask(db, resolved.task!.id, fields);
    }

    const resolvedId = (selector: ResolvedSelector): string =>
      selector.task?.id ?? aliases.get(selector.alias!)!.id;

    for (const { input, from, to } of prepared.links) {
      const fromId = resolvedId(from);
      const toId = resolvedId(to);
      if (input.action === 'link') repo.linkTasks(db, fromId, toId, input.type);
      else repo.unlinkTasks(db, fromId, toId, input.type);
    }

    for (const entry of prepared.order) {
      repo.reorderTasks(db, entry.resolved.map(resolvedId));
    }
    if (plan.recap !== undefined) repo.setRecap(db, projectId, plan.recap);

    return {
      ...prepared.preview,
      mode: 'applied',
      created: [...aliases.entries()].map(([key, task]) => ({
        selector: `$${key}`,
        id: task.id,
        ref: task.ref,
        title: task.title,
      })),
      confirm_instruction: undefined,
    };
  });

  return run();
}
