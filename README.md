# @stevestencil/pgvector-skill-search

Postgres pgvector-backed semantic skill search. Hybrid BM25 + cosine similarity + LLM reranking for markdown-based skill/tool document libraries.

**Accuracy (100-query accounting benchmark):** 64% rank-1 / 82% top-3

## Features

- Stores markdown skill documents in PostgreSQL with pgvector HNSW embeddings
- Hybrid search: BM25 (tsvector) + cosine vector distance + Reciprocal Rank Fusion
- Optional Claude reranking via a swappable `IReranker` interface
- Content-addressable upsert (SHA-256, skips unchanged docs)
- Orphan cleanup (deletes removed documents)
- Multiple named collections (e.g. `global` + per-org)

## Installation

```bash
npm install @stevestencil/pgvector-skill-search pg
```

## Schema setup

Run the SQL in `sql/schema.sql` once against your Postgres database:

```bash
psql $DATABASE_URL < node_modules/@stevestencil/pgvector-skill-search/sql/schema.sql
```

Requires PostgreSQL 15+ with the pgvector extension available.

## Usage

```typescript
import pg from 'pg';
import {
  PgvectorSkillSearchAdapter,
  BedrockEmbeddingService,
  SkillSeederService,
} from '@stevestencil/pgvector-skill-search';
import type { Logger } from '@stevestencil/pgvector-skill-search';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const embedding = new BedrockEmbeddingService({ region: 'us-east-1' });

// Optional: plug in any LLM for reranking
const reranker = myAiAdapter; // must implement IReranker.complete()

// console is compatible with Logger structurally, but TypeScript strict mode
// may require a cast. For strict mode, use an explicit typed logger:
const logger: Logger = {
  info: (obj, msg?) => console.info(typeof obj === 'string' ? obj : JSON.stringify(obj), msg),
  warn: (obj, msg?) => console.warn(typeof obj === 'string' ? obj : JSON.stringify(obj), msg),
  error: (obj, msg?) => console.error(typeof obj === 'string' ? obj : JSON.stringify(obj), msg),
};

const adapter = new PgvectorSkillSearchAdapter(pool, embedding, reranker, logger);
await adapter.initialize();

// Seed global skills from disk
const seeder = new SkillSeederService(adapter, '/path/to/skills/global', logger);
await seeder.seed();

// Search
const results = await adapter.search(
  { query: 'how do I record a customer payment?', limit: 3 },
  ['global', 'org_abc123'],
);
```

## Embedding providers

Ships with `BedrockEmbeddingService` (Amazon Titan Embeddings V2, 1024 dims).
Any class implementing `IEmbeddingProvider` works — OpenAI, Cohere, etc.

## Reranking

Pass any object implementing `IReranker` as the third constructor argument.
Pass `null` to disable reranking (falls back to RRF scores).

## QA benchmark

```bash
DATABASE_URL=... npx tsx node_modules/@stevestencil/pgvector-skill-search/scripts/skill-search-qa.ts
```
