'use client';

// The guide page practices what the product preaches: one story, two reading
// levels, chosen by the reader. Static content, no API calls.

import { useState } from 'react';
import Link from 'next/link';

type Mode = 'plain' | 'technical';

const S = {
  page: { maxWidth: 780, margin: '2.5rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a', lineHeight: 1.65 } as const,
  toggleWrap: { display: 'flex', gap: 8, margin: '1.2rem 0 2rem' } as const,
  toggle: (active: boolean) => ({
    padding: '8px 18px', borderRadius: 999, cursor: 'pointer', fontSize: 14,
    border: '1px solid #1a1a1a', background: active ? '#1a1a1a' : '#fff', color: active ? '#fff' : '#1a1a1a',
  }) as const,
  h2: { marginTop: '2.2rem', fontSize: 22 } as const,
  callout: { background: '#f6f6f2', borderLeft: '4px solid #1a1a1a', padding: '12px 16px', borderRadius: 4 } as const,
  kbd: { background: '#eee', borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace', fontSize: 13 } as const,
};

export default function About() {
  const [mode, setMode] = useState<Mode>('plain');

  return (
    <main style={S.page}>
      <p style={{ marginBottom: 4 }}><Link href="/">← Back to PlainSheet</Link></p>
      <h1 style={{ marginBottom: 4 }}>How PlainSheet works</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        One story, two depths. Pick the version written for you; switching any time is the
        whole point of this product.
      </p>

      <div style={S.toggleWrap}>
        <button style={S.toggle(mode === 'plain')} onClick={() => setMode('plain')}>Plain English</button>
        <button style={S.toggle(mode === 'technical')} onClick={() => setMode('technical')}>Under the hood</button>
      </div>

      {mode === 'plain' ? (
        <article>
          <h2 style={S.h2}>The problem</h2>
          <p>
            Before anyone joins a clinical trial, they get a document called a participant
            information sheet. It is legally required, often ten pages long, and written by
            researchers rather than for readers. People sign up without really understanding
            what happens at visit three, whether they can quit, or who sees their data. And
            the study teams who want to fix this review these documents by hand, line by line.
          </p>
          <p style={S.callout}>
            I know because I did that job. For two and a half years I sat on a Cardiff
            University research advisory group, reading trial documents and marking the parts
            a real person would struggle with. PlainSheet is that job, automated.
          </p>

          <h2 style={S.h2}>What it does</h2>
          <p>
            You pick a trial document and ask questions in your own words: <em>Can I change my
            mind? What happens at the second visit? Will I be paid?</em> PlainSheet answers in
            plain English, and every answer comes with receipts: numbered quotes showing the
            exact sentence in the document that supports each claim. If the document does not
            answer your question, it says so honestly and points you to the study team.
          </p>
          <p>
            There is also a mode for study teams: a report scoring each section of the document
            for reading difficulty, with the jargon highlighted, so writers can see exactly
            where their document loses people.
          </p>

          <h2 style={S.h2}>The most important thing it does not do</h2>
          <p>
            PlainSheet never gives medical advice. Ask it whether you should join the trial,
            skip a dose, or ignore a symptom, and it refuses and tells you who to actually ask.
            That is not a limitation we accepted; it is the first rule the system is built
            around, and we attack it with trick questions in testing to prove it holds. In a
            medical setting, a tool that knows what it must not answer is worth more than one
            that answers everything.
          </p>

          <h2 style={S.h2}>Why you can trust the answers</h2>
          <p>
            Three habits keep it honest. It only speaks from the document, never from general
            knowledge. It shows its work: the panel on the right of the screen lists every step
            it took to find your answer, like a receipt for its reasoning. And it is graded
            like a student: a test bank of questions, reviewed by a human who did this
            professionally, runs against every change, and a change that gets an answer wrong
            does not ship.
          </p>

          <h2 style={S.h2}>Try it in thirty seconds</h2>
          <p>
            Go <Link href="/">back to the app</Link>, pick the real knee-surgery trial document,
            and ask <span style={S.kbd}>Can I change my mind after agreeing?</span> Watch the
            trace panel think. Then ask <span style={S.kbd}>Should I stop my medication?</span>
            {' '}and watch it decline, politely, by design.
          </p>
        </article>
      ) : (
        <article>
          <h2 style={S.h2}>Architecture in one paragraph</h2>
          <p>
            PlainSheet is a hexagonal TypeScript monorepo: a framework-free core (domain model,
            agent loop, ports), infrastructure adapters (Postgres with pgvector, LLM providers,
            local embeddings), and thin interface layers over the same use cases: this Next.js
            app and an MCP server. The dependency rule is absolute: core imports nothing from
            the outside, so the agent loop is unit-tested against fakes and every adapter is
            swappable. Proof: the app originally ran on Anthropic models and moved to Gemini by
            adding one adapter and changing one env var, with zero core changes.
          </p>

          <h2 style={S.h2}>The agent, deliberately hand-rolled</h2>
          <p>
            Ask a question and a bounded orchestration loop (max 6 steps) drives the model
            through typed tools: <span style={S.kbd}>search_sheet</span> (retrieval),{' '}
            <span style={S.kbd}>get_section</span> (context expansion), and{' '}
            <span style={S.kbd}>readability_report</span> (deterministic Flesch-Kincaid and
            jargon flagging). No framework runs the loop, because the control points are the
            product: per-step trace events (rendered in the UI), per-step cost accounting, a
            cheap-model/answer-model split, and guardrails enforced between steps. System rules
            are ranked with refusal above everything: medical advice is refused even when the
            document is silent, which an eval case specifically exists to catch.
          </p>

          <h2 style={S.h2}>Retrieval: hybrid, one store</h2>
          <p>
            Chunks never cross section boundaries, so citations can always name their section.
            Retrieval fuses Postgres full-text rank with pgvector cosine similarity via
            reciprocal rank fusion in a single SQL query. Lexical matching catches the exact
            tokens that matter in clinical text (doses, visit numbers, drug names) that
            embeddings blur. At this scale a dedicated vector database would be operational
            overhead with no retrieval benefit; that decision, and the rejected alternatives
            including fine-tuning and semantic answer caching (a safety hazard here), are
            written up in the repo's design doc.
          </p>

          <h2 style={S.h2}>Evals as the contract</h2>
          <p>
            The golden set covers a synthetic sheet and a real published trial document
            (University of Salford, IRAS 317409), with answerable, not-in-document, and
            adversarial cases including a prompt-injection attempt. Hard gates sit at 100%:
            refusal correctness, and citation faithfulness checked as verbatim quote-in-chunk
            (typography-normalized, stricter than an LLM judge). Scored metrics: kind accuracy,
            phrase grounding, reading level, latency, cost. Current scorecard: 25/25, p95
            around 2.5 seconds warm and under 4 cold, at zero inference cost on the current
            provider tier. Expected kinds and phrases were validated by a reviewer with 2.5
            years of hands-on participant-information review. The suite runs in CI; a
            regression fails the build.
          </p>

          <h2 style={S.h2}>Production posture</h2>
          <p>
            Zod-validated input, per-IP rate limiting on the one endpoint that spends money,
            request IDs threaded through every agent step in structured logs, secrets only in
            platform env, gitleaks and dependency audit in CI, and a one-page production
            readiness review this deployment was gated on, kill-switch rehearsal included.
            Three evenings of work, honestly labeled a prototype, engineered like it expects
            users.
          </p>

          <p style={S.callout}>
            Everything here is inspectable:{' '}
            <a href="https://github.com/hrbohra/plainsheet">github.com/hrbohra/plainsheet</a>
            {' '}(architecture notes, design doc with failure modes, PRR checklist, eval
            results, and the commit history the story is told in).
          </p>
        </article>
      )}

      <p style={{ marginTop: '2.5rem', borderTop: '1px solid #eee', paddingTop: 12, fontSize: 14, color: '#555' }}>
        Built by Harsh Bohra · <a href="https://github.com/hrbohra/plainsheet">source</a> ·{' '}
        <a href="https://www.linkedin.com/in/harshrbohra">LinkedIn</a> · document credit:
        University of Salford TKR study participant information sheet, reproduced with
        attribution for accessibility research demonstration.
      </p>
    </main>
  );
}
