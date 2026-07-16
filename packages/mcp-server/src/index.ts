#!/usr/bin/env node
// MCP stdio server: exposes PlainSheet retrieval and audit to any MCP client
// (Claude Code, Claude Desktop). Thin wrapper: the logic lives in @plainsheet/core;
// this file is just another interface adapter over the same use cases.
//
// Claude Desktop config example:
//   { "mcpServers": { "plainsheet": { "command": "node",
//     "args": ["<repo>/packages/mcp-server/dist/index.js"],
//     "env": { "DATABASE_URL": "postgres://plainsheet:plainsheet@localhost:5433/plainsheet" } } } }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import pg from 'pg';
import { LocalEmbeddings, PgChunkRepository } from '@plainsheet/adapters';
import { auditSheet, executeTool } from '@plainsheet/core';

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
const repo = new PgChunkRepository(pool);
const embeddings = new LocalEmbeddings();

const server = new McpServer({ name: 'plainsheet', version: '0.1.0' });

server.tool(
  'list_sheets',
  'List the participant information sheets available for querying.',
  {},
  async () => {
    const sheets = await repo.listSheets();
    return { content: [{ type: 'text', text: JSON.stringify(sheets, null, 2) }] };
  },
);

server.tool(
  'search_sheet',
  'Hybrid search (lexical + vector) over one participant information sheet. Returns chunks with ids.',
  { sheetId: z.string(), query: z.string() },
  async ({ sheetId, query }) => {
    const result = await executeTool({ sheetId, repo, embeddings }, 'search_sheet', { query });
    return { content: [{ type: 'text', text: result }] };
  },
);

server.tool(
  'readability_report',
  'Deterministic accessibility report for a whole sheet: Flesch-Kincaid grade and jargon candidates per section.',
  { sheetId: z.string() },
  async ({ sheetId }) => {
    const sheet = await repo.getSheet(sheetId);
    if (!sheet) return { content: [{ type: 'text', text: `No sheet with id ${sheetId}` }] };
    return { content: [{ type: 'text', text: JSON.stringify(auditSheet(sheet), null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
