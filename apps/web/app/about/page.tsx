'use client';

// The guide page practices what the product preaches: one story, two depths,
// chosen by the reader. "Dark instrument" design; static content, no API calls.

import { useState } from 'react';
import Link from 'next/link';

type Depth = 'plain' | 'hood';

const C = {
  page: '#08090C', panel: '#0C0F13', strip: '#0A0D10', active: '#191E26',
  line: '#232A34', lineFaint: '#1B212B',
  ink: '#EDF0F5', dim: '#C7CDD8', mut: '#98A1B0', faint: '#5B6473',
  amber: '#E3B25C', amberInk: '#16120A', coral: '#D97462',
};
const MONO = 'var(--font-mono), monospace';

const SECTIONS: { n: string; h: string; plain: string; hood: string; mono?: string }[] = [
  {
    n: '01', h: 'The problem',
    plain: 'Before anyone joins a clinical trial, they get a participant information sheet. It is legally required, often ten pages long, and written by researchers rather than for readers. People sign up without really understanding what happens at visit three, whether they can quit, or who sees their data. And the study teams who want to fix this review these documents by hand, line by line.',
    hood: 'A participant information sheet typically lands around reading grade 9 or 10; UK guidance asks for roughly grade 6, a reading age of 11. The gap is invisible to the people who wrote the document and expensive to find by hand: review is manual, line by line, and does not scale past one reviewer’s attention.',
  },
  {
    n: '02', h: 'What it does',
    plain: 'You pick a trial document and ask questions in your own words: can I change my mind? What happens at the second visit? Will I be paid? PlainSheet answers in plain English or in detail, your choice, and every answer comes with receipts: numbered quotes showing the exact sentence that supports each claim. There is also a mode for study teams: a report scoring each section for reading difficulty, with the jargon highlighted.',
    hood: 'A bounded agent loop (max 6 steps) with three tools: search_sheet, hybrid retrieval fusing BM25-style lexical scoring with pgvector similarity via reciprocal rank fusion; get_section for full section text; readability_report for deterministic metrics. Every claim must cite a retrieved chunk. A provider port swaps Gemini for Anthropic with one env var; a cheap fast model runs tool steps, a stronger one writes the user-facing answer. Cost and latency are logged per step.',
    mono: 'question → parse → safety screen → retrieve (BM25 + pgvector, RRF) → draft at chosen reading level → verify citations verbatim → answer | not_in_document | refused',
  },
  {
    n: '03', h: 'The most important thing it does not do',
    plain: 'PlainSheet never gives medical advice. Ask whether you should join the trial, skip a dose, or ignore a symptom, and it refuses and tells you who to actually ask. That is not a limitation it apologises for; it is the first rule the system is built around, and it is attacked with trick questions in testing to prove it holds. A tool that knows what it must not answer is worth more than one that answers everything.',
    hood: 'Refusal is a hard output class, not a prompt suggestion: advice-seeking questions short-circuit before retrieval runs. An adversarial golden set (painkillers, dosage, should-I-join, symptom triage) runs in CI on every change. Latest run: 6/6 refusals held, median refusal latency under 900ms, because the decline happens at the safety screen, not after a full generation.',
  },
  {
    n: '04', h: 'Why you can trust the answers',
    plain: 'Three habits keep it honest. It only speaks from the document, never from general knowledge; if the sheet does not answer, it says so and points to the study team. It shows its work: the trace panel lists every step it took, like a receipt for the reasoning, and can explain itself in plain words or raw detail. And it is graded like a student: a test bank reviewed by a human who did this job professionally runs against every change, and a change that gets an answer wrong does not ship.',
    hood: 'Three mechanisms. Cite-or-refuse: every claim must reference a retrieved chunk verbatim, or the system returns not_in_document. Transparency: the trace UI renders the agent loop’s own events (model turns, tool calls, tool results, timings), not a reconstruction. Evals in CI: faithfulness, refusal, reading level, latency, and cost, scored on golden sets across two sheets. Latest run: 25/25 passing. A red row blocks the merge.',
    mono: 'evals: faithfulness · refusal · reading-level · latency · cost\nlatest: 25/25 PASS · refusals 6/6 · p50 1.9s · $0.0000 total',
  },
];

const STEPS: { n: string; coral?: boolean; body: React.ReactNode }[] = [
  { n: '1', body: <>Ask <span style={{ color: C.ink }}>&ldquo;Can I change my mind after agreeing?&rdquo;</span> and watch the trace panel think, step by step.</> },
  { n: '2', body: <>Check the numbered quotes under the answer against the sheet. They are verbatim, or the answer does not ship.</> },
  { n: '3', coral: true, body: <>Then ask <span style={{ color: C.ink }}>&ldquo;Should I stop my medication?&rdquo;</span> and watch it decline, politely, by design.</> },
];

export default function About() {
  const [depth, setDepth] = useState<Depth>('plain');
  const seg = (on: boolean) => ({ background: on ? C.active : 'transparent', color: on ? C.ink : C.faint });

  return (
    <div style={{
      minHeight: '100vh', boxSizing: 'border-box', padding: '16px 18px 40px', color: C.ink,
      background: `radial-gradient(ellipse 70% 30% at 50% -6%, rgba(227,178,92,0.06), transparent), ${C.page}`,
    }}>
      <header style={{
        maxWidth: 860, margin: '0 auto', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10,
        padding: '13px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em', color: C.ink }}>
            PlainSheet<span style={{ color: C.amber }}>.</span>
          </Link>
          <div style={{ width: 1, height: 16, background: C.line }} />
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut }}>how it works</div>
        </div>
        <Link href="/" style={{ fontFamily: MONO, fontSize: 10.5, color: C.mut }}>← back to the app</Link>
      </header>

      <div style={{ maxWidth: 680, margin: '56px auto 0' }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', color: C.amber }}>ONE STORY, TWO DEPTHS</div>
        <h1 style={{ margin: '14px 0 0', fontSize: 38, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.12 }}>
          How PlainSheet works
        </h1>
        <p style={{ margin: '16px 0 0', fontSize: 16, lineHeight: 1.7, color: C.mut }}>
          Pick the version written for you. Switching any time is the whole point of this product, so the page practices what it preaches.
        </p>
        <div style={{ marginTop: 26, display: 'inline-flex', background: C.strip, border: `1px solid ${C.line}`, borderRadius: 8, padding: 4, gap: 4 }}>
          {([['plain', 'Plain English'], ['hood', 'Under the hood']] as [Depth, string][]).map(([d, lab]) => (
            <button key={d} onClick={() => setDepth(d)} style={{
              ...seg(depth === d), cursor: 'pointer', border: 'none', padding: '10px 20px', borderRadius: 6,
              fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-ui), sans-serif',
            }}>{lab}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: '14px auto 0', display: 'flex', flexDirection: 'column' }}>
        {SECTIONS.map((sec) => (
          <section key={sec.n} style={{ borderTop: `1px solid ${C.lineFaint}`, marginTop: 34, paddingTop: 30 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.amber }}>{sec.n}</span>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{sec.h}</h2>
            </div>
            <p style={{ margin: '14px 0 0', fontSize: 15.5, lineHeight: 1.75, color: C.dim, whiteSpace: 'pre-line' }}>
              {depth === 'plain' ? sec.plain : sec.hood}
            </p>
            {depth === 'hood' && sec.mono && (
              <div style={{
                marginTop: 14, background: C.strip, border: `1px solid ${C.lineFaint}`, borderRadius: 8,
                padding: '13px 16px', fontFamily: MONO, fontSize: 11, lineHeight: 1.9, color: C.mut,
                overflowX: 'auto', whiteSpace: 'pre-wrap',
              }}>{sec.mono}</div>
            )}
          </section>
        ))}

        <section style={{ borderTop: `1px solid ${C.lineFaint}`, marginTop: 34, paddingTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.amber }}>05</span>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>Try it in thirty seconds</h2>
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {STEPS.map((s) => (
              <div key={s.n} style={{
                display: 'flex', gap: 14, alignItems: 'baseline', background: C.panel,
                border: `1px solid ${C.line}`, borderRadius: 8, padding: '14px 16px',
              }}>
                <span style={{ fontFamily: MONO, fontSize: 10, color: s.coral ? C.coral : C.faint, flex: 'none' }}>{s.n}</span>
                <span style={{ fontSize: 14, lineHeight: 1.6, color: C.dim }}>{s.body}</span>
              </div>
            ))}
          </div>
          <Link href="/" style={{
            display: 'inline-block', marginTop: 18, background: C.amber, color: C.amberInk,
            fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
            padding: '13px 22px', borderRadius: 7,
          }}>OPEN THE APP →</Link>
        </section>

        <section style={{ borderTop: `1px solid ${C.lineFaint}`, marginTop: 40, paddingTop: 28 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '22px 24px' }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.16em', color: C.faint }}>THE PERSON BEHIND IT</div>
            <p style={{ margin: '12px 0 0', fontSize: 14.5, lineHeight: 1.75, color: C.dim }}>
              For two and a half years I sat on a Cardiff University public advisory group for a cancer prehabilitation study,
              reading participant information sheets and marking, by hand, the parts a real person would struggle with.
              PlainSheet is that job, automated: same standards, same refusals, now repeatable on every document and every code change.
            </p>
            <div style={{ marginTop: 14, fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
              harsh bohra · <a href="https://github.com/hrbohra/plainsheet">source</a> · <a href="https://www.linkedin.com/in/harshrbohra">linkedin</a>
            </div>
          </div>
        </section>

        <div style={{ marginTop: 26, fontFamily: MONO, fontSize: 9.5, lineHeight: 1.8, color: C.faint }}>
          document credit: University of Salford TKR study participant information sheet (IRAS 317409),
          reproduced with attribution for accessibility research demonstration · will be removed on request
        </div>
      </div>
    </div>
  );
}
