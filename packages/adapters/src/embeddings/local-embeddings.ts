// EmbeddingProvider adapter: all-MiniLM-L6-v2 running locally via transformers.js.
// Free, offline, and no document content leaves the machine at ingest time.
// Tradeoff (recorded in ARCHITECTURE.md): ~25MB quantized model load on cold start.
// If serverless cold starts hurt query latency, swap this adapter for an API-based
// embedder; the port makes that a one-file change.

import { pipeline } from '@xenova/transformers';
import type { EmbeddingProvider } from '@plainsheet/core';

type FeatureExtractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

export class LocalEmbeddings implements EmbeddingProvider {
  private extractorPromise: Promise<FeatureExtractor> | null = null;

  private extractor(): Promise<FeatureExtractor> {
    this.extractorPromise ??= pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
    ) as unknown as Promise<FeatureExtractor>;
    return this.extractorPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extract = await this.extractor();
    const output = await extract(texts, { pooling: 'mean', normalize: true });
    const [count, dim] = [output.dims[0] ?? texts.length, output.dims.at(-1) ?? 384];
    const vectors: number[][] = [];
    for (let i = 0; i < count; i++) {
      vectors.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)));
    }
    return vectors;
  }
}
