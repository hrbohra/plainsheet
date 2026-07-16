// Domain model. The ubiquitous language of the problem: participant information
// sheets, sections, chunks, citations, reading levels. No I/O, no framework types.

export type ReadingLevel = 'plain' | 'detailed';

export interface Sheet {
  id: string;
  title: string;
  /** e.g. the study or trial name the sheet belongs to */
  studyName: string;
  sections: Section[];
}

export interface Section {
  id: string;
  sheetId: string;
  /** 1-based order within the sheet */
  index: number;
  heading: string;
  text: string;
}

/** Retrieval unit. Chunks never cross section boundaries (citations must be exact). */
export interface Chunk {
  id: string;
  sheetId: string;
  sectionId: string;
  sectionHeading: string;
  /** 0-based order within the section */
  index: number;
  text: string;
}

export interface Citation {
  chunkId: string;
  sectionHeading: string;
  /** verbatim supporting text from the chunk */
  quote: string;
}

export type AnswerKind = 'answered' | 'not_in_document' | 'refused_medical_advice';

export interface Answer {
  kind: AnswerKind;
  text: string;
  citations: Citation[];
  readingLevel: ReadingLevel;
  trace: TraceEvent[];
  usage: UsageTotals;
}

/** One entry per agent step, rendered in the UI trace panel and used by evals. */
export type TraceEvent =
  | { type: 'tool_call'; step: number; tool: string; input: unknown; ms: number }
  | { type: 'tool_result'; step: number; tool: string; summary: string }
  | { type: 'model_turn'; step: number; model: string; stopReason: string; ms: number };

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  /** USD, computed from per-model pricing at call time */
  costUsd: number;
}

export interface ReadabilityReport {
  sectionId: string;
  heading: string;
  fleschKincaidGrade: number;
  wordCount: number;
  /** long or jargon terms worth a plain-language alternative */
  flaggedTerms: string[];
}
