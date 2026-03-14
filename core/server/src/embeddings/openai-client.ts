import { EmbeddingsClient, TaskType, BatchOptions } from './types.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_ID = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;

/**
 * OpenAI Embeddings client using fetch API
 * Model: text-embedding-3-small (1536 dimensions, $0.02/M tokens)
 */
export class OpenAIEmbeddingsClient implements EmbeddingsClient {
  private initialized = false;

  async initialize(): Promise<void> {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required for OpenAI embeddings');
    }
    this.initialized = true;
    console.error('[smp-server] OpenAI Embeddings ready');
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate embedding for a single text with retry on transient errors
   */
  async getEmbedding(text: string, taskType?: TaskType): Promise<number[]> {
    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            input: text,
            model: MODEL_ID,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const statusCode = response.status;
          const errorMessage = errorData.error?.message || response.statusText;

          // Retry on 429 (rate limit) or 503 (service unavailable)
          if ((statusCode === 429 || statusCode >= 500) && attempt < maxRetries) {
            const retryDelay = baseDelay * Math.pow(2, attempt);
            console.error(`[smp-server] OpenAI Embedding retry ${attempt + 1}/${maxRetries} after ${retryDelay}ms: ${errorMessage}`);
            await this.delay(retryDelay);
            continue;
          }
          throw new Error(`OpenAI API error (${statusCode}): ${errorMessage}`);
        }

        const data = await response.json();
        return data.data[0].embedding;
      } catch (error) {
        if (attempt >= maxRetries) {
          throw error;
        }
        const retryDelay = baseDelay * Math.pow(2, attempt);
        console.error(`[smp-server] OpenAI Embedding error (will retry): ${error instanceof Error ? error.message : String(error)}`);
        await this.delay(retryDelay);
      }
    }
    throw new Error('Failed to generate OpenAI embedding');
  }

  /**
   * Batch processing with concurrency control
   */
  async getBatchEmbeddings(
    texts: string[],
    taskType?: TaskType,
    options: BatchOptions = {}
  ): Promise<number[][]> {
    const { concurrency = 5, delayMs = 0 } = options;
    const results: number[][] = new Array(texts.length);
    let index = 0;

    const runWorker = async (): Promise<void> => {
      while (index < texts.length) {
        const currentIndex = index++;
        results[currentIndex] = await this.getEmbedding(texts[currentIndex], taskType);
        if (delayMs > 0) {
          await this.delay(delayMs);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, texts.length) }, () => runWorker());
    await Promise.all(workers);

    return results;
  }

  formatForPgvector(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  getDimension(): number {
    return EMBEDDING_DIMENSION;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
