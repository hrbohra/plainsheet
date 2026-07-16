// Ports: the interfaces the application layer needs from the outside world.
// Adapters implement these; core never imports an adapter. Message shapes are
// provider-agnostic on purpose: the Anthropic adapter maps them to SDK types.

import type { Chunk, Sheet } from '../domain/types.js';

export interface RetrievedChunk {
  chunk: Chunk;
  /** fused reciprocal-rank score, higher is better */
  score: number;
}

export interface ChunkRepository {
  saveSheet(sheet: Sheet, chunks: Chunk[], embeddings: number[][]): Promise<void>;
  /** hybrid search: lexical + vector, fused. queryEmbedding matches EmbeddingProvider output. */
  search(sheetId: string, queryText: string, queryEmbedding: number[], limit: number): Promise<RetrievedChunk[]>;
  getSection(sheetId: string, sectionId: string): Promise<Chunk[]>;
  listSheets(): Promise<Array<Pick<Sheet, 'id' | 'title' | 'studyName'>>>;
  getSheet(sheetId: string): Promise<Sheet | null>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

// Provider-agnostic LLM chat-with-tools surface.

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContentBlock[];
}

export interface LlmResponse {
  content: LlmContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools?: ToolDefinition[];
  maxTokens: number;
}

export interface LlmProvider {
  chat(request: LlmRequest): Promise<LlmResponse>;
  /** USD cost for a call on this model, from current pricing */
  costUsd(model: string, inputTokens: number, outputTokens: number): number;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface Clock {
  now(): number; // epoch ms; injectable so tests and traces are deterministic
}
