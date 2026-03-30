import type {
  SkillSearchResult,
  SkillSearchInput,
  CollectionConfig,
} from '../types.js';

/**
 * Adapter interface for semantic skill search.
 *
 * Production: QMD (hybrid BM25 + vector + LLM rerank)
 * Tests: InMemory (keyword match on tags/triggers)
 * Future: HTTP sidecar adapter for multi-server deployment
 */
export interface ISkillSearchAdapter {
  /**
   * Initialize the search engine (open database, load models, etc.).
   * Must be called once during app startup before any other methods.
   */
  initialize(): Promise<void>;

  /**
   * Search for skills matching a natural language query.
   * Searches across the specified collections and returns ranked results.
   */
  search(input: SkillSearchInput, collections: string[]): Promise<SkillSearchResult[]>;

  /**
   * Retrieve a specific skill document by its path within a collection.
   * Returns null if the document does not exist.
   */
  getDocument(collection: string, path: string): Promise<string | null>;

  /**
   * Register a new collection for indexing (e.g., when a new org is created).
   */
  addCollection(config: CollectionConfig): Promise<void>;

  /**
   * Remove a collection and its index data (e.g., when an org is deleted).
   */
  removeCollection(name: string): Promise<void>;

  /**
   * Re-index a single collection after files have been added/modified.
   */
  indexCollection(name: string): Promise<void>;

  /**
   * Re-index all registered collections. Called during startup.
   */
  indexAll(): Promise<void>;

  /**
   * List all registered collection names.
   */
  listCollections(): Promise<string[]>;

  /**
   * Gracefully shut down the search engine (close DB, unload models).
   */
  close(): Promise<void>;

  /**
   * Write a document directly to the search index (no filesystem).
   * Used for org-scoped skills that live only in the database.
   * If a document at the same path already exists, it is updated in place.
   */
  upsertDocument(collection: string, path: string, content: string): Promise<void>;

  /**
   * Remove a document from the search index (soft delete, no filesystem).
   */
  deleteDocument(collection: string, path: string): Promise<void>;

  /**
   * List all document paths in a collection directly from the search index.
   * Used for virtual collections where there is no filesystem directory.
   */
  listDocuments(collection: string): Promise<string[]>;

  /**
   * Register a virtual collection (no filesystem path).
   * Documents are managed exclusively via upsertDocument/deleteDocument.
   */
  addVirtualCollection(name: string): Promise<void>;
}
