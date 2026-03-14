// Vertex AI Embeddings client
// Uses dynamic import to avoid slow SDK loading at startup
import { EmbeddingsClient, TaskType, BatchOptions } from './types.js';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';
const MODEL_ID = 'text-multilingual-embedding-002';
const EMBEDDING_DIMENSION = 768;

// Lazy-loaded client
let _client: any = null;

async function getClient() {
  if (!_client) {
    const { PredictionServiceClient } = await import('@google-cloud/aiplatform');
    _client = new PredictionServiceClient({
      apiEndpoint: `${LOCATION}-aiplatform.googleapis.com`,
    });
  }
  return _client;
}

export class VertexEmbeddingsClient implements EmbeddingsClient {
  private endpoint: string;
  private initialized = false;

  constructor() {
    this.endpoint = `projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}`;
  }

  async initialize(): Promise<void> {
    if (!PROJECT_ID) {
      throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required for Vertex AI embeddings');
    }
    if (this.initialized) return;
    this.initialized = true;
    console.error('[smp-server] Vertex AI Embeddings ready (lazy init)');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate embedding for a single text with retry on transient errors
   */
  async getEmbedding(text: string, taskType: TaskType = 'RETRIEVAL_DOCUMENT'): Promise<number[]> {
    // Truncate text if too long (max ~10000 tokens for multilingual model)
    const truncatedText = text.length > 20000 ? text.slice(0, 20000) : text;

    const instances = [
      {
        structValue: {
          fields: {
            content: { stringValue: truncatedText },
            task_type: { stringValue: taskType },
          },
        },
      },
    ];

    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const client = await getClient();
        const [response] = await client.predict({
          endpoint: this.endpoint,
          instances: instances,
        });

        const predictions = response.predictions;
        if (!predictions || predictions.length === 0) {
          throw new Error('No embeddings returned from Vertex AI');
        }

        const prediction = predictions[0];
        const embeddings = prediction.structValue?.fields?.embeddings;
        const values = embeddings?.structValue?.fields?.values?.listValue?.values;

        if (!values || values.length === 0) {
          throw new Error('Invalid embedding response structure');
        }

        return values.map((v: any) => v.numberValue ?? 0);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const statusCode = (error as any)?.code || (error as any)?.statusCode || 0;

        // Retry on 429 (rate limit) or 503 (service unavailable)
        const isRetryable = statusCode === 429 || statusCode === 503
          || statusCode === 8 /* RESOURCE_EXHAUSTED */ || statusCode === 14 /* UNAVAILABLE */
          || errorMessage.includes('429') || errorMessage.includes('503')
          || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('UNAVAILABLE');

        if (isRetryable && attempt < maxRetries) {
          const retryDelay = baseDelay * Math.pow(2, attempt);
          console.error(`[smp-server] Vertex AI Embedding retry ${attempt + 1}/${maxRetries} after ${retryDelay}ms: ${errorMessage}`);
          await this.delay(retryDelay);
          continue;
        }

        console.error('[smp-server] Vertex AI Embedding error:', errorMessage);
        throw new Error(`Failed to generate embedding: ${errorMessage}`);
      }
    }
    throw new Error('Failed to generate Vertex AI embedding');
  }

  /**
   * Batch processing with concurrency control
   */
  async getBatchEmbeddings(
    texts: string[],
    taskType: TaskType = 'RETRIEVAL_DOCUMENT',
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
