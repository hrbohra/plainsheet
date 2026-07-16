// Section-aware chunking. Chunks never cross section boundaries so citations can
// always name their section; long sections split on sentence boundaries with overlap.

import type { Chunk, Section } from './types.js';
import { splitSentences } from './readability.js';

export interface ChunkOptions {
  /** target chunk size in characters */
  maxChars: number;
  /** trailing sentences repeated at the start of the next chunk */
  overlapSentences: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1200, overlapSentences: 1 };

export function chunkSection(section: Section, opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  const sentences = splitSentences(section.text);
  if (sentences.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const sentence of sentences) {
    if (currentLen + sentence.length > opts.maxChars && current.length > 0) {
      chunks.push(current.join(' '));
      current = current.slice(current.length - opts.overlapSentences);
      currentLen = current.reduce((n, s) => n + s.length + 1, 0);
    }
    current.push(sentence);
    currentLen += sentence.length + 1;
  }
  if (current.length > 0) chunks.push(current.join(' '));

  return chunks.map((text, index) => ({
    id: `${section.id}::${index}`,
    sheetId: section.sheetId,
    sectionId: section.id,
    sectionHeading: section.heading,
    index,
    text,
  }));
}

export function chunkSheet(sections: Section[], opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  return sections.flatMap((s) => chunkSection(s, opts));
}
