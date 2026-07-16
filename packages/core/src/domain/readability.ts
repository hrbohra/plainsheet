// Deterministic readability scoring. Pure functions: unit-tested, no dependencies.
// Flesch-Kincaid grade level is the standard the NHS/HRA accessibility guidance
// gestures at (aim for reading age ~11, roughly grade 6).

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = stripped.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
}

/** Flesch-Kincaid grade level. Returns 0 for empty text. */
export function fleschKincaidGrade(text: string): number {
  const sentences = splitSentences(text);
  const words = splitWords(text);
  if (sentences.length === 0 || words.length === 0) return 0;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const grade =
    0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
  return Math.round(Math.max(0, grade) * 10) / 10;
}

/**
 * Flags candidate jargon: long words that are not on a small allowlist of common
 * long-but-plain words. Deliberately simple and transparent; the agent's LLM pass
 * suggests replacements, this function just finds candidates deterministically.
 */
const PLAIN_LONG_WORDS = new Set([
  'information', 'understand', 'important', 'different', 'questions',
  'appointment', 'appointments', 'hospital', 'medicine', 'medicines',
]);

export function flagJargonCandidates(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of splitWords(text)) {
    const w = raw.toLowerCase().replace(/[^a-z-]/g, '');
    if (w.length >= 11 && !PLAIN_LONG_WORDS.has(w)) seen.add(w);
  }
  return [...seen].sort();
}
