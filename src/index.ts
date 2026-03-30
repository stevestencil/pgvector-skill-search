// Public API surface for @stevestencil/pgvector-skill-search

export type {
  SkillMetadata,
  SkillSearchResult,
  SkillSearchInput,
  CollectionConfig,
} from './types.js';

export type { Logger } from './logger.js';
export type { ISkillSearchAdapter } from './interfaces/skill-search-adapter.js';
export type { IEmbeddingProvider } from './interfaces/embedding-provider.js';
export type {
  IReranker,
  RerankerCompletionInput,
  RerankerCompletionResult,
} from './interfaces/reranker.js';

export { parseSkillFrontmatter, extractSkillTitle } from './parse-frontmatter.js';
export { BedrockEmbeddingService } from './bedrock-embedding.service.js';
export type { BedrockEmbeddingServiceConfig } from './bedrock-embedding.service.js';
export { SkillSeederService } from './skill-seeder.service.js';
export type { FsInterface } from './skill-seeder.service.js';
export { PgvectorSkillSearchAdapter } from './pgvector-skill-search.adapter.js';
