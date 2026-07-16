// Ingest the bundled sample sheet: node scripts/ingest-sample.mjs
// (after: docker compose up -d && npm run db:schema && npm run build workspaces)
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { PgChunkRepository, LocalEmbeddings, createLogger } from '@plainsheet/adapters';
import { ingestSheet } from '@plainsheet/core';

const raw = JSON.parse(readFileSync(new URL('../data/sheets/sample-pis.json', import.meta.url), 'utf8'));
const sheet = {
  id: raw.id,
  title: raw.title,
  studyName: raw.studyName,
  sections: raw.sections.map((s, i) => ({
    id: `${raw.id}::s${i + 1}`,
    sheetId: raw.id,
    index: i + 1,
    heading: s.heading,
    text: s.text,
  })),
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await ingestSheet(
    { repo: new PgChunkRepository(pool), embeddings: new LocalEmbeddings(), logger: createLogger({ app: 'ingest' }) },
    sheet,
  );
  console.log(`ingested ${sheet.id}: ${result.chunkCount} chunks`);
} finally {
  await pool.end();
}
