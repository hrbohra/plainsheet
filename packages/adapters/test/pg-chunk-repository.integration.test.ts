// Integration test against a real pgvector Postgres (docker compose up -d locally;
// a service container in CI). Skipped automatically when DATABASE_URL is unset.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PgChunkRepository } from '../src/pg/pg-chunk-repository.js';
import type { Chunk, Sheet } from '@plainsheet/core';

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('PgChunkRepository (integration)', () => {
  let pool: pg.Pool;
  let repo: PgChunkRepository;

  const dim = 384;
  const vec = (seed: number) => Array.from({ length: dim }, (_, i) => (i === seed ? 1 : 0));

  const sheet: Sheet = {
    id: 'it-sheet', title: 'Integration Test Sheet', studyName: 'IT Study',
    sections: [
      { id: 'it-sheet::s1', sheetId: 'it-sheet', index: 1, heading: 'Withdrawal', text: 'You may withdraw at any time.' },
      { id: 'it-sheet::s2', sheetId: 'it-sheet', index: 2, heading: 'Visits', text: 'Visit three includes a blood test.' },
    ],
  };
  const chunks: Chunk[] = [
    { id: 'it-sheet::s1::0', sheetId: 'it-sheet', sectionId: 'it-sheet::s1', sectionHeading: 'Withdrawal', index: 0, text: 'You may withdraw at any time.' },
    { id: 'it-sheet::s2::0', sheetId: 'it-sheet', sectionId: 'it-sheet::s2', sectionHeading: 'Visits', index: 0, text: 'Visit three includes a blood test.' },
  ];

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const here = dirname(fileURLToPath(import.meta.url));
    await pool.query(readFileSync(join(here, '..', 'src', 'pg', 'schema.sql'), 'utf8'));
    await pool.query("DELETE FROM sheets WHERE id = 'it-sheet'");
    repo = new PgChunkRepository(pool);
    await repo.saveSheet(sheet, chunks, [vec(0), vec(1)]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM sheets WHERE id = 'it-sheet'");
    await pool.end();
  });

  it('lexical search finds exact terms', async () => {
    const hits = await repo.search('it-sheet', 'blood test', vec(300), 5);
    expect(hits.map((h) => h.chunk.id)).toContain('it-sheet::s2::0');
  });

  it('vector search contributes when lexical misses', async () => {
    // query embedding identical to chunk s1's vector, query text matching nothing
    const hits = await repo.search('it-sheet', 'zzzz qqqq', vec(0), 5);
    expect(hits[0]?.chunk.id).toBe('it-sheet::s1::0');
  });

  it('ingestion is idempotent per sheet', async () => {
    await repo.saveSheet(sheet, chunks, [vec(0), vec(1)]);
    const stored = await repo.getSection('it-sheet', 'it-sheet::s1');
    expect(stored).toHaveLength(1);
  });

  it('round-trips the sheet', async () => {
    const loaded = await repo.getSheet('it-sheet');
    expect(loaded?.sections).toHaveLength(2);
    expect(loaded?.sections[1]?.heading).toBe('Visits');
  });
});
