#!/usr/bin/env node
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import * as repo from './repo.js';
import type { Kind, Priority, Status, Task, TaskCard } from 'shared';

const STATUSES = ['now', 'next', 'later', 'complete', 'dropped'] as const;
const PRIORITIES = ['none', 'low', 'med', 'high'] as const;
const KINDS = ['none', 'fix', 'feature', 'chore', 'rule', 'docs'] as const;
const COMMANDS = new Set(['projects', 'list', 'board', 'now', 'task', 'add', 'move']);
const VALUE_FLAGS = new Set([
  'project', 'p', 'db', 'status', 'priority', 'kind', 'brief',
  'details', 'summary', 'description', 'path', 'symbol', 'version',
]);

type CliIo = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
};

type ParsedArgs = {
  command: string;
  args: string[];
  flags: Map<string, (string | true)[]>;
};

function usage(): string {
  return [
    'Vibe Tasks CLI (reversible facade over the MCP repo logic)',
    '',
    'Usage:',
    '  vibetasks projects [--json]',
    '  vibetasks list [--project NAME] [--json]',
    '  vibetasks board [--project NAME] [--json]',
    '  vibetasks now [--project NAME] [--json]',
    '  vibetasks task #REF [--project NAME] [--json]',
    '  vibetasks add TITLE [--project NAME] [--kind K] [--priority P] [--status S] [--brief TEXT] [--details TEXT]',
    '  vibetasks move #REF STATUS [--project NAME]',
    '',
    'Safety:',
    '  Writes go through repo.ts, not raw SQLite. No schema changes, no hooks.',
    '  Brief/Details are aliases over the existing summary/description columns.',
    '  Remove the bin entry and this file to roll the CLI surface back.',
    '',
    'Env:',
    '  VIBETASKS_DB       database path (default ~/.vibetasks/vibetasks.db)',
    '  VIBETASKS_PROJECT  default board name',
  ].join('\n');
}

function parseArgv(argv: string[]): ParsedArgs {
  const flags = new Map<string, (string | true)[]>();
  const args: string[] = [];

  const addFlag = (name: string, value: string | true) => {
    const key = name === 'p' ? 'project' : name;
    flags.set(key, [...(flags.get(key) ?? []), value]);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('-') || token === '-') {
      args.push(token);
      continue;
    }

    const trimmed = token.replace(/^-+/, '');
    const [rawName, inlineValue] = trimmed.split(/=(.*)/s, 2);
    if (VALUE_FLAGS.has(rawName)) {
      const value = inlineValue ?? argv[++i];
      if (value === undefined) throw new Error(`Missing value for --${rawName}`);
      addFlag(rawName, value);
    } else {
      addFlag(rawName, true);
    }
  }

  return { command: args[0] ?? 'help', args: args.slice(1), flags };
}

function flag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name)?.at(-1);
  return typeof value === 'string' ? value : undefined;
}

function flagValues(parsed: ParsedArgs, name: string): string[] | undefined {
  const values = parsed.flags.get(name)?.filter((v): v is string => typeof v === 'string');
  return values?.length ? values : undefined;
}

function aliasedFlag(parsed: ParsedArgs, canonical: string, legacy: string): string | undefined {
  const value = flag(parsed, canonical);
  const oldValue = flag(parsed, legacy);
  if (value !== undefined && oldValue !== undefined && value !== oldValue) {
    throw new Error(`Use --${canonical} or legacy --${legacy}, not both with different values.`);
  }
  return value ?? oldValue;
}

function parseBrief(value: string | undefined): string | undefined {
  if (value !== undefined && value.length > 240) {
    throw new Error('Brief must be 240 characters or fewer. Put the full body in --details.');
  }
  return value;
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${label} "${value}". Expected one of: ${allowed.join(', ')}`);
}

function dbPath(parsed: ParsedArgs, env: NodeJS.ProcessEnv): string {
  return flag(parsed, 'db') ?? env.VIBETASKS_DB ?? join(homedir(), '.vibetasks', 'vibetasks.db');
}

function resolveOpts(parsed: ParsedArgs, cwd: string, env: NodeJS.ProcessEnv) {
  return {
    explicit: flag(parsed, 'project'),
    envProject: env.VIBETASKS_PROJECT,
    cwdBase: basename(cwd),
  };
}

const q = (value: unknown): string => JSON.stringify(String(value ?? '').replace(/\s+/g, ' ').trim());

function projectName(db: ReturnType<typeof openDb>, projectId: string): string {
  return repo.listProjects(db).find((p) => p.id === projectId)?.name ?? projectId;
}

function cardLine(card: TaskCard, parentRef?: number): string {
  const extras = [
    card.version ? `v=${q(card.version)}` : '',
    card.source === 'you' ? 'src=you' : '',
    card.has_subtasks ? 'has_subtasks' : '',
    parentRef ? `parent=#${parentRef}` : '',
    card.reopened ? 'reopened' : '',
  ].filter(Boolean);
  return `C #${card.ref} ${card.status} ${card.priority} ${card.kind} ${q(card.title)}${extras.length ? ` ${extras.join(' ')}` : ''}`;
}

function listLine(task: { ref: number; status: string; priority: string; kind: string; title: string }): string {
  return `T #${task.ref} ${task.status} ${task.priority} ${task.kind} ${q(task.title)}`;
}

function taskBlock(task: Task): string {
  const lines = [
    `T #${task.ref} ${task.status} ${task.priority} ${task.kind} ${q(task.title)}`,
    `id ${task.id}`,
  ];
  if (task.summary) lines.push(`brief ${q(task.summary)}`);
  if (task.description) lines.push(`details ${q(task.description)}`);
  if (task.paths.length) lines.push(`paths ${task.paths.map(q).join(' ')}`);
  if (task.symbols.length) lines.push(`symbols ${task.symbols.map(q).join(' ')}`);
  if (task.version) lines.push(`version ${q(task.version)}`);
  if (task.reopened_at) lines.push(`reopened_at ${task.reopened_at}`);
  return lines.join('\n');
}

function emitJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function requireTask(db: ReturnType<typeof openDb>, projectId: string, refOrId: string): Task {
  const task = repo.resolveTaskInProject(db, projectId, refOrId);
  if (!task) throw new Error(`No task ${refOrId} in "${projectName(db, projectId)}".`);
  return task;
}

export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  const out = io.stdout ?? ((text: string) => process.stdout.write(text));
  const err = io.stderr ?? ((text: string) => process.stderr.write(text));
  const env = io.env ?? process.env;
  const cwd = io.cwd ?? process.cwd();
  let parsed: ParsedArgs;

  try {
    parsed = parseArgv(argv);
  } catch (e) {
    err(`error: ${(e as Error).message}\n`);
    return 1;
  }

  if (parsed.command === 'help' || hasFlag(parsed, 'help') || hasFlag(parsed, 'h')) {
    out(`${usage()}\n`);
    return 0;
  }

  if (!COMMANDS.has(parsed.command)) {
    err(`error: Unknown command "${parsed.command}". Run: vibetasks help\n`);
    return 1;
  }

  const db = openDb(dbPath(parsed, env));
  try {
    const json = hasFlag(parsed, 'json');
    const opts = resolveOpts(parsed, cwd, env);
    let text = '';

    if (parsed.command === 'projects') {
      const projects = repo.listProjects(db);
      if (json) {
        text = emitJson({ spaces: repo.listSpaces(db), projects });
      } else {
        const spaceNames = new Map(repo.listSpaces(db).map((space) => [space.id, space.name]));
        text = projects.map((p) =>
          `P ${q(p.name)} ${p.id} space=${q(spaceNames.get(p.space_id ?? '') ?? 'Current projects')}`,
        ).join('\n');
      }
    } else if (parsed.command === 'list') {
      const projectId = repo.resolveForRead(db, opts);
      const tasks = repo.listTasks(db, projectId);
      text = json ? emitJson({ project: projectName(db, projectId), tasks }) : tasks.map(listLine).join('\n');
    } else if (parsed.command === 'board') {
      const projectId = repo.resolveForRead(db, opts);
      const board = repo.getBoard(db, projectId);
      if (json) {
        text = emitJson({ project: projectName(db, projectId), ...board });
      } else {
        const counts = Object.fromEntries(STATUSES.map((s) => [s, board.cards.filter((c) => c.status === s).length]));
        const byId = new Map(board.cards.map((c) => [c.id, c]));
        text = [
          `B project=${q(projectName(db, projectId))} cards=${board.cards.length} now=${counts.now} next=${counts.next} later=${counts.later} complete=${counts.complete} dropped=${counts.dropped} reopened=${board.reopened.length}`,
          ...board.cards.map((c) => cardLine(c, c.parent_id ? byId.get(c.parent_id)?.ref : undefined)),
        ].join('\n');
      }
    } else if (parsed.command === 'now') {
      const projectId = repo.resolveForRead(db, opts);
      const now = repo.getBoard(db, projectId).detail;
      text = json ? emitJson(now) : (now.length ? now.map(taskBlock).join('\n') : 'ok no-now-tasks');
    } else if (parsed.command === 'task') {
      if (!parsed.args[0]) throw new Error('Usage: vibetasks task #REF [--project NAME]');
      const projectId = repo.resolveForRead(db, opts);
      const task = requireTask(db, projectId, parsed.args[0]);
      text = json ? emitJson(task) : taskBlock(task);
    } else if (parsed.command === 'add') {
      const title = parsed.args.join(' ').trim();
      if (!title) throw new Error('Usage: vibetasks add TITLE [--project NAME]');
      const status = parseEnum(flag(parsed, 'status'), STATUSES, 'status') as Status | undefined;
      const priority = parseEnum(flag(parsed, 'priority'), PRIORITIES, 'priority') as Priority | undefined;
      const kind = parseEnum(flag(parsed, 'kind'), KINDS, 'kind') as Kind | undefined;
      const brief = parseBrief(aliasedFlag(parsed, 'brief', 'summary'));
      const details = aliasedFlag(parsed, 'details', 'description');
      const projectId = repo.resolveForWrite(db, opts);
      const task = repo.addTask(db, {
        project_id: projectId,
        title,
        summary: brief,
        description: details,
        status,
        priority,
        kind,
        version: flag(parsed, 'version'),
        paths: flagValues(parsed, 'path'),
        symbols: flagValues(parsed, 'symbol'),
        source: 'claude',
      });
      text = json ? emitJson(task) : `ok #${task.ref} ${task.id}`;
    } else if (parsed.command === 'move') {
      if (!parsed.args[0]) throw new Error('Usage: vibetasks move #REF STATUS [--project NAME]');
      const status = parseEnum(parsed.args[1] ?? flag(parsed, 'status'), STATUSES, 'status') as Status | undefined;
      if (!status) throw new Error('Usage: vibetasks move #REF STATUS [--project NAME]');
      const projectId = repo.resolveForRead(db, opts);
      const task = requireTask(db, projectId, parsed.args[0]);
      repo.moveTask(db, task.id, status);
      const moved = repo.getTask(db, task.id)!;
      text = json ? emitJson(moved) : `ok #${moved.ref} ${moved.status}`;
    } else {
      throw new Error(`Unknown command "${parsed.command}". Run: vibetasks help`);
    }

    out(`${text}\n`);
    return 0;
  } catch (e) {
    err(`error: ${(e as Error).message}\n`);
    return 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
