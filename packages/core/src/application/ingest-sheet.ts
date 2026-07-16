// Ingestion use case: sections in, chunks + embeddings persisted transactionally.

import { chunkSheet } from '../domain/chunker.js';
import type { Sheet } from '../domain/types.js';
import type { ChunkRepository, EmbeddingProvider, Logger } from './ports.js';

export interface IngestDeps {
  repo: ChunkRepository;
  embeddings: EmbeddingProvider;
  logger: Logger;
}

export async function ingestSheet(deps: IngestDeps, sheet: Sheet): Promise<{ chunkCount: number }> {
  const chunks = chunkSheet(sheet.sections);
  const vectors = await deps.embeddings.embed(chunks.map((c) => c.text));
  await deps.repo.saveSheet(sheet, chunks, vectors);
  deps.logger.info('sheet ingested', { sheetId: sheet.id, sections: sheet.sections.length, chunks: chunks.length });
  return { chunkCount: chunks.length };
}
