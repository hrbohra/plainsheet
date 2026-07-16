// The agent's tool surface. Definitions are data; execution is dispatched through
// the ports, so the same registry serves the web app, the MCP server, and tests.

import { fleschKincaidGrade, flagJargonCandidates } from '../domain/readability.js';
import type { ChunkRepository, EmbeddingProvider, ToolDefinition } from './ports.js';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_sheet',
    description:
      'Search the participant information sheet for passages relevant to a query. ' +
      'Call this before answering any question about the trial. Returns chunks with ids ' +
      'for citation. Prefer specific queries (visit names, drug names, section topics).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in a few words' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_section',
    description:
      'Fetch the full text of one section of the sheet by sectionId (as returned by ' +
      'search_sheet). Use when a search hit needs surrounding context.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionId: { type: 'string' },
      },
      required: ['sectionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'readability_report',
    description:
      'Compute a deterministic readability report (Flesch-Kincaid grade, jargon candidates) ' +
      'for a piece of text. Use for study-team accessibility audits, not for answering ' +
      'participant questions.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  sheetId: string;
  repo: ChunkRepository;
  embeddings: EmbeddingProvider;
}

/** Executes a tool call and returns a string result for the model. Throws on unknown tool. */
export async function executeTool(ctx: ToolContext, name: string, input: unknown): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'search_sheet': {
      const query = String(args['query'] ?? '');
      const [queryEmbedding] = await ctx.embeddings.embed([query]);
      const hits = await ctx.repo.search(ctx.sheetId, query, queryEmbedding ?? [], 6);
      if (hits.length === 0) return 'No relevant passages found.';
      return hits
        .map(
          (h) =>
            `[chunkId=${h.chunk.id} sectionId=${h.chunk.sectionId} section="${h.chunk.sectionHeading}"]\n${h.chunk.text}`,
        )
        .join('\n\n');
    }
    case 'get_section': {
      const sectionId = String(args['sectionId'] ?? '');
      const chunks = await ctx.repo.getSection(ctx.sheetId, sectionId);
      if (chunks.length === 0) return `No section found with id ${sectionId}.`;
      const heading = chunks[0]?.sectionHeading ?? '';
      return `Section "${heading}":\n` + chunks.map((c) => c.text).join(' ');
    }
    case 'readability_report': {
      const text = String(args['text'] ?? '');
      const grade = fleschKincaidGrade(text);
      const jargon = flagJargonCandidates(text);
      return JSON.stringify({ fleschKincaidGrade: grade, jargonCandidates: jargon });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
