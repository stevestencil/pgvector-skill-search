import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { PgvectorSkillSearchAdapter } from '../src/pgvector-skill-search.adapter.js';
import type { Pool, QueryResult } from 'pg';
import type { IEmbeddingProvider } from '../src/interfaces/embedding-provider.js';
import type { IReranker } from '../src/interfaces/reranker.js';
import type { Logger } from '../src/logger.js';

type QueryMock = Mock<(...args: unknown[]) => Promise<QueryResult>>;

function makePool(overrides: Partial<Pool> = {}): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    ...overrides,
  } as unknown as Pool;
}

function queryMock(pool: Pool): QueryMock {
  return pool.query as unknown as QueryMock;
}

function makeEmbedding(vector: number[] = Array.from({ length: 1024 }, () => 0.1)): IEmbeddingProvider {
  return { embed: vi.fn().mockResolvedValue(vector) };
}

function makeAi(): IReranker {
  return {
    complete: vi.fn().mockResolvedValue({
      textContent: '[{"index": 1, "score": 0.9}]',
    }),
  };
}

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('PgvectorSkillSearchAdapter', () => {
  let pool: Pool;
  let adapter: PgvectorSkillSearchAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = makePool();
    adapter = new PgvectorSkillSearchAdapter(pool, makeEmbedding(), makeAi(), logger);
  });

  it('initialize() resolves without querying the DB', async () => {
    await adapter.initialize();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('close() resolves without error', async () => {
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it('addCollection() resolves without error', async () => {
    await expect(adapter.addCollection({ name: 'global' })).resolves.toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('addVirtualCollection() resolves without error', async () => {
    await expect(adapter.addVirtualCollection('org_abc')).resolves.toBeUndefined();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('listCollections() returns distinct collection names', async () => {
    queryMock(pool).mockResolvedValueOnce({
      rows: [{ collection: 'global' }, { collection: 'org_abc' }],
    } as unknown as QueryResult);
    const result = await adapter.listCollections();
    expect(result).toEqual(['global', 'org_abc']);
  });

  it('indexCollection() resolves without error', async () => {
    await expect(adapter.indexCollection('global')).resolves.toBeUndefined();
  });

  it('indexAll() resolves without error', async () => {
    await expect(adapter.indexAll()).resolves.toBeUndefined();
  });

  it('removeCollection() deletes all documents for that collection', async () => {
    await adapter.removeCollection('org_abc');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM skill_documents'),
      ['org_abc'],
    );
  });

  it('listDocuments() returns skill paths from DB', async () => {
    queryMock(pool).mockResolvedValueOnce({
      rows: [{ skill_name: 'record-sale' }, { skill_name: 'pay-bill' }],
    } as unknown as QueryResult);
    const result = await adapter.listDocuments('global');
    expect(result).toEqual(['record-sale.md', 'pay-bill.md']);
  });

  it('getDocument() returns content or null', async () => {
    queryMock(pool)
      .mockResolvedValueOnce({ rows: [{ content: 'skill body' }] } as unknown as QueryResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);

    expect(await adapter.getDocument('global', 'record-sale.md')).toBe('skill body');
    expect(await adapter.getDocument('global', 'missing.md')).toBeNull();
  });

  it('upsertDocument() skips Bedrock call when content hash is unchanged', async () => {
    const content = '---\nname: pay-bill\n---\nBody.';
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(content).digest('hex');

    queryMock(pool).mockResolvedValueOnce({
      rows: [{ content_hash: hash }],
    } as unknown as QueryResult);

    const embedding = makeEmbedding();
    adapter = new PgvectorSkillSearchAdapter(pool, embedding, makeAi(), logger);
    await adapter.upsertDocument('global', 'pay-bill.md', content);

    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it('upsertDocument() calls Bedrock and upserts when content changed', async () => {
    queryMock(pool)
      .mockResolvedValueOnce({ rows: [{ content_hash: 'old-hash' }] } as unknown as QueryResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);

    const embedding = makeEmbedding();
    adapter = new PgvectorSkillSearchAdapter(pool, embedding, makeAi(), logger);
    await adapter.upsertDocument('global', 'pay-bill.md', 'new content');

    expect(embedding.embed).toHaveBeenCalledWith('new content');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('deleteDocument() deletes by collection and skill_name', async () => {
    await adapter.deleteDocument('global', 'old-skill.md');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM skill_documents'),
      ['global', 'old-skill'],
    );
  });

  it('search() returns empty array when no collections given', async () => {
    const results = await adapter.search({ query: 'test' }, []);
    expect(results).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('search() rejects invalid collection names', async () => {
    await expect(
      adapter.search({ query: 'test' }, ['valid', 'bad; DROP TABLE skill_documents;--']),
    ).rejects.toThrow('Invalid collection name');
  });

  it('search() returns results with correct shape', async () => {
    const candidateRows = [
      {
        id: 'uuid-1',
        skill_name: 'record-sale',
        collection: 'global',
        content: '---\nname: record-sale\ntags: [sale]\ntriggers: []\n---\nBody.',
        rrf_score: 0.85,
      },
    ];
    queryMock(pool).mockResolvedValueOnce({
      rows: candidateRows,
    } as unknown as QueryResult);

    const results = await adapter.search({ query: 'record a sale', limit: 3 }, ['global']);
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('record-sale.md');
    expect(results[0]?.collection).toBe('global');
    expect(results[0]?.score).toBeGreaterThan(0);
    expect(results[0]?.metadata.name).toBe('record-sale');
  });

  it('upsertDocument() skips upsert when embedding fails', async () => {
    queryMock(pool).mockResolvedValueOnce({ rows: [{ content_hash: 'old-hash' }] } as unknown as QueryResult);

    const failingEmbedding: IEmbeddingProvider = {
      embed: vi.fn().mockRejectedValue(new Error('Bedrock unavailable')),
    };
    adapter = new PgvectorSkillSearchAdapter(pool, failingEmbedding, makeAi(), logger);
    await adapter.upsertDocument('global', 'skill.md', 'new content');

    expect(logger.warn).toHaveBeenCalled();
    // Only 1 query (hash check) — no INSERT
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('upsertDocument() performs INSERT when no existing hash is found', async () => {
    // getDocument returns null → no existing row → should call embed and INSERT
    queryMock(pool)
      .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult)   // hash check: no row
      .mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);  // INSERT

    const embedding = makeEmbedding();
    adapter = new PgvectorSkillSearchAdapter(pool, embedding, makeAi(), logger);
    await adapter.upsertDocument('global', 'new-skill.md', '---\nname: new-skill\n---\nBody.');

    expect(embedding.embed).toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('search() falls back to BM25 when embedding fails', async () => {
    const failingEmbedding: IEmbeddingProvider = {
      embed: vi.fn().mockRejectedValue(new Error('Bedrock unavailable')),
    };
    const candidateRows = [
      {
        id: 'uuid-1',
        skill_name: 'pay-bill',
        collection: 'global',
        content: '---\nname: pay-bill\ntags: []\ntriggers: []\n---\nBody.',
        rrf_score: 0.7,
      },
    ];
    queryMock(pool).mockResolvedValueOnce({
      rows: candidateRows,
    } as unknown as QueryResult);

    const ai = makeAi();
    adapter = new PgvectorSkillSearchAdapter(pool, failingEmbedding, ai, logger);
    const results = await adapter.search({ query: 'pay a bill', limit: 3 }, ['global']);

    expect(logger.warn).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('pay-bill.md');
  });

  it('search() falls back to RRF scores when reranking fails', async () => {
    const candidateRows = [
      {
        id: 'uuid-1',
        skill_name: 'record-sale',
        collection: 'global',
        content: '---\nname: record-sale\ntags: []\ntriggers: []\n---\nBody.',
        rrf_score: 0.5,
      },
      {
        id: 'uuid-2',
        skill_name: 'pay-bill',
        collection: 'global',
        content: '---\nname: pay-bill\ntags: []\ntriggers: []\n---\nBody.',
        rrf_score: 0.3,
      },
    ];
    queryMock(pool).mockResolvedValueOnce({
      rows: candidateRows,
    } as unknown as QueryResult);

    const failingAi: IReranker = {
      complete: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
    };
    adapter = new PgvectorSkillSearchAdapter(pool, makeEmbedding(), failingAi, logger);
    const results = await adapter.search({ query: 'record sale', limit: 3 }, ['global']);

    expect(logger.warn).toHaveBeenCalled();
    // Fallback: normalize by Math.max(maxRrfScore, 1) = Math.max(0.5, 1) = 1
    // so record-sale score = 0.5 / 1 = 0.5, pay-bill = 0.3 / 1 = 0.3
    expect(results).toHaveLength(2);
    expect(results[0]?.path).toBe('record-sale.md');
    expect(results[0]?.score).toBeCloseTo(0.5);
  });

  it('search() returns empty array when candidates list is empty', async () => {
    queryMock(pool).mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);
    const results = await adapter.search({ query: 'anything', limit: 3 }, ['global']);
    expect(results).toEqual([]);
  });

  it('upsertDocument() throws when embedding contains non-finite values', async () => {
    queryMock(pool).mockResolvedValueOnce({ rows: [{ content_hash: 'old-hash' }] } as unknown as QueryResult);

    const nanEmbedding: IEmbeddingProvider = {
      embed: vi.fn().mockResolvedValue([NaN, 0.1, 0.2]),
    };
    adapter = new PgvectorSkillSearchAdapter(pool, nanEmbedding, makeAi(), logger);
    await expect(
      adapter.upsertDocument('global', 'skill.md', 'new content'),
    ).rejects.toThrow('not finite');
  });

  it('search() throws when embedding returns non-finite values in query vector', async () => {
    const nanEmbedding: IEmbeddingProvider = {
      embed: vi.fn().mockResolvedValue([NaN, 0.5]),
    };
    queryMock(pool).mockResolvedValueOnce({ rows: [] } as unknown as QueryResult);

    adapter = new PgvectorSkillSearchAdapter(pool, nanEmbedding, makeAi(), logger);
    // Non-finite embedding in search triggers the BM25-only fallback
    const results = await adapter.search({ query: 'test' }, ['global']);
    expect(logger.warn).toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('search() falls back to RRF scores when rerank response has no JSON array', async () => {
    const candidateRows = [
      {
        id: 'uuid-1',
        skill_name: 'record-sale',
        collection: 'global',
        content: '---\nname: record-sale\ntags: []\ntriggers: []\n---\nBody.',
        rrf_score: 0.8,
      },
    ];
    queryMock(pool).mockResolvedValueOnce({
      rows: candidateRows,
    } as unknown as QueryResult);

    const noJsonAi: IReranker = {
      complete: vi.fn().mockResolvedValue({ textContent: 'No valid JSON here at all.' }),
    };
    adapter = new PgvectorSkillSearchAdapter(pool, makeEmbedding(), noJsonAi, logger);
    const results = await adapter.search({ query: 'sale', limit: 3 }, ['global']);

    expect(logger.warn).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe('record-sale.md');
  });

  it('search() filters out rerank results with out-of-bounds index', async () => {
    const candidateRows = [
      {
        id: 'uuid-1',
        skill_name: 'record-sale',
        collection: 'global',
        content: '---\nname: record-sale\ntags: []\ntriggers: []\n---\nBody.',
        rrf_score: 0.85,
      },
    ];
    queryMock(pool).mockResolvedValueOnce({
      rows: candidateRows,
    } as unknown as QueryResult);

    // Return an index that is out of bounds for the candidates array
    const outOfBoundsAi: IReranker = {
      complete: vi.fn().mockResolvedValue({
        textContent: '[{"index": 99, "score": 0.9}]',
      }),
    };
    adapter = new PgvectorSkillSearchAdapter(pool, makeEmbedding(), outOfBoundsAi, logger);
    const results = await adapter.search({ query: 'sale', limit: 3 }, ['global']);
    // Out-of-bounds index gets filtered → empty results
    expect(results).toHaveLength(0);
  });
});
