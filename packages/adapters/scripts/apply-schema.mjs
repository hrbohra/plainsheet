// Applies schema.sql to DATABASE_URL. Idempotent (CREATE IF NOT EXISTS throughout).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { loadEnv } from '../../../scripts/env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, '..', '..', '..', '.env'));
const sql = readFileSync(join(here, '..', 'src', 'pg', 'schema.sql'), 'utf8');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(sql);
  console.log('schema applied');
} finally {
  await pool.end();
}
