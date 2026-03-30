import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BedrockEmbeddingService } from '../src/bedrock-embedding.service.js';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

vi.mock('@aws-sdk/client-bedrock-runtime');

const mockSend = vi.fn();
vi.mocked(BedrockRuntimeClient).mockImplementation(
  () => ({ send: mockSend }) as unknown as BedrockRuntimeClient,
);

function makeEmbeddingResponse(dims = 1024): { body: Uint8Array } {
  const embedding = Array.from({ length: dims }, (_, i) => i / dims);
  return { body: new TextEncoder().encode(JSON.stringify({ embedding })) };
}

describe('BedrockEmbeddingService', () => {
  let service: BedrockEmbeddingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BedrockEmbeddingService({ region: 'us-east-1' });
  });

  it('returns a 1024-dimensional embedding on success', async () => {
    mockSend.mockResolvedValueOnce(makeEmbeddingResponse(1024));
    const result = await service.embed('record a payment');
    expect(result).toHaveLength(1024);
    expect(result[0]).toBeTypeOf('number');
  });

  it('retries on throttling error and succeeds', async () => {
    const throttleError = Object.assign(new Error('throttled'), {
      $metadata: { httpStatusCode: 429 },
    });
    mockSend
      .mockRejectedValueOnce(throttleError)
      .mockRejectedValueOnce(throttleError)
      .mockResolvedValueOnce(makeEmbeddingResponse(1024));

    const result = await service.embed('pay electric bill');
    expect(result).toHaveLength(1024);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting 3 retries', async () => {
    const throttleError = Object.assign(new Error('throttled'), {
      $metadata: { httpStatusCode: 429 },
    });
    mockSend.mockRejectedValue(throttleError);
    await expect(service.embed('test query')).rejects.toThrow('throttled');
    expect(mockSend).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('does not retry on non-throttle errors', async () => {
    const authError = Object.assign(new Error('not authorized'), {
      $metadata: { httpStatusCode: 403 },
    });
    mockSend.mockRejectedValueOnce(authError);
    await expect(service.embed('test')).rejects.toThrow('not authorized');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('accepts explicit credentials in config', () => {
    // Exercises the truthy branch of (config.accessKeyId && config.secretAccessKey)
    const serviceWithCreds = new BedrockEmbeddingService({
      region: 'us-west-2',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(serviceWithCreds).toBeDefined();
  });
});
