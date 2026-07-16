// Ingest a sheet JSON: node scripts/ingest-sample.mjs [path/to/sheet.json]
// Defaults to the bundled synthetic sample. Idempotent per sheet id.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './env.mjs';

loadEnv(fileURLToPath(new URL('../.env', import.meta.url)));
import { PgChunkRepository, LocalEmbeddings, createLogger } from '@plainsheet/adapters';
import { ingestSheet } from '@plainsheet/core';

const sheetPath = process.argv[2]
  ? new URL(`../${process.argv[2].replace(/\\/g, '/')}`, import.meta.url)
  : new URL('../data/sheets/sample-pis.json', import.meta.url);
const raw = JSON.parse(readFileSync(sheetPath, 'utf8'));
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
