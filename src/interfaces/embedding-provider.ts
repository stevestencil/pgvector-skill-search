/**
 * Provider-agnostic embedding interface.
 * Ships with BedrockEmbeddingService. Community can add OpenAI, Cohere, etc.
 */
export interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
