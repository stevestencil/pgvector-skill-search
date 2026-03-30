import { createHash } from 'crypto';
import type { Pool } from 'pg';
import type { Logger } from './logger.js';
import type { IEmbeddingProvider } from './interfaces/embedding-provider.js';
import type { IReranker } from './interfaces/reranker.js';
import type { ISkillSearchAdapter } from './interfaces/skill-search-adapter.js';
import type { SkillSearchResult, SkillSearchInput, CollectionConfig } from './types.js';
import { parseSkillFrontmatter } from './parse-frontmatter.js';

function pathToSkillName(filePath: string): string {
  return filePath.replace(/\.md$/, '');
}

function skillNameToPath(skillName: string): string {
  return `${skillName}.md`;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class PgvectorSkillSearchAdapter implements ISkillSearchAdapter {
  constructor(
    private readonly pool: Pool,
    private readonly embedding: IEmbeddingProvider,
    private readonly ai: IReranker,
    private readonly logger: Logger,
  ) {}

  initialize(): Promise<void> {
    this.logger.info('PgvectorSkillSearchAdapter initialized');
    return Promise.resolve();
  }

  async close(): Promise<void> {
    // No-op — caller manages Pool lifecycle
  }

  async addCollection(_config: CollectionConfig): Promise<void> {
    // Collections are implicit column values — no registration needed
  }

  async addVirtualCollection(_name: string): Promise<void> {
    // Org collections are just column values — no registration needed
  }

  async removeCollection(name: string): Promise<void> {
    await this.pool.query('DELETE FROM skill_documents WHERE collection = $1', [name]);
  }

  async listCollections(): Promise<string[]> {
    const result = await this.pool.query<{ collection: string }>(
      'SELECT DISTINCT collection FROM skill_documents ORDER BY collection',
    );
    return result.rows.map((r) => r.collection);
  }

  async listDocuments(collection: string): Promise<string[]> {
    const result = await this.pool.query<{ skill_name: string }>(
      'SELECT skill_name FROM skill_documents WHERE collection = $1',
      [collection],
    );
    return result.rows.map((r) => skillNameToPath(r.skill_name));
  }

  async getDocument(collection: string, path: string): Promise<string | null> {
    const skillName = pathToSkillName(path);
    const result = await this.pool.query<{ content: string }>(
      'SELECT content FROM skill_documents WHERE collection = $1 AND skill_name = $2 LIMIT 1',
      [collection, skillName],
    );
    const row = result.rows[0];
    return row?.content ?? null;
  }

  async upsertDocument(collection: string, path: string, content: string): Promise<void> {
    const skillName = pathToSkillName(path);
    const newHash = sha256(content);

    // Check existing hash to avoid unnecessary embedding calls
    const existing = await this.pool.query<{ content_hash: string }>(
      'SELECT content_hash FROM skill_documents WHERE collection = $1 AND skill_name = $2 LIMIT 1',
      [collection, skillName],
    );

    const existingRow = existing.rows[0];
    if (existingRow?.content_hash === newHash) return; // unchanged

    let vector: number[];
    try {
      vector = await this.embedding.embed(content);
    } catch (err) {
      this.logger.warn({ collection, skillName, err }, 'Bedrock embedding failed — skipping upsert');
      return;
    }

    // Validate all values are safe finite numbers before string interpolation.
    const safeVector = vector.map((v, i) => {
      if (!Number.isFinite(v)) throw new Error(`Embedding value at index ${i} is not finite: ${String(v)}`);
      return v;
    });
    const vectorStr = `[${safeVector.join(',')}]`;

    // Extract title from frontmatter name: field or fall back to skillName
    const title = content.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? skillName;
    const id = crypto.randomUUID();

    await this.pool.query(
      `INSERT INTO skill_documents (id, collection, skill_name, title, content, content_hash, embedding, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, '${vectorStr}'::vector, NOW(), NOW())
       ON CONFLICT (collection, skill_name) DO UPDATE SET
         content      = EXCLUDED.content,
         content_hash = EXCLUDED.content_hash,
         title        = EXCLUDED.title,
         embedding    = EXCLUDED.embedding,
         updated_at   = NOW()`,
      [id, collection, skillName, title, content, newHash],
    );
  }

  async deleteDocument(collection: string, path: string): Promise<void> {
    const skillName = pathToSkillName(path);
    await this.pool.query(
      'DELETE FROM skill_documents WHERE collection = $1 AND skill_name = $2',
      [collection, skillName],
    );
  }

  async indexCollection(_name: string): Promise<void> {
    // SkillSeederService handles global reindexing. Org skills written via upsertDocument.
  }

  async indexAll(): Promise<void> {
    // SkillSeederService handles global reindexing on boot.
  }

  async search(input: SkillSearchInput, collections: string[]): Promise<SkillSearchResult[]> {
    const { query, limit = 3 } = input;
    if (collections.length === 0) return [];

    // Validate collection names to prevent SQL injection
    for (const col of collections) {
      if (!/^[a-zA-Z0-9_]+$/.test(col)) {
        throw new Error(`Invalid collection name: ${col}`);
      }
    }

    // 1. Embed the query (best-effort — fall back to BM25 only if embedding fails)
    let queryVector: number[] | null = null;
    try {
      const raw = await this.embedding.embed(query);
      raw.forEach((v, i) => {
        if (!Number.isFinite(v)) throw new Error(`Non-finite embedding value at ${i}`);
      });
      queryVector = raw;
    } catch (err) {
      this.logger.warn({ err }, 'Bedrock embedding failed for query — using BM25 only');
    }

    // 2. Run hybrid BM25 + vector RRF (or BM25-only fallback)
    type RawRow = {
      id: string;
      skill_name: string;
      collection: string;
      content: string;
      rrf_score: number;
    };

    let candidates: RawRow[];

    if (queryVector !== null) {
      const vectorStr = `[${queryVector.join(',')}]`;
      const sql = `
        WITH bm25 AS (
          SELECT id, skill_name, collection, content,
                 ROW_NUMBER() OVER (ORDER BY ts_rank(content_tsv, websearch_to_tsquery('english', $1)) DESC) AS bm25_rank
          FROM skill_documents
          WHERE collection = ANY($2::text[])
            AND content_tsv @@ websearch_to_tsquery('english', $1)
          ORDER BY ts_rank(content_tsv, websearch_to_tsquery('english', $1)) DESC
          LIMIT 20
        ),
        vec AS (
          SELECT id, skill_name, collection, content,
                 ROW_NUMBER() OVER (ORDER BY embedding <-> '${vectorStr}'::vector ASC) AS vec_rank
          FROM skill_documents
          WHERE collection = ANY($2::text[])
            AND embedding IS NOT NULL
          ORDER BY embedding <-> '${vectorStr}'::vector ASC
          LIMIT 20
        ),
        fused AS (
          SELECT
            COALESCE(b.id, v.id)                     AS id,
            COALESCE(b.skill_name, v.skill_name)     AS skill_name,
            COALESCE(b.collection, v.collection)     AS collection,
            COALESCE(b.content, v.content)            AS content,
            COALESCE(1.0 / (b.bm25_rank::float + 60), 0) +
            COALESCE(1.0 / (v.vec_rank::float + 60), 0)  AS rrf_score
          FROM bm25 b FULL OUTER JOIN vec v ON b.id = v.id
        )
        SELECT * FROM fused ORDER BY rrf_score DESC LIMIT 20
      `;
      const result = await this.pool.query<RawRow>(sql, [query, collections]);
      candidates = result.rows;
    } else {
      // BM25-only fallback when vector embedding unavailable
      const sql = `
        SELECT id, skill_name, collection, content,
               ts_rank(content_tsv, websearch_to_tsquery('english', $1))::float AS rrf_score
        FROM skill_documents
        WHERE collection = ANY($2::text[])
          AND content_tsv @@ websearch_to_tsquery('english', $1)
        ORDER BY rrf_score DESC
        LIMIT 20
      `;
      const result = await this.pool.query<RawRow>(sql, [query, collections]);
      candidates = result.rows;
    }

    if (candidates.length === 0) return [];

    // 3. Rerank top-20 candidates using LLM, then return top `limit` results
    const reranked = await this.rerank(query, candidates);

    return reranked.slice(0, limit).map((r) => ({
      path: skillNameToPath(r.skill_name),
      collection: r.collection,
      score: r.score,
      content: r.content,
      metadata: parseSkillFrontmatter(r.content),
    }));
  }

  private async rerank(
    query: string,
    candidates: Array<{ id: string; skill_name: string; collection: string; content: string; rrf_score: number }>,
  ): Promise<Array<{ skill_name: string; collection: string; content: string; score: number }>> {
    try {
      const candidateList = candidates
        .map((c, i) => `[${i + 1}] ${c.skill_name}: ${c.content.slice(0, 300)}`)
        .join('\n\n');

      const result = await this.ai.complete({
        systemPrompt: [
          {
            type: 'text',
            text: 'You are a skill search ranker. Rank the most relevant accounting skills for the given query.',
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Query: "${query}"\n\nCandidates:\n${candidateList}\n\nReturn a JSON array of the top 5 most relevant results (or fewer if there aren't 5 relevant ones). Format:\n[{"rank": 1, "index": <1-based index>, "score": <0.0-1.0>}, ...]`,
          },
        ],
        maxTokens: 512,
        temperature: 0,
      });

      // Extract JSON array from response (may be wrapped in markdown code blocks)
      const jsonMatch = result.textContent.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array in rerank response');

      const ranked = JSON.parse(jsonMatch[0]) as Array<{ index: number; score: number }>;
      return ranked
        .filter(
          (r) =>
            typeof r.index === 'number' &&
            r.index >= 1 &&
            r.index <= candidates.length &&
            typeof r.score === 'number',
        )
        .flatMap((r) => {
          const c = candidates[r.index - 1];
          if (c === undefined) return [];
          return [{
            skill_name: c.skill_name,
            collection: c.collection,
            content: c.content,
            score: r.score,
          }];
        });
    } catch (err) {
      // Fallback: normalize RRF scores to 0–1 range
      this.logger.warn({ err }, 'Reranking failed — falling back to RRF scores');
      const maxScore = Math.max(...candidates.map((c) => c.rrf_score), 1);
      return candidates.map((c) => ({
        skill_name: c.skill_name,
        collection: c.collection,
        content: c.content,
        score: c.rrf_score / maxScore,
      }));
    }
  }
}
