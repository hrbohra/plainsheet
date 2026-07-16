// End-to-end smoke test from the CLI, no web server needed:
//   node scripts/smoke.mjs "Can I stop taking part once I have started?" [plain|detailed]
// Exercises: env loading, provider selection, hybrid retrieval, the agent loop,
// citations, and cost/latency accounting. Used for the PRR "verified end-to-end" box.
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

loadEnv(fileURLToPath(new URL('../.env', import.meta.url)));

const { createLlmFromEnv, LocalEmbeddings, PgChunkRepository, createLogger } = await import('@plainsheet/adapters');
const { askQuestion } = await import('@plainsheet/core');
const pg = (await import('pg')).default;

const question = process.argv[2] ?? 'Can I stop taking part once I have started?';
const readingLevel = process.argv[3] === 'detailed' ? 'detailed' : 'plain';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const selection = createLlmFromEnv();
console.log(`provider=${selection.provider} answer=${selection.answerModel} tools=${selection.toolModel}`);

try {
  const t0 = Date.now();
  const answer = await askQuestion(
    {
      llm: selection.llm,
      tools: { sheetId: 'sample-pis', repo: new PgChunkRepository(pool), embeddings: new LocalEmbeddings() },
      logger: createLogger({ app: 'smoke' }),
      clock: { now: () => Date.now() },
      config: { answerModel: selection.answerModel, toolModel: selection.toolModel, maxSteps: 6 },
    },
    { question, readingLevel, requestId: `smoke-${Date.now()}` },
  );
  console.log('\n--- ANSWER (' + answer.kind + ', ' + readingLevel + ') ---\n' + answer.text);
  if (answer.citations.length) {
    console.log('\n--- CITATIONS ---');
    for (const c of answer.citations) console.log(`  [${c.chunkId}] "${c.quote}"`);
  }
  console.log('\n--- TRACE ---');
  for (const t of answer.trace) {
    if (t.type === 'model_turn') console.log(`  step ${t.step}: ${t.model} -> ${t.stopReason} (${t.ms}ms)`);
    if (t.type === 'tool_call') console.log(`  step ${t.step}: tool ${t.tool} (${t.ms}ms)`);
  }
  console.log(`\ntokens in/out: ${answer.usage.inputTokens}/${answer.usage.outputTokens} · cost $${answer.usage.costUsd.toFixed(4)} · wall ${Date.now() - t0}ms`);
} finally {
  await pool.end();
}
