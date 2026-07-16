// ChunkRepository adapter: Postgres + pgvector. Hybrid retrieval = lexical rank
// and vector rank fused with reciprocal rank fusion (k=60, the standard constant).

import pg from 'pg';
import type { Chunk, Sheet } from '@plainsheet/core';
import type { ChunkRepository, RetrievedChunk } from '@plainsheet/core';

const RRF_K = 60;

export class PgChunkRepository implements ChunkRepository {
  constructor(private readonly pool: pg.Pool) {}

  async saveSheet(sheet: Sheet, chunks: Chunk[], embeddings: number[][]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sheets (id, title, study_name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, study_name = EXCLUDED.study_name`,
        [sheet.id, sheet.title, sheet.studyName],
      );
      await client.query('DELETE FROM sections WHERE sheet_id = $1', [sheet.id]);
      for (const s of sheet.sections) {
        await client.query(
          'INSERT INTO sections (id, sheet_id, idx, heading, body) VALUES ($1, $2, $3, $4, $5)',
          [s.id, s.sheetId, s.index, s.heading, s.text],
        );
      }
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]!;
        const vec = `[${(embeddings[i] ?? []).join(',')}]`;
        await client.query(
          `INSERT INTO chunks (id, sheet_id, section_id, section_heading, idx, body, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
          [c.id, c.sheetId, c.sectionId, c.sectionHeading, c.index, c.text, vec],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async search(sheetId: string, queryText: string, queryEmbedding: number[], limit: number): Promise<RetrievedChunk[]> {
    const vec = `[${queryEmbedding.join(',')}]`;
    // Two ranked lists (lexical, vector) fused with RRF in SQL.
    const { rows } = await this.pool.query(
      `WITH lexical AS (
         SELECT id, row_number() OVER (ORDER BY ts_rank_cd(lexeme, plainto_tsquery('english', $2)) DESC) AS r
         FROM chunks
         WHERE sheet_id = $1 AND lexeme @@ plainto_tsquery('english', $2)
         LIMIT 20
       ),
       semantic AS (
         SELECT id, row_number() OVER (ORDER BY embedding <=> $3::vector) AS r
         FROM chunks
         WHERE sheet_id = $1 AND embedding IS NOT NULL
         LIMIT 20
       ),
       fused AS (
         SELECT id, SUM(1.0 / ($4 + r)) AS score
         FROM (SELECT id, r FROM lexical UNION ALL SELECT id, r FROM semantic) ranked
         GROUP BY id
       )
       SELECT c.id, c.sheet_id, c.section_id, c.section_heading, c.idx, c.body, f.score
       FROM fused f JOIN chunks c ON c.id = f.id
       ORDER BY f.score DESC
       LIMIT $5`,
      [sheetId, queryText, vec, RRF_K, limit],
    );
    return rows.map((row) => ({
      score: Number(row.score),
      chunk: this.rowToChunk(row),
    }));
  }

  async getSection(sheetId: string, sectionId: string): Promise<Chunk[]> {
    const { rows } = await this.pool.query(
      `SELECT id, sheet_id, section_id, section_heading, idx, body
       FROM chunks WHERE sheet_id = $1 AND section_id = $2 ORDER BY idx`,
      [sheetId, sectionId],
    );
    return rows.map((row) => this.rowToChunk(row));
  }

  async listSheets(): Promise<Array<Pick<Sheet, 'id' | 'title' | 'studyName'>>> {
    const { rows } = await this.pool.query('SELECT id, title, study_name FROM sheets ORDER BY created_at');
    return rows.map((r) => ({ id: r.id, title: r.title, studyName: r.study_name }));
  }

  async getSheet(sheetId: string): Promise<Sheet | null> {
    const sheet = await this.pool.query('SELECT id, title, study_name FROM sheets WHERE id = $1', [sheetId]);
    if (sheet.rows.length === 0) return null;
    const sections = await this.pool.query(
      'SELECT id, sheet_id, idx, heading, body FROM sections WHERE sheet_id = $1 ORDER BY idx',
      [sheetId],
    );
    return {
      id: sheet.rows[0].id,
      title: sheet.rows[0].title,
      studyName: sheet.rows[0].study_name,
      sections: sections.rows.map((r) => ({
        id: r.id, sheetId: r.sheet_id, index: r.idx, heading: r.heading, text: r.body,
      })),
    };
  }

  private rowToChunk(row: Record<string, unknown>): Chunk {
    return {
      id: String(row['id']),
      sheetId: String(row['sheet_id']),
      sectionId: String(row['section_id']),
      sectionHeading: String(row['section_heading']),
      index: Number(row['idx']),
      text: String(row['body']),
    };
  }
}
