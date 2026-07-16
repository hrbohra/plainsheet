// Composition root: the ONLY place adapters are constructed and wired to ports.
// Everything else receives dependencies. Singletons reused across requests
// (pool, model, SDK client) because Next.js may keep the module warm.

import pg from 'pg';
import { createLlmFromEnv, LocalEmbeddings, PgChunkRepository, createLogger } from '@plainsheet/adapters';
import type { AskQuestionDeps } from '@plainsheet/core';

const globalCache = globalThis as unknown as { __plainsheet?: Omit<AskQuestionDeps, 'tools'> & { repo: PgChunkRepository; embeddings: LocalEmbeddings } };

export function container() {
  if (!globalCache.__plainsheet) {
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
    const repo = new PgChunkRepository(pool);
    const selection = createLlmFromEnv();
    globalCache.__plainsheet = {
      repo,
      embeddings: new LocalEmbeddings(),
      llm: selection.llm,
      logger: createLogger({ app: 'web', llmProvider: selection.provider }),
      clock: { now: () => Date.now() },
      config: {
        answerModel: selection.answerModel,
        toolModel: selection.toolModel,
        maxSteps: Number(process.env['MAX_AGENT_STEPS'] ?? 6),
      },
    };
  }
  return globalCache.__plainsheet;
}
