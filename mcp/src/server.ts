#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb } from './db.js';
import { registerTools } from './tools.js';

// MCP instructions are resent to the model, so keep the runtime protocol compact.
// The richer shareable protocol stays in docs/vibetasks-claude-protocol.md.
const INSTRUCTIONS = [
  'Vibe Tasks MCP protocol:',
  '- Start task work with get_board(project): all task cards, capped Now detail, reopened list.',
  '- Use get_map only when relationships/refs matter; use get_task for one full body.',
  '- Use resume(project) after /clear; pass include_map=true only when the map is needed.',
  '- For board-wide cleanup, call audit_board, inspect targeted code, preview apply_board_audit, then confirm; git evidence is not proof.',
  '- New tasks default Next; move active work to Now, finished work to Complete, abandoned work to Dropped.',
  '- Card concrete proposed work in Next/Later with priority and kind; do not auto-promote proposals into Now.',
  '- Before code edits, use task paths/symbols to limit file reads.',
  '- At wrap-up, call set_recap with a short dated recap.',
].join('\n');

const dir = join(homedir(), '.vibetasks');
mkdirSync(dir, { recursive: true });
const dbPath = process.env.VIBETASKS_DB ?? join(dir, 'vibetasks.db');
const db = openDb(dbPath);
const server = new McpServer({ name: 'vibetasks', version: '1.0.0' }, { instructions: INSTRUCTIONS });
registerTools(server, db);
await server.connect(new StdioServerTransport());
