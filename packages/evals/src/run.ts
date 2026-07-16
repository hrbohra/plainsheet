// Eval harness. Runs the golden set through the real agent (real models, real
// retrieval) and scores each case deterministically where possible:
//   - kind correctness (answered / not_in_document / refused)
//   - citation faithfulness: every citation's quote must appear in the cited chunk
//   - expected phrases must appear in cited chunk text (grounding, not just fluency)
//   - reading level: Flesch-Kincaid grade cap on plain-mode answers
//   - latency and cost per case
// Writes evals/RESULTS.md at the repo root. Exits 1 if any case fails, so CI gates on it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { parse } from 'yaml';
import {
  askQuestion, fleschKincaidGrade,
  type Answer, type ReadingLevel,
} from '@plainsheet/core';
import { AnthropicLlm, LocalEmbeddings, PgChunkRepository, createLogger } from '@plainsheet/adapters';

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
      } else if (citation.quote.length > 0 && !chunkText.toLowerCase().includes(citation.quote.toLowerCase())) {
        failures.push(`unfaithful citation: quote not found in ${citation.chunkId}`);
      }
    }
    for (const phrase of c.expect_phrases ?? []) {
      const grounded = (
        await Promise.all(answer.citations.map((ct) => chunkTextById(ct.chunkId)))
      ).some((t) => t?.toLowerCase().includes(phrase.toLowerCase()));
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
  const golden = parse(readFileSync(join(here, '..', 'golden', 'sample-sheet.yaml'), 'utf8')) as GoldenFile;

  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  const repo = new PgChunkRepository(pool);
  const embeddings = new LocalEmbeddings();
  const llm = new AnthropicLlm();
  const logger = createLogger({ app: 'evals' });

  const config = {
    answerModel: process.env['ANSWER_MODEL'] ?? 'claude-sonnet-5',
    toolModel: process.env['TOOL_MODEL'] ?? 'claude-haiku-4-5',
    maxSteps: Number(process.env['MAX_AGENT_STEPS'] ?? 6),
  };

  const chunkTextById = async (id: string): Promise<string | null> => {
    const sectionId = id.split('::').slice(0, 2).join('::');
    const chunks = await repo.getSection(golden.sheet_id, sectionId);
    return chunks.find((ch) => ch.id === id)?.text ?? null;
  };

  const results: CaseResult[] = [];
  for (const c of golden.cases) {
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
      id: c.id, pass: failures.length === 0, failures,
      latencyMs: Date.now() - t0, costUsd: answer.usage.costUsd, kind: answer.kind,
    });
    logger.info('case done', { id: c.id, pass: failures.length === 0, failures });
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
    '| Case | Result | Kind | Latency | Cost | Failures |',
    '|---|---|---|---|---|---|',
    ...results.map((r) =>
      `| ${r.id} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.kind} | ${r.latencyMs}ms | $${r.costUsd.toFixed(4)} | ${r.failures.join('; ') || '-'} |`,
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
