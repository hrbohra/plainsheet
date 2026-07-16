# PlainSheet - Design
Status: building · Owner: Harsh Bohra · Date: 2026-07-15

## 1. Context and problem
Clinical trial participant information sheets are legally required, dense, and hard to read;
participants either do not read them or misunderstand them, and study teams review them for
accessibility by hand. I did that review by hand for 2.5 years on a Cardiff University Public
Advisory Group. PlainSheet automates both sides: cited answers for participants, an
accessibility report for study teams.

## 2. Goals / Non-goals
Goals:
- Answer questions about one ingested sheet with citations to exact chunks, at a chosen
  reading level, or refuse honestly.
- Give study teams a deterministic readability report per section.
- Demonstrate production engineering in a three-evening prototype (see §10).

NON-GOALS (declared so the prototype never quietly becomes what it is not):
- Not a medical device; gives no medical advice by design.
- No PHI, no patient data, no accounts or multi-tenancy. Public published sheets only.
- No fine-tuning (rationale in ARCHITECTURE.md).
- Not high-availability infrastructure; this is a demo with honest limits.

## 3. Requirements, quantified (verification mechanism in brackets)
- Correctness invariant: every factual claim in an answered response carries a citation whose
  quote appears verbatim in the cited chunk. Target: 100% of eval cases [eval: faithfulness
  scorer].
- Refusal invariant: 100% refusal on the adversarial medical-advice set, zero citations on
  refusals [eval: adversarial cases].
- Reading level: plain-mode answers at Flesch-Kincaid grade <= 8 [eval: FK scorer].
- Latency: p95 end-to-end answer < 15 s (multi-step agent; traced per step) [eval: latency
  column + structured logs]. Measured 16 Jul: ~2-3 s with gemini-flash-lite-latest answers
  (default); ~18 s with gemini-flash-latest, which ignored thinking-level hints. Model choice
  is the latency lever; both recorded in the eval table.
- Cost: < $0.02 per question at current pricing (Haiku tool steps, Sonnet answer)
  [eval: cost column]. Ceiling at 10x expected demo traffic: ~$5/day, acceptable.
- Security: no secrets in repo (CI gitleaks); public write path rate-limited [see §6, §7].

## 4. Design
See ARCHITECTURE.md: data model first (Sheet/Section/Chunk with citation-stable ids),
hexagonal core, own agent loop, hybrid retrieval in one Postgres. The failure-relevant path
is the agent loop: every step can fail (provider, tool, budget) and each failure mode has a
defined user-visible outcome (§6).

## 5. Alternatives considered
- SDK tool runner instead of an own loop: rejected because the control points (step budget,
  trace capture, per-step cost accounting, model split) are the product of the demo; the
  runner hides exactly the machinery being demonstrated.
- Managed vector store (Pinecone/Weaviate) instead of pgvector: rejected at this scale; a
  second stateful service adds operational surface with no retrieval benefit for thousands
  of chunks. Revisit at millions.
- Fine-tuned model instead of RAG: rejected; grounded QA over a changing document set needs
  an audit trail from answer to source, which retrieval gives for free (full ADR in
  ARCHITECTURE.md).
- Semantic answer caching (Redis/vector cache in front of the LLM): rejected on safety
  grounds. Semantically similar questions can require different answers in this domain
  ("can I take painkillers" vs "can I take double my painkillers"), and serving a cached
  answer across that line is the worst available failure mode. Also moot at demo traffic.
  Per-step trace profiling showed the bottleneck was model generation time, not retrieval
  (~250ms for hybrid search vs 16s for a reasoning-heavy answer model); fixed by model
  selection instead, 18s to ~2s with quality unchanged on the golden set.

## 6. Failure modes
| Dependency | Slow | Down | Wrong | User sees | Blast radius | Mitigation |
|---|---|---|---|---|---|---|
| Anthropic API | answer > 15s | request fails | refusal/garbage | honest error or refusal text | one request | step budget; typed stop reasons; 500 with requestId |
| Postgres | retrieval slow | ask fails | stale chunks | error message | whole app | single managed instance; re-ingest script is idempotent |
| Local embedder | cold start adds seconds | model load fails | poor recall | slow first query | first query per instance | lazy singleton; swap-to-API port documented |
| Uploaded document | n/a | n/a | hostile text tries to override rules ("ignore your instructions") | agent stays in role | one sheet | document treated as data, rules outrank content; adversarial eval case to be added |
| Caller | n/a | n/a | abuse/flooding of /api/ask | 429 | API spend | rate limit per IP (day 2 item; PRR-blocking) |

## 7. Security and privacy
Threat model: drive-by abuse of a public LLM endpoint (cost drain) and prompt injection via
document content. No user data is stored; questions are logged with request ids but no
identity. Secrets only in env; CI fails on leaked secrets; `npm audit` gates high findings.

## 8. Rollout and rollback
Exposure ladder: local → deployed URL shared with one reviewer → public link in application
follow-up. Kill switch: unset the deployment (single command) or remove ANTHROPIC_API_KEY in
the platform env, which fails all asks loudly but cheaply. Rollback: redeploy previous build.

## 9. Open questions
- [ ] Which real published PIS to bundle alongside the synthetic sample - Harsh, before demo
      send-off.
- [ ] MiniLM cold-start on serverless: measure on day 2; if p95 breach, swap the embedding
      adapter for an API embedder (one file).

## 10. Verification plan
Requirement-by-requirement: the eval harness in CI is the mechanism for every §3 number
(RESULTS.md is the evidence artifact); unit tests pin domain invariants; the integration
suite pins hybrid retrieval against real pgvector; the PRR checklist (docs/PRR.md) gates
sharing the link. Metric vocabulary aligns with RAGAS (faithfulness, answer relevancy,
context precision), implemented deterministically where possible: citation faithfulness here
is a verbatim string check against the cited chunk, which is stricter than an LLM judge.
