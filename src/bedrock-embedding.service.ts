import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { IEmbeddingProvider } from './interfaces/embedding-provider.js';

const MODEL_ID = 'amazon.titan-embed-text-v2:0';
const DIMENSIONS = 1024;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 4000;

export interface BedrockEmbeddingServiceConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export class BedrockEmbeddingService implements IEmbeddingProvider {
  private client: BedrockRuntimeClient;

  constructor(config: BedrockEmbeddingServiceConfig) {
    this.client = new BedrockRuntimeClient({
      region: config.region,
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
    });
  }

  async embed(text: string): Promise<number[]> {
    return this.withRetry(() => this.invokeOnce(text));
  }

  private async invokeOnce(text: string): Promise<number[]> {
    const response = await this.client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: text, dimensions: DIMENSIONS, normalize: true }),
      }),
    );
    const parsed = JSON.parse(new TextDecoder().decode(response.body)) as { embedding: number[] };
    return parsed.embedding;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status !== 429) throw err; // only retry throttle errors
        if (attempt < MAX_RETRIES) {
          const delay = Math.min(BASE_DELAY_MS * 2 ** attempt + Math.random() * 100, MAX_DELAY_MS);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }
}
