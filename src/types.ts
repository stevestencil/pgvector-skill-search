export interface SkillSearchResult {
  /** Relative path within the collection (e.g., "record-sale.md") */
  path: string;
  /** Which collection this result came from (e.g., "global" or "org_abc123") */
  collection: string;
  /** Relevance score from the search engine (0-1, higher is better) */
  score: number;
  /** Full markdown content of the skill file */
  content: string;
  /** Parsed frontmatter metadata from the skill file */
  metadata: SkillMetadata;
}

export interface SkillMetadata {
  /** Kebab-case skill name (e.g., "record-sale-with-deposit") */
  name: string;
  /** Searchable tags for keyword matching */
  tags: string[];
  /** Natural language trigger phrases */
  triggers: string[];
  /** Whether this org skill is flagged for promotion to global */
  globalCandidate: boolean;
  /** Who created the skill: "developer" for global, "ai" for org-learned */
  createdBy: 'developer' | 'ai' | 'user';
}

export interface SkillSearchInput {
  /** Natural language query (e.g., "how to record a sale with deposit") */
  query: string;
  /** Maximum number of results to return (default: 3) */
  limit?: number;
}

export interface CollectionConfig {
  /** Collection name (e.g., "global" or "org_abc123") */
  name: string;
  /** Filesystem path to the collection's skill files. Required for filesystem-backed collections, omitted for virtual (DB-only). */
  path?: string;
  /** Glob pattern for skill files (default: "**\/*.md") */
  pattern?: string;
}
