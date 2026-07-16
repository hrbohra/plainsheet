# Architecture

PlainSheet is deliberately structured as evidence of engineering fundamentals, not just a demo
that happens to work. This document explains the decisions.

## Shape: a modular monolith with hexagonal boundaries

```
apps/web            Next.js interface layer (routes, UI, composition root)
packages/core       domain + application logic. Zero framework imports, zero I/O.
packages/adapters   infrastructure: Postgres/pgvector, Anthropic API, embeddings, logging
packages/mcp-server thin MCP stdio server wrapping the same application use cases
packages/evals      eval harness: golden sets, scorers, CI runner
```

Dependency rule: `core` imports nothing from the other packages. `adapters` implements the
ports that `core` defines. `apps/web` and `mcp-server` wire them together in a composition
root. Nothing else does dependency construction.

Why not microservices: one developer, one deployable, one database. A modular monolith gives
the same testable seams without the operational cost. Chosen for fit, not preference; the port
boundaries mean any adapter could be extracted later without touching domain code.

## Domain (DDD-lite, sized to the problem)

The ubiquitous language comes from clinical research: a `Sheet` (participant information
sheet) has `Section`s, split into `Chunk`s for retrieval; an `Answer` carries `Citation`s that
point back to exact chunks; `ReadingLevel` is a first-class value (`plain` or `detailed`)
because the whole product exists to serve two audiences. Pure domain services (`chunker`,
`readability`) are deterministic functions with unit tests and no dependencies.

## Ports and adapters (SOLID in practice)

`packages/core/src/application/ports.ts` defines the interfaces the application layer needs:

- `ChunkRepository` - hybrid retrieval (vector similarity + lexical) and persistence
- `EmbeddingProvider` - text to vector
- `LlmProvider` - chat with tool use, provider-agnostic message shapes
- `Logger`, `Clock` - so nothing in core touches pino or Date directly

This is dependency inversion doing real work: the agent loop is tested against in-memory
fakes (fast, deterministic), the Postgres adapter is tested against a real database in CI
(honest), and swapping pgvector for Pinecone or Anthropic for another model provider is an
adapter change, not a core change. Interfaces are small and role-specific (interface
segregation); each module has one reason to change (single responsibility).

## The agent: own orchestration, on purpose

The agent loop (`ask-question.ts`) is hand-written: a bounded loop over the Messages API's
`tool_use` stop reason, with a typed tool registry, per-step trace events, and hard system
rules (cite or refuse; never advise beyond the document). The Anthropic SDK offers a tool
runner that does this automatically; we intentionally own the loop because the control points
matter here: step limits, trace capture for the UI, guardrail enforcement between steps, and
cost accounting per step.

Cost-aware model split, provider-agnostic: `LLM_PROVIDER` selects the adapter at the
composition root; the core never knows which vendor is running. Defaults: Gemini
(`gemini-2.5-flash` for answers, `gemini-2.5-flash-lite` for tool steps; AI Studio free tier)
or Anthropic (`claude-sonnet-5` at $3/$15 per MTok for answers, `claude-haiku-4-5` at $1/$5
for tool steps). Either way the split is the same discipline: the cheap fast model wherever
it suffices, the stronger model only for the user-facing answer. The eval results table
records cost and latency per configuration so the tradeoff is measured, not asserted. The
Gemini adapter was added after the Anthropic one without touching a line of core: the
dependency-inversion claim, demonstrated in the commit history.

## Retrieval: hybrid BM25 + vector, one store

Postgres does both jobs: `pgvector` for cosine similarity over embeddings, native full-text
search (`tsvector`) for lexical matching, fused with reciprocal rank fusion. Rationale:

- Lexical matching catches exact terms that matter in clinical documents (drug names, visit
  numbers, dosages) that embedding similarity can blur.
- One store means one backup story, one migration story, transactional ingestion.
- Pinecone/Weaviate/Elasticsearch would each be justified at a different scale; at thousands
  of chunks per sheet, they are operational overhead without retrieval benefit. Store chosen
  as the problem demands.

Embeddings run locally (MiniLM via transformers.js) behind the `EmbeddingProvider` port: free,
offline, no third-party data flow for document content at ingest. If query-time cold starts on
serverless become a problem, the port makes an API-based embedder a one-file swap; that
tradeoff is recorded in the eval table rather than guessed.

## Decision: no fine-tuning

Considered and rejected. The task is grounded question answering over a provided document with
citations; retrieval plus prompt engineering achieves it with zero training data, instant
iteration, and no drift risk when sheets change. Fine-tuning would need labeled Q&A per sheet
(which does not exist), would freeze behavior against a moving document set, and would blur
the audit trail from answer back to source text. The right tool boundary: fine-tune when the
behavior cannot be specified in context; this behavior can.

## Evals as a first-class discipline

`packages/evals` holds golden question sets per bundled sheet, including adversarial cases
(requests for medical advice that must be refused, questions whose answer is not in the
document). Scorers check citation faithfulness (cited chunk must contain the supporting text),
refusal correctness, reading-level compliance (Flesch-Kincaid on plain-mode answers), latency,
and token cost. The harness runs in GitHub Actions; results are written to `evals/RESULTS.md`
with the prompt version, so accuracy/cost/latency regressions show up in the diff of a PR.

## Production practices

- **12-factor:** config exclusively via env (`.env.example` documents every variable);
  stateless web tier; Postgres as an attached resource; logs to stdout as JSON.
- **Secrets:** never in code or git; `.env` gitignored; CI secret-scans with gitleaks; the
  README documents rotation (platform env store is the single source).
- **Observability:** pino structured logging; a request ID is generated at the edge and
  threaded through every agent step and tool call, so one trace reconstructs a full answer.
- **Security:** SAST via CodeQL and `npm audit` in CI; Zod validation on API input; the agent
  cannot fetch external URLs (no network tools); guardrails tested in the eval suite, not just
  written in the prompt.
- **TDD:** domain services were written test-first (see `packages/core/test`); the agent loop
  is covered against fake ports; the Postgres adapter has integration tests against a real
  pgvector instance in CI.

## Data and safety boundaries

Only public, published participant information sheets are bundled. No PHI anywhere in the
system. The agent answers exclusively from the ingested document, cites or refuses, and hard
refuses medical advice; those properties are enforced by system rules and verified by the
adversarial eval set.
