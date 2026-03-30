/**
 * Minimal LLM interface used only for reranking search candidates.
 * Structurally compatible with IAiAdapter from packages/api.
 */
export interface RerankerCompletionInput {
  systemPrompt: Array<{ type: 'text'; text: string }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  temperature: number;
}

export interface RerankerCompletionResult {
  textContent: string;
}

export interface IReranker {
  complete(input: RerankerCompletionInput): Promise<RerankerCompletionResult>;
}
