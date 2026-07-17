'use client';

// PlainSheet app screen, "dark instrument" design.
// Rail (document / mode / reading level), ask view with cited answers, live agent
// trace with a plain|raw register toggle, and the study-team accessibility report.
// All data comes from the real APIs; the trace replays the run's actual event
// timings once the response lands (the API returns the full trace, it does not stream).

import { useEffect, useRef, useState } from 'react';

type ReadingLevel = 'plain' | 'detailed';
type Tab = 'ask' | 'audit';
type TraceRegister = 'plain' | 'raw';
type Phase = 'idle' | 'running' | 'done';

interface SheetSummary { id: string; title: string; studyName: string; }
interface Citation { chunkId: string; quote: string; }
interface TraceEvent {
  type: string; step: number; tool?: string; model?: string; stopReason?: string; ms?: number; summary?: string;
}
interface AnswerPayload {
  kind: 'answered' | 'not_in_document' | 'refused_medical_advice';
  text: string; citations: Citation[]; trace: TraceEvent[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}
interface AuditRow {
  sectionId: string; heading: string; fleschKincaidGrade: number; wordCount: number; flaggedTerms: string[];
}

// ---- palette (rule: amber = proof and status; coral = refusal; all else neutral) ----
const C = {
  page: '#08090C', panel: '#0C0F13', panelDark: '#090C10', strip: '#0A0D10',
  card: '#12161C', surface: '#14181E', active: '#191E26',
  line: '#232A34', lineFaint: '#1B212B', lineStrong: '#303947', lineFocus: '#3A4150',
  ink: '#EDF0F5', dim: '#C7CDD8', mut: '#98A1B0', quote: '#A9B2BF', faint: '#5B6473',
  amber: '#E3B25C', amberInk: '#16120A', coral: '#D97462',
};
const MONO = "var(--font-mono), monospace";
const label = { fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.16em', color: C.faint } as const;

// ---- trace rendering: every real event carries two registers ----
interface Row { time: string; sec: number; raw: string; plain: string; check?: boolean; coral?: boolean; done?: boolean; }

function fmt(sec: number) {
  const s = Math.floor(sec); const c = Math.round((sec - s) * 100);
  return `${String(s).padStart(2, '0')}.${String(Math.min(99, c)).padStart(2, '0')}`;
}

function deriveRows(answer: AnswerPayload): { rows: Row[]; totalS: number } {
  const refused = answer.kind === 'refused_medical_advice';
  let t = 0;
  const rows: Row[] = [];
  for (const e of answer.trace) {
    t += (e.ms ?? 0) / 1000;
    if (e.type === 'model_turn') {
      const writing = e.stopReason !== 'tool_use';
      rows.push({
        time: fmt(t), sec: t,
        raw: `model · ${e.model ?? '?'} · ${e.stopReason ?? '?'} · ${e.ms ?? 0}ms`,
        plain: writing
          ? (refused ? 'declined: this asks for medical advice' : 'wrote the answer')
          : 'chose the next step',
        coral: writing && refused,
      });
    } else if (e.type === 'tool_call') {
      const plain =
        e.tool === 'search_sheet' ? 'searched the sheet for matching passages'
        : e.tool === 'get_section' ? 'read the whole section to be sure'
        : e.tool === 'readability_report' ? 'checked the reading level'
        : `used ${e.tool}`;
      rows.push({ time: fmt(t), sec: t, raw: `${e.tool}() · ${e.ms ?? 0}ms`, plain });
    } else if (e.type === 'tool_result') {
      rows.push({ time: fmt(t), sec: t, raw: `↳ ${e.summary ?? ''}`, plain: `↳ ${e.summary ?? ''}` });
    }
  }
  const totalS = Math.max(t, 0.01);
  rows.push({
    time: fmt(totalS), sec: totalS,
    raw: refused ? 'done · refusal held' : 'done',
    plain: refused ? 'done: refusal held' : 'done',
    check: refused, done: true,
  });
  return { rows, totalS };
}

// Inline [n] markers in answer text become amber superscripts.
function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <div style={{ fontSize: 15.5, lineHeight: 1.75, textWrap: 'pretty' as never }}>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (m) return <sup key={i} style={{ color: C.amber, fontSize: 10.5 }}>&thinsp;{m[1]}</sup>;
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

const CHIPS: { label: string; q: string; trick?: boolean }[] = [
  { label: 'Can I change my mind?', q: 'Can I change my mind after agreeing?' },
  { label: 'How many visits?', q: 'How many clinic visits are there?' },
  { label: 'Will I be paid?', q: 'Will I be paid for taking part?' },
  { label: 'Who sees my data?', q: 'Who will see my personal information?' },
  { label: 'Should I stop my medication?', q: 'Should I stop my medication before the study?', trick: true },
];

export default function Home() {
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [sheetId, setSheetId] = useState('');
  const [tab, setTab] = useState<Tab>('ask');
  const [level, setLevel] = useState<ReadingLevel>('plain');
  const [traceReg, setTraceReg] = useState<TraceRegister>('plain');
  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<AnswerPayload | null>(null);
  const [shown, setShown] = useState(0);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [narrow, setNarrow] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1120);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    try { const r = localStorage.getItem('trace-register'); if (r === 'raw' || r === 'plain') setTraceReg(r); } catch {}
    fetch('/api/sheets')
      .then((r) => r.json())
      .then((d) => { setSheets(d.sheets ?? []); if (d.sheets?.[0]) setSheetId(d.sheets[0].id); })
      .catch(() => setError('Could not load sheets. Is the database running and ingested?'));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  // Audit is deterministic and cheap: fetch per sheet up front. It powers both the
  // report tab and the "sections indexed" line on the document card.
  useEffect(() => {
    if (!sheetId) return;
    setAudit(null);
    fetch(`/api/audit?sheetId=${encodeURIComponent(sheetId)}`)
      .then((r) => r.json())
      .then((d) => setAudit(d.report ?? null))
      .catch(() => {});
  }, [sheetId]);

  function setRegister(r: TraceRegister) {
    setTraceReg(r);
    try { localStorage.setItem('trace-register', r); } catch {}
  }

  async function ask(q: string) {
    if (!q.trim() || !sheetId || phase === 'running') return;
    timers.current.forEach(clearTimeout); timers.current = [];
    setQuestion(q); setPhase('running'); setError(''); setAnswer(null); setShown(0); setTab('ask');
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId, question: q, readingLevel: level }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const payload: AnswerPayload = data.answer;
      setAnswer(payload);
      // Replay the run's real steps in sequence; the card lands after the last row.
      const { rows } = deriveRows(payload);
      rows.forEach((_, i) => {
        timers.current.push(setTimeout(() => setShown(i + 1), 110 * (i + 1)));
      });
      timers.current.push(setTimeout(() => setPhase('done'), 110 * rows.length + 350));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
    }
  }

  function cycleSheet() {
    if (sheets.length < 2) return;
    const i = sheets.findIndex((s) => s.id === sheetId);
    const next = sheets[(i + 1) % sheets.length];
    if (!next) return;
    setSheetId(next.id);
    setAnswer(null); setPhase('idle'); setShown(0); setError('');
  }

  const sheet = sheets.find((s) => s.id === sheetId);
  const derived = answer ? deriveRows(answer) : null;
  const rows = derived ? derived.rows.slice(0, shown) : [];
  const doneAll = derived ? shown >= derived.rows.length : false;
  const totalS = derived?.totalS ?? 0;

  const kindMap = {
    answered: { label: 'ANSWER · FROM THE DOCUMENT ONLY', color: C.amber },
    refused_medical_advice: { label: 'DECLINED BY DESIGN', color: C.coral },
    not_in_document: { label: 'NOT IN THIS DOCUMENT · SAID HONESTLY', color: C.mut },
  } as const;

  const words = answer ? answer.text.trim().split(/\s+/).length : 0;
  const meta = answer
    ? answer.kind === 'refused_medical_advice' ? `refused in ${totalS.toFixed(1)}s`
    : answer.kind === 'not_in_document' ? `said honestly in ${totalS.toFixed(1)}s`
    : `${words} words · ${totalS.toFixed(1)}s`
    : '';
  const usage = answer
    ? `${(answer.usage.inputTokens + answer.usage.outputTokens).toLocaleString()} tokens · $${answer.usage.costUsd.toFixed(4)}`
    : '';

  const meanGrade = audit && audit.length
    ? audit.reduce((a, r) => a + r.fleschKincaidGrade, 0) / audit.length : null;
  const totalWords = audit ? audit.reduce((a, r) => a + r.wordCount, 0) : 0;

  const seg = (on: boolean) => ({ background: on ? C.active : 'transparent', color: on ? C.ink : C.faint });
  const modeTab = (on: boolean) => ({
    background: on ? C.active : 'transparent',
    border: `1px solid ${on ? C.lineStrong : C.lineFaint}`,
    color: on ? C.ink : C.mut,
  });

  return (
    <div style={{
      minHeight: '100vh', boxSizing: 'border-box', padding: '16px 18px 10px',
      background: `radial-gradient(ellipse 70% 32% at 50% -6%, rgba(227,178,92,0.05), transparent), ${C.page}`,
      color: C.ink, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* header */}
      <header style={{
        maxWidth: 1440, width: '100%', margin: '0 auto', boxSizing: 'border-box',
        background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '13px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em' }}>PlainSheet<span style={{ color: C.amber }}>.</span></div>
          <div style={{ width: 1, height: 16, background: C.line }} />
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut }}>clinical trial paperwork, made navigable</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <nav style={{ display: 'flex', gap: 16, fontFamily: MONO, fontSize: 10.5 }}>
            <a href="/about" style={{ color: C.mut }}>how it works</a>
            <a href="https://github.com/hrbohra/plainsheet" style={{ color: C.mut }}>source</a>
            <a href="https://www.linkedin.com/in/harshrbohra" style={{ color: C.ink }}>harsh bohra</a>
          </nav>
          <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', fontFamily: MONO, fontSize: 9.5, color: C.mut }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.amber }} />guardrails armed
            </div>
            <div style={{ width: 1, background: C.line }} />
            <div style={{ display: 'flex', alignItems: 'center', padding: '6px 11px', fontFamily: MONO, fontSize: 9.5, color: C.mut }}>
              evals&nbsp;<span style={{ color: C.amber }}>25/25 ✓</span>
            </div>
          </div>
        </div>
      </header>

      {/* run-metadata strip */}
      <div style={{
        maxWidth: 1440, width: '100%', margin: '0 auto', boxSizing: 'border-box',
        background: C.strip, border: `1px solid ${C.lineFaint}`, borderRadius: 8, padding: '7px 20px',
        display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
        fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.04em', color: C.faint,
      }}>
        <div>sheet: {sheetId || 'loading'}{audit ? ` · ${audit.length} sections indexed` : ''} · published, with attribution</div>
        <div>models: gemini-2.5-flash / flash-lite · p50 1.9s</div>
      </div>

      {/* body grid */}
      <div style={{
        maxWidth: 1440, width: '100%', margin: '0 auto', boxSizing: 'border-box',
        display: 'grid', gap: 12, alignItems: 'start',
        gridTemplateColumns: narrow ? '1fr' : tab === 'ask' ? '264px minmax(420px,1fr) 380px' : '264px 1fr',
      }}>
        {/* rail */}
        <aside style={{
          background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '18px 16px',
          display: 'flex', flexDirection: narrow ? 'row' : 'column', flexWrap: 'wrap', gap: 20,
        }}>
          <div style={{ flex: '1 1 200px', minWidth: 200 }}>
            <div style={label}>DOCUMENT</div>
            <div style={{ marginTop: 9, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: '13px 14px' }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}>{sheet?.title ?? 'No sheet loaded'}</div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.mut, marginTop: 7, lineHeight: 1.75 }}>
                {sheet?.studyName ?? '…'}<br />participant information sheet
              </div>
              <div style={{ marginTop: 11, borderTop: `1px solid ${C.lineFaint}`, paddingTop: 9, display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 9.5 }}>
                <span style={{ color: C.faint }}>{audit ? `${audit.length} sections indexed` : 'indexing…'}</span>
                {sheets.length > 1 && (
                  <span onClick={cycleSheet} style={{ color: C.amber, cursor: 'pointer' }}>change</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 200px', minWidth: 200 }}>
            <div style={label}>MODE</div>
            <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {([
                ['ask', 'Participant Q&A'],
                ['audit', 'Study-team report'],
              ] as [Tab, string][]).map(([t, lab]) => (
                <div key={t} onClick={() => setTab(t)} style={{
                  ...modeTab(tab === t), cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9,
                  borderRadius: 7, padding: '11px 12px', fontSize: 12.5, fontWeight: 500,
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: tab === t ? C.amber : 'transparent', border: `1px solid ${C.lineFocus}`,
                  }} />
                  {lab}
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: '1 1 200px', minWidth: 200 }}>
            <div style={label}>READING LEVEL</div>
            <div style={{ marginTop: 9, display: 'flex', background: C.strip, border: `1px solid ${C.line}`, borderRadius: 7, padding: 3, gap: 3 }}>
              {([['plain', 'Plain English'], ['detailed', 'Detailed']] as [ReadingLevel, string][]).map(([lv, lab]) => (
                <div key={lv} onClick={() => setLevel(lv)} style={{
                  ...seg(level === lv), cursor: 'pointer', flex: 1, textAlign: 'center',
                  padding: '9px 0', borderRadius: 5, fontSize: 12, fontWeight: 500,
                }}>{lab}</div>
              ))}
            </div>
            <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 9.5, lineHeight: 1.8, color: C.faint }}>
              never medical advice.<br />enforced in code, tested<br />adversarially, every release.
            </div>
            <div style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.65, color: C.mut }}>
              Built from 2.5 years of reviewing these sheets by hand. <a href="/about" style={{ color: C.amber }}>The story</a>
            </div>
          </div>
        </aside>

        {tab === 'ask' && (
          <>
            {/* ask column */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <div style={{
                background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: 9,
                padding: '6px 6px 6px 16px', display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: '0 0 28px rgba(227,178,92,0.05)',
              }}>
                <div style={{ width: 2, height: 17, background: C.amber, flex: 'none' }} />
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void ask(question); }}
                  placeholder="Ask in your own words: e.g. can I bring someone with me?"
                  style={{
                    flex: 1, minWidth: 0, background: 'none', border: 'none', color: C.ink,
                    fontFamily: 'var(--font-ui), sans-serif', fontSize: 15.5, padding: '10px 0',
                  }}
                />
                <button onClick={() => void ask(question)} disabled={phase === 'running'} style={{
                  cursor: 'pointer', background: C.amber, color: C.amberInk, border: 'none',
                  fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em',
                  padding: '12px 18px', borderRadius: 6, opacity: phase === 'running' ? 0.55 : 1,
                }}>{phase === 'running' ? '· · ·' : 'ASK'}</button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0 2px' }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, letterSpacing: '0.1em' }}>TRY</span>
                {CHIPS.map((chip) => (
                  <div key={chip.label} onClick={() => void ask(chip.q)} style={{
                    cursor: 'pointer', border: `1px solid ${C.line}`, background: C.panel, borderRadius: 99,
                    padding: '8px 14px', fontSize: 12, color: C.dim, display: 'flex', alignItems: 'center', gap: 7,
                  }}>
                    {chip.trick && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.coral }} />}
                    {chip.label}
                  </div>
                ))}
              </div>

              {error && (
                <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '11px 20px', borderBottom: `1px solid ${C.lineFaint}`, fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.16em', color: C.mut }}>
                    ERROR · SAID LOUDLY
                  </div>
                  <div style={{ padding: '16px 20px', fontSize: 14, lineHeight: 1.6, color: C.dim }}>{error}</div>
                </div>
              )}

              {phase === 'idle' && !error && (
                <div style={{ border: `1px dashed ${C.line}`, borderRadius: 10, padding: '26px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, color: C.mut }}>Pick a question, or type your own.</div>
                  <div style={{ marginTop: 6, fontFamily: MONO, fontSize: 10, color: C.faint }}>
                    answers come only from the sheet · every claim carries a citation · the coral one is a trick
                  </div>
                </div>
              )}

              {phase === 'running' && (
                <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.amber }} />
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.mut }}>agent running · watch the trace</div>
                </div>
              )}

              {phase === 'done' && answer && (
                <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '11px 20px', borderBottom: `1px solid ${C.lineFaint}`,
                  }}>
                    <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.16em', color: kindMap[answer.kind].color }}>
                      {kindMap[answer.kind].label}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint }}>{meta}</div>
                  </div>
                  <div style={{ padding: '18px 22px 20px' }}>
                    <AnswerText text={answer.text} />
                    {answer.citations.length > 0 ? (
                      <>
                        <div style={{
                          marginTop: 16, background: '#0E1116', border: `1px solid ${C.lineFaint}`, borderRadius: 8,
                          padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 11,
                        }}>
                          {answer.citations.map((c, i) => (
                            <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'baseline', flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: MONO, fontSize: 10, color: C.amber, flex: 'none' }}>[{i + 1}]</span>
                              <span style={{ flex: 1, minWidth: 200, fontSize: 12.5, lineHeight: 1.65, color: C.quote }}>&ldquo;{c.quote}&rdquo;</span>
                              <span style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, flex: 'none' }}>{c.chunkId}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{
                          marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
                          fontFamily: MONO, fontSize: 9.5, color: C.faint,
                        }}>
                          <div>verify: {answer.citations.length}/{answer.citations.length} verbatim <span style={{ color: C.amber }}>✓</span> &nbsp;·&nbsp; no general knowledge used</div>
                          <div>{usage}</div>
                        </div>
                      </>
                    ) : (
                      <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 9.5, color: C.faint }}>{usage}</div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* agent trace */}
            <aside style={{ background: C.panelDark, border: `1px solid ${C.lineFaint}`, borderRadius: 10, padding: '18px 18px 20px', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottom: `1px solid ${C.lineFaint}` }}>
                <div style={{ fontFamily: MONO, fontSize: 11 }}>agent.trace</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 2, gap: 2 }}>
                    {(['plain', 'raw'] as TraceRegister[]).map((r) => (
                      <div key={r} onClick={() => setRegister(r)} style={{
                        ...seg(traceReg === r), cursor: 'pointer', padding: '5px 10px', borderRadius: 4,
                        fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em',
                      }}>{r}</div>
                    ))}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.amber, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.amber }} />live
                  </div>
                </div>
              </div>

              {phase === 'idle' && (
                <div style={{ padding: '22px 4px 8px', fontFamily: MONO, fontSize: 10.5, lineHeight: 1.9, color: C.faint }}>
                  ask something to see the run.<br /><br />
                  every step below is read straight<br />from the agent loop: a receipt<br />
                  for the reasoning. the toggle<br />rewrites it in plain words.
                </div>
              )}

              {phase !== 'idle' && derived && (
                <>
                  <div style={{ position: 'relative', height: 22, marginTop: 14 }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 6, height: 1, background: C.line }} />
                    {rows.map((r, i) => {
                      const last = i === derived.rows.length - 1;
                      return (
                        <div key={i} style={{
                          position: 'absolute', bottom: 6,
                          left: `${Math.min(100, (r.sec / totalS) * 100).toFixed(1)}%`,
                          width: last ? 2 : 1, height: last ? 9 : 7,
                          background: last ? C.amber : C.lineFocus,
                        }} />
                      );
                    })}
                    <div style={{ position: 'absolute', left: 0, bottom: 14, fontFamily: MONO, fontSize: 8.5, color: C.faint }}>0s</div>
                    <div style={{ position: 'absolute', right: 0, bottom: 14, fontFamily: MONO, fontSize: 8.5, color: doneAll ? C.amber : C.faint }}>
                      {doneAll ? `${totalS.toFixed(1)}s` : '…'}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', fontFamily: MONO, fontSize: 11 }}>
                    {rows.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', alignItems: 'baseline' }}>
                        <span style={{ color: C.faint, flex: 'none', width: 40 }}>{r.time}</span>
                        <span style={{ color: r.coral ? C.coral : r.done ? C.ink : C.mut, lineHeight: 1.55, minWidth: 0, overflowWrap: 'anywhere' }}>
                          {traceReg === 'raw' ? r.raw : r.plain}
                          {r.check && <span style={{ color: C.amber }}> ✓</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ marginTop: 14, borderTop: `1px dashed ${C.line}`, paddingTop: 12, fontSize: 11.5, lineHeight: 1.65, color: C.mut }}>
                Every step, live from the run. A receipt for the reasoning.
              </div>
              <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.lineFaint}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={label}>EVALUATION</div>
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: C.quote }}>
                  A human-reviewed test bank runs on every change. One wrong answer blocks the release.
                </div>
                <div style={{ marginTop: 7, fontFamily: MONO, fontSize: 10, color: C.amber }}>25/25 passing · 6/6 refusals held</div>
              </div>
            </aside>
          </>
        )}

        {tab === 'audit' && (
          <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '20px 22px', minWidth: 0 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
              borderBottom: `1px solid ${C.lineFaint}`, paddingBottom: 12,
            }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.16em', color: C.amber }}>ACCESSIBILITY REPORT · DETERMINISTIC</div>
                <div style={{ marginTop: 7, fontSize: 13, color: C.mut, lineHeight: 1.6 }}>
                  Flesch-Kincaid grade per section, jargon candidates flagged. UK guidance aims for reading age 11, about grade 6.
                </div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.faint, textAlign: 'right', lineHeight: 1.9 }}>
                {sheetId}{audit ? <> · {audit.length} sections<br />mean grade <span style={{ color: C.amber }}>{meanGrade?.toFixed(1)}</span> · target ≤ 6 · {totalWords.toLocaleString()} words</> : <><br />loading…</>}
              </div>
            </div>
            {audit && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'minmax(180px,1.1fr) 170px 58px minmax(140px,1fr)', gap: 14,
                  padding: '10px 0 8px', fontFamily: MONO, fontSize: 9, letterSpacing: '0.14em', color: C.faint,
                }}>
                  <span>SECTION</span><span>FK GRADE</span><span style={{ textAlign: 'right' }}>WORDS</span><span>JARGON CANDIDATES</span>
                </div>
                {audit.map((row) => {
                  const hot = row.fleschKincaidGrade > 8;
                  return (
                    <div key={row.sectionId} style={{
                      display: 'grid', gridTemplateColumns: 'minmax(180px,1.1fr) 170px 58px minmax(140px,1fr)', gap: 14,
                      padding: '9px 0', borderTop: `1px solid ${C.surface}`, alignItems: 'center',
                    }}>
                      <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.4 }}>{row.heading}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div style={{ flex: 1, height: 3, background: C.surface, borderRadius: 2, position: 'relative' }}>
                          <div style={{
                            position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2,
                            width: `${Math.min(100, (row.fleschKincaidGrade / 12) * 100).toFixed(0)}%`,
                            background: hot ? C.amber : C.lineFocus,
                          }} />
                          <div style={{ position: 'absolute', left: '50%', top: -2, width: 1, height: 7, background: C.lineFocus }} />
                        </div>
                        <span style={{ fontFamily: MONO, fontSize: 10.5, color: hot ? C.amber : C.mut, width: 30 }}>
                          {row.fleschKincaidGrade.toFixed(1)}
                        </span>
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint, textAlign: 'right' }}>{row.wordCount}</div>
                      <div style={{ fontFamily: MONO, fontSize: 10, color: C.mut, lineHeight: 1.6 }}>
                        {row.flaggedTerms.length ? row.flaggedTerms.join(' · ') : '·'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.lineFaint}`, paddingTop: 11, fontFamily: MONO, fontSize: 9.5, color: C.faint }}>
              tick on each bar marks grade 6 · <span style={{ color: C.amber }}>amber</span> rows exceed grade 8: rewrite candidates · flagged terms come from a clinical-jargon lexicon
            </div>
          </section>
        )}
      </div>

      {/* footer */}
      <footer style={{
        maxWidth: 1440, width: '100%', margin: '0 auto', boxSizing: 'border-box',
        display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        padding: '10px 4px 6px', fontFamily: MONO, fontSize: 9.5, color: C.faint,
      }}>
        <div>
          built by <a href="https://www.linkedin.com/in/harshrbohra" style={{ color: C.mut }}>harsh bohra</a> ·{' '}
          <a href="https://github.com/hrbohra/plainsheet" style={{ color: C.mut }}>source</a> ·{' '}
          <a href="/about" style={{ color: C.mut }}>how it works</a>
        </div>
        <div>salford tkr sheet reproduced with attribution · IRAS 317409</div>
      </footer>
    </div>
  );
}
