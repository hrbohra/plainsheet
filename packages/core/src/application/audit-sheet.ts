// Study-team accessibility audit: deterministic readability metrics per section
// plus (optionally, day 2) LLM-suggested plain-language rewrites for flagged terms.

import { fleschKincaidGrade, flagJargonCandidates, splitWords } from '../domain/readability.js';
import type { ReadabilityReport, Sheet } from '../domain/types.js';

export function auditSheet(sheet: Sheet): ReadabilityReport[] {
  return sheet.sections.map((s) => ({
    sectionId: s.id,
    heading: s.heading,
    fleschKincaidGrade: fleschKincaidGrade(s.text),
    wordCount: splitWords(s.text).length,
    flaggedTerms: flagJargonCandidates(s.text),
  }));
}

// TODO(day 2): add suggestRewrites(deps, report) that asks the tool model for
// plain-language alternatives per flagged term, one batched call per section.
