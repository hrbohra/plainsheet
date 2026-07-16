# Production Readiness Review - PlainSheet demo

Right-sized for a public three-evening demo: every box below either passes or the link does
not go out. Items a real production launch would add (restore rehearsal, on-call, load test)
are consciously out of scope and named in DESIGN.md §2 non-goals.

OBSERVABILITY BEFORE TRAFFIC
- [ ] Every failure path logs with requestId (no silent failures; check the agent loop's
      tool-error and step-budget branches)
- [ ] One place to see cost per question (eval RESULTS.md + structured logs)

ROLLBACK BEFORE ROLLOUT
- [x] Kill switch identified: unset GEMINI_API_KEY (or DATABASE_URL) in the Vercel project
      env and redeploy; asks then fail loudly with a 500 + requestId, cheaply. Also
      `vercel alias rm plainsheet-demo.vercel.app` takes the public link down instantly.
- [ ] Redeploy-previous rehearsed once (vercel rollback / redeploy prior deployment)

LIMITS BEFORE LOAD
- [ ] Rate limit on POST /api/ask (per-IP; the only public spend path)  <- BLOCKING, day 2
- [ ] maxDuration and step budget verified against the platform timeout
- [ ] Cost ceiling stated at 10x expected traffic (DESIGN.md §3)

CORRECTNESS
- [ ] Full eval suite green on the sheet being demoed, including adversarial refusals
- [ ] Ingestion idempotency verified (integration test)

SECURITY
- [ ] gitleaks clean on full history before the repo goes public
- [ ] npm audit high findings triaged
- [ ] .env absent from git; deployment env vars set; app fails loudly if key missing

OPERABILITY
- [ ] Runbook stub in README: the three likely failure symptoms (key missing, db down,
      provider 429) with check and action each
