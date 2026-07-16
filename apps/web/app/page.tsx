'use client';

// PlainSheet UI: ask questions at a chosen reading level, see cited answers,
// watch the agent's step trace, and view the study-team accessibility report.
// One client component, no state library: the app is one fetch per action.

import { useEffect, useState } from 'react';

type ReadingLevel = 'plain' | 'detailed';
type Tab = 'ask' | 'audit';

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

const S = {
  page: { maxWidth: 980, margin: '2.5rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a' } as const,
  card: { border: '1px solid #ddd', borderRadius: 8, padding: '1rem', background: '#fff' } as const,
  badge: (bg: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, background: bg }) as const,
  button: { padding: '8px 16px', borderRadius: 6, border: '1px solid #1a1a1a', background: '#1a1a1a', color: '#fff', cursor: 'pointer' } as const,
};

export default function Home() {
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [sheetId, setSheetId] = useState('');
  const [tab, setTab] = useState<Tab>('ask');
  const [question, setQuestion] = useState('');
  const [level, setLevel] = useState<ReadingLevel>('plain');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<AnswerPayload | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);

  useEffect(() => {
    fetch('/api/sheets')
      .then((r) => r.json())
      .then((d) => {
        setSheets(d.sheets ?? []);
        if (d.sheets?.[0]) setSheetId(d.sheets[0].id);
      })
      .catch(() => setError('Could not load sheets. Is the database running and ingested?'));
  }, []);

  async function ask() {
    if (!question.trim() || !sheetId || busy) return;
    setBusy(true); setError(''); setAnswer(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId, question, readingLevel: level }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAnswer(data.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadAudit() {
    if (!sheetId) return;
    setBusy(true); setError(''); setAudit(null);
    try {
      const res = await fetch(`/api/audit?sheetId=${encodeURIComponent(sheetId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAudit(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const kindBadge = answer && {
    answered: <span style={S.badge('#d9f2d9')}>answered with citations</span>,
    not_in_document: <span style={S.badge('#fff3cd')}>not covered by this sheet</span>,
    refused_medical_advice: <span style={S.badge('#f8d7da')}>medical advice refused by design</span>,
  }[answer.kind];

  return (
    <main style={S.page}>
      <h1 style={{ marginBottom: 4 }}>PlainSheet</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Clinical trial participant information, made navigable. Answers cite the exact
        paragraph. Never medical advice.{' '}
        <a href="/about" style={{ whiteSpace: 'nowrap' }}>New here? How it works →</a>
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '1rem 0' }}>
        <select value={sheetId} onChange={(e) => setSheetId(e.target.value)} style={{ padding: 8 }}>
          {sheets.length === 0 && <option value="">no sheets ingested</option>}
          {sheets.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <nav style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...S.button, ...(tab !== 'ask' ? { background: '#fff', color: '#1a1a1a' } : {}) }} onClick={() => setTab('ask')}>Participant Q&amp;A</button>
          <button style={{ ...S.button, ...(tab !== 'audit' ? { background: '#fff', color: '#1a1a1a' } : {}) }} onClick={() => { setTab('audit'); void loadAudit(); }}>Study-team report</button>
        </nav>
      </div>

      {error && <p style={{ color: '#b00020' }}>{error}</p>}

      {tab === 'ask' && (
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          <div>
            <div style={S.card}>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Your question</label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
                placeholder="e.g. Can I stop taking part once I have started?"
              />
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                <label><input type="radio" checked={level === 'plain'} onChange={() => setLevel('plain')} /> Plain English</label>
                <label><input type="radio" checked={level === 'detailed'} onChange={() => setLevel('detailed')} /> Detailed</label>
                <button style={{ ...S.button, marginLeft: 'auto', opacity: busy ? 0.6 : 1 }} onClick={() => void ask()} disabled={busy}>
                  {busy ? 'Thinking…' : 'Ask'}
                </button>
              </div>
            </div>

            {answer && (
              <div style={{ ...S.card, marginTop: 16 }}>
                <div style={{ marginBottom: 8 }}>{kindBadge}</div>
                <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{answer.text}</p>
                {answer.citations.length > 0 && (
                  <ol style={{ borderTop: '1px solid #eee', paddingTop: 8, color: '#444', fontSize: 14 }}>
                    {answer.citations.map((c, i) => (
                      <li key={i}><em>&ldquo;{c.quote}&rdquo;</em> <code style={{ fontSize: 12 }}>{c.chunkId}</code></li>
                    ))}
                  </ol>
                )}
                <p style={{ fontSize: 12, color: '#888' }}>
                  {answer.usage.inputTokens + answer.usage.outputTokens} tokens · ${answer.usage.costUsd.toFixed(4)}
                </p>
              </div>
            )}
          </div>

          <aside style={{ ...S.card, background: '#fafafa', alignSelf: 'start' }}>
            <strong>Agent trace</strong>
            <p style={{ fontSize: 12, color: '#777', marginTop: 4 }}>Every step the agent took, live from the run.</p>
            {!answer && <p style={{ fontSize: 13, color: '#999' }}>Ask something to see the steps.</p>}
            {answer?.trace.map((t, i) => (
              <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #eee' }}>
                {t.type === 'model_turn' && <span>step {t.step}: <strong>{t.model}</strong> → {t.stopReason} ({t.ms}ms)</span>}
                {t.type === 'tool_call' && <span>step {t.step}: tool <strong>{t.tool}</strong> ({t.ms}ms)</span>}
                {t.type === 'tool_result' && <span style={{ color: '#666' }}>↳ {t.summary}</span>}
              </div>
            ))}
          </aside>
        </section>
      )}

      {tab === 'audit' && (
        <section style={S.card}>
          <strong>Accessibility report</strong>
          <p style={{ fontSize: 13, color: '#666' }}>
            Deterministic readability metrics per section. UK guidance aims for a reading age
            of about 11 (roughly grade 6).
          </p>
          {!audit && <p style={{ color: '#999' }}>{busy ? 'Loading…' : 'No report loaded.'}</p>}
          {audit && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: 6 }}>Section</th><th>FK grade</th><th>Words</th><th>Jargon candidates</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((row) => (
                  <tr key={row.sectionId} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: 6 }}>{row.heading}</td>
                    <td style={{ color: row.fleschKincaidGrade > 8 ? '#b00020' : '#1a7f37' }}>{row.fleschKincaidGrade}</td>
                    <td>{row.wordCount}</td>
                    <td>{row.flaggedTerms.join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
