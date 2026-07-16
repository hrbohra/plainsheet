import { describe, expect, it } from 'vitest';
import { chunkSection } from '../src/domain/chunker.js';
import { countSyllables, flagJargonCandidates, fleschKincaidGrade, splitSentences } from '../src/domain/readability.js';
import type { Section } from '../src/domain/types.js';

describe('readability', () => {
  it('counts syllables plausibly', () => {
    expect(countSyllables('cat')).toBe(1);
    expect(countSyllables('table')).toBe(2);
    expect(countSyllables('randomisation')).toBeGreaterThanOrEqual(4);
    expect(countSyllables('')).toBe(0);
  });

  it('scores simple text at a low grade and dense text higher', () => {
    const simple = 'You can stop at any time. You do not need a reason. Just tell the team.';
    const dense =
      'Participation necessitates comprehensive pharmacokinetic evaluation encompassing ' +
      'longitudinal venepuncture procedures administered at predetermined intervals.';
    expect(fleschKincaidGrade(simple)).toBeLessThan(6);
    expect(fleschKincaidGrade(dense)).toBeGreaterThan(12);
  });

  it('returns 0 for empty text', () => {
    expect(fleschKincaidGrade('')).toBe(0);
  });

  it('flags long jargon but not allowlisted plain words', () => {
    const flagged = flagJargonCandidates('The randomisation and venepuncture information.');
    expect(flagged).toContain('randomisation');
    expect(flagged).toContain('venepuncture');
    expect(flagged).not.toContain('information');
  });

  it('splits sentences on terminal punctuation', () => {
    expect(splitSentences('One. Two! Three?')).toHaveLength(3);
  });
});

describe('chunker', () => {
  const section = (text: string): Section => ({
    id: 'sheet1::s1', sheetId: 'sheet1', index: 1, heading: 'What will happen to me?', text,
  });

  it('keeps a short section as one chunk', () => {
    const chunks = chunkSection(section('A short section. Nothing more.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.sectionHeading).toBe('What will happen to me?');
  });

  it('splits long sections and never crosses section boundaries', () => {
    const sentence = 'This sentence is repeated to force the section over the size limit for chunking. ';
    const chunks = chunkSection(section(sentence.repeat(40)), { maxChars: 500, overlapSentences: 1 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.sectionId).toBe('sheet1::s1');
      expect(c.text.length).toBeLessThanOrEqual(700); // maxChars plus one sentence of slack
    }
  });

  it('overlaps consecutive chunks by the configured sentence count', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} carries some content.`).join(' ');
    const chunks = chunkSection(section(text), { maxChars: 300, overlapSentences: 1 });
    for (let i = 1; i < chunks.length; i++) {
      const prevLastSentence = splitSentences(chunks[i - 1]!.text).at(-1)!;
      expect(chunks[i]!.text.startsWith(prevLastSentence)).toBe(true);
    }
  });

  it('produces stable, citable chunk ids', () => {
    const chunks = chunkSection(section('One. Two.'));
    expect(chunks[0]?.id).toBe('sheet1::s1::0');
  });
});
