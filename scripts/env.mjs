// Minimal .env loader for the plain-node scripts (schema, ingest, evals).
// Dev convenience only; deployed environments set real env vars (12-factor).
import { existsSync, readFileSync } from 'node:fs';

export function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && match[2] !== '' && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}
