# @stevestencil/pgvector-skill-search

Postgres pgvector-backed semantic skill search. Hybrid BM25 + cosine similarity + LLM reranking for markdown-based skill/tool document libraries.

**Accuracy (100-query accounting benchmark):** 64% rank-1 / 82% top-3

## Features

- Stores markdown skill documents in PostgreSQL with pgvector HNSW embeddings
- Hybrid search: BM25 (tsvector) + cosine vector distance + Reciprocal Rank Fusion
- Optional LLM reranking via a swappable `IReranker` interface (works with any LLM)
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

Ships with `BedrockEmbeddingService` (Amazon Titan Embeddings V2, 1024 dims). Any class implementing `IEmbeddingProvider` works:

```typescript
import type { IEmbeddingProvider } from '@stevestencil/pgvector-skill-search';

// OpenAI example
class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  private client: OpenAI;
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }
  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }
}

// Cohere example
class CohereEmbeddingProvider implements IEmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.cohere.com/v2/embed', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.COHERE_API_KEY}` },
      body: JSON.stringify({ texts: [text], model: 'embed-english-v3.0', input_type: 'search_query' }),
    });
    const data = await response.json();
    return data.embeddings[0];
  }
}

// Use whichever provider you want
const embedding = new OpenAIEmbeddingProvider(process.env.OPENAI_API_KEY);
```

## Reranking

Pass any object implementing `IReranker` as the third constructor argument. The interface is minimal — just a `complete()` method that takes a prompt and returns text:

```typescript
import type { IReranker, RerankerCompletionInput } from '@stevestencil/pgvector-skill-search';

// OpenAI example
class OpenAIReranker implements IReranker {
  private client: OpenAI;
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }
  async complete(input: RerankerCompletionInput) {
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: input.systemPrompt.map(s => s.text).join('\n') },
        ...input.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    });
    return { textContent: response.choices[0].message.content ?? '' };
  }
}

// Anthropic example
class AnthropicReranker implements IReranker {
  private client: Anthropic;
  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }
  async complete(input: RerankerCompletionInput) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      system: input.systemPrompt.map(s => s.text).join('\n'),
      messages: input.messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    });
    return { textContent: response.content[0].type === 'text' ? response.content[0].text : '' };
  }
}

// Or disable reranking entirely (falls back to RRF scores)
const adapter = new PgvectorSkillSearchAdapter(pool, embedding, null, logger);
```

## QA benchmark

```bash
DATABASE_URL=... npx tsx node_modules/@stevestencil/pgvector-skill-search/scripts/skill-search-qa.ts
```
