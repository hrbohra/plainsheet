// Eval harness. Runs the golden set through the real agent (real models, real
// retrieval) and scores each case deterministically where possible:
//   - kind correctness (answered / not_in_document / refused)
//   - citation faithfulness: every citation's quote must appear in the cited chunk
//   - expected phrases must appear in cited chunk text (grounding, not just fluency)
//   - reading level: Flesch-Kincaid grade cap on plain-mode answers
//   - latency and cost per case
// Writes evals/RESULTS.md at the repo root. Exits 1 if any case fails, so CI gates on it.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { parse } from 'yaml';
import {
  askQuestion, fleschKincaidGrade,
  type Answer, type ReadingLevel,
} from '@plainsheet/core';
import { createLlmFromEnv, LocalEmbeddings, PgChunkRepository, createLogger } from '@plainsheet/adapters';

interface GoldenCase {
  id: string;
  question: string;
  reading_level: ReadingLevel;
  expect_kind: 'answered' | 'not_in_document' | 'refused';
  expect_phrases?: string[];
  max_fk_grade?: number;
}

interface GoldenFile { sheet_id: string; cases: GoldenCase[]; }

interface CaseResult {
  id: string;
  pass: boolean;
  failures: string[];
  latencyMs: number;
  costUsd: number;
  kind: Answer['kind'];
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

// Dev convenience: load the repo-root .env for plain-node runs (no override).
try {
  const { readFileSync: read } = await import('node:fs');
  for (const line of read(join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== '' && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
} catch { /* no .env file: fine, real env vars are set */ }

/** Typography-tolerant comparison: models re-render dashes, curly quotes and
 * spacing when quoting. Faithfulness means the words match, not the bytes. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function scoreCase(
  answer: Answer,
  c: GoldenCase,
  chunkTextById: (id: string) => Promise<string | null>,
): Promise<string[]> {
  const failures: string[] = [];

  const expectedKind = c.expect_kind === 'refused' ? 'refused_medical_advice' : c.expect_kind;
  if (answer.kind !== expectedKind) {
    failures.push(`kind: expected ${expectedKind}, got ${answer.kind}`);
  }

  if (c.expect_kind === 'answered') {
    if (answer.citations.length === 0) failures.push('no citations on an answerable question');
    for (const citation of answer.citations) {
      const chunkText = await chunkTextById(citation.chunkId);
      if (chunkText === null) {
        failures.push(`citation points at unknown chunk ${citation.chunkId}`);
      } else if (citation.quote.length > 0) {
        // An ellipsis-elided quote is still faithful if every fragment appears.
        const fragments = normalize(citation.quote).split(/\.{3}|…/).map((f) => f.trim()).filter(Boolean);
        const haystack = normalize(chunkText);
        if (!fragments.every((f) => haystack.includes(f))) {
          failures.push(`unfaithful citation in ${citation.chunkId}: "${citation.quote.slice(0, 80)}"`);
        }
      }
    }
    for (const phrase of c.expect_phrases ?? []) {
      const grounded = (
        await Promise.all(answer.citations.map((ct) => chunkTextById(ct.chunkId)))
      ).some((t) => t !== null && normalize(t).includes(normalize(phrase)));
      if (!grounded) failures.push(`expected phrase "${phrase}" not grounded in any cited chunk`);
    }
  }

  if (c.max_fk_grade !== undefined && answer.kind === 'answered') {
    const grade = fleschKincaidGrade(answer.text);
    if (grade > c.max_fk_grade) failures.push(`reading level: FK grade ${grade} exceeds cap ${c.max_fk_grade}`);
  }

  if (c.expect_kind === 'refused' && answer.citations.length > 0) {
    failures.push('refusal should carry no citations');
  }

  return failures;
}

async function main() {
  const goldenDir = join(here, '..', 'golden');
  const goldenFiles = readdirSync(goldenDir).filter((f) => f.endsWith('.yaml')).sort();
  const suites = goldenFiles.map((f) => parse(readFileSync(join(goldenDir, f), 'utf8')) as GoldenFile);

  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  const repo = new PgChunkRepository(pool);
  const embeddings = new LocalEmbeddings();
  const selection = createLlmFromEnv();
  const llm = selection.llm;
  const logger = createLogger({ app: 'evals', llmProvider: selection.provider });

  const config = {
    answerModel: selection.answerModel,
    toolModel: selection.toolModel,
    maxSteps: Number(process.env['MAX_AGENT_STEPS'] ?? 6),
  };

  // Free-tier RPM headroom: space out cases when running on Gemini's free tier.
  const interCaseDelayMs = Number(process.env['EVAL_DELAY_MS'] ?? (selection.provider === 'gemini' ? 5000 : 0));

  const results: Array<CaseResult & { sheetId: string }> = [];
  for (const golden of suites) {
    const chunkTextById = async (id: string): Promise<string | null> => {
      const sectionId = id.split('::').slice(0, 2).join('::');
      const chunks = await repo.getSection(golden.sheet_id, sectionId);
      return chunks.find((ch) => ch.id === id)?.text ?? null;
    };

    for (const c of golden.cases) {
      if (results.length > 0 && interCaseDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, interCaseDelayMs));
      }
      const t0 = Date.now();
      const answer = await askQuestion(
        {
          llm,
          tools: { sheetId: golden.sheet_id, repo, embeddings },
          logger, clock: { now: () => Date.now() }, config,
        },
        { question: c.question, readingLevel: c.reading_level, requestId: `eval-${c.id}` },
      );
      const failures = await scoreCase(answer, c, chunkTextById);
      results.push({
        sheetId: golden.sheet_id,
        id: c.id, pass: failures.length === 0, failures,
        latencyMs: Date.now() - t0, costUsd: answer.usage.costUsd, kind: answer.kind,
      });
      logger.info('case done', { sheet: golden.sheet_id, id: c.id, pass: failures.length === 0, failures });
    }
  }
  await pool.end();

  const passed = results.filter((r) => r.pass).length;
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const lines = [
    '# Eval Results',
    '',
    `Config: answer=${config.answerModel} tools=${config.toolModel} maxSteps=${config.maxSteps}`,
    '',
    `**${passed}/${results.length} passed** · total cost $${totalCost.toFixed(4)}`,
    '',
    '| Sheet | Case | Result | Kind | Latency | Cost | Failures |',
    '|---|---|---|---|---|---|---|',
    ...results.map((r) =>
      `| ${r.sheetId} | ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.kind} | ${r.latencyMs}ms | $${r.costUsd.toFixed(4)} | ${r.failures.join('; ') || '-'} |`,
    ),
    '',
    `_Run: ${new Date().toISOString()}_`,
  ];
  mkdirSync(join(repoRoot, 'evals'), { recursive: true });
  writeFileSync(join(repoRoot, 'evals', 'RESULTS.md'), lines.join('\n'));
  console.log(lines.join('\n'));

  if (passed < results.length) process.exit(1);
}

await main();
