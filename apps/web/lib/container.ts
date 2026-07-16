// Composition root: the ONLY place adapters are constructed and wired to ports.
// Everything else receives dependencies. Singletons reused across requests
// (pool, model, SDK client) because Next.js may keep the module warm.

import pg from 'pg';
import { AnthropicLlm, LocalEmbeddings, PgChunkRepository, createLogger } from '@plainsheet/adapters';
import type { AskQuestionDeps } from '@plainsheet/core';

const globalCache = globalThis as unknown as { __plainsheet?: Omit<AskQuestionDeps, 'tools'> & { repo: PgChunkRepository; embeddings: LocalEmbeddings } };

export function container() {
  if (!globalCache.__plainsheet) {
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
    const repo = new PgChunkRepository(pool);
    globalCache.__plainsheet = {
      repo,
      embeddings: new LocalEmbeddings(),
      llm: new AnthropicLlm(),
      logger: createLogger({ app: 'web' }),
      clock: { now: () => Date.now() },
      config: {
        answerModel: process.env['ANSWER_MODEL'] ?? 'claude-sonnet-5',
        toolModel: process.env['TOOL_MODEL'] ?? 'claude-haiku-4-5',
        maxSteps: Number(process.env['MAX_AGENT_STEPS'] ?? 6),
      },
    };
  }
  return globalCache.__plainsheet;
}
