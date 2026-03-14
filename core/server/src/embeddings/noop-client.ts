import { EmbeddingsClient, TaskType, BatchOptions } from './types.js';

/**
 * No-op Embeddings client (FTS-only mode)
 * Returns empty embeddings, forcing the search engine to skip vector search.
 */
export class NoopEmbeddingsClient implements EmbeddingsClient {
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
    console.error('[smp-server] No-op Embeddings active (FTS-only mode)');
  }

  async getEmbedding(text: string, taskType?: TaskType): Promise<number[]> {
    return [];
  }

  async getBatchEmbeddings(
    texts: string[],
    taskType?: TaskType,
    options?: BatchOptions
  ): Promise<number[][]> {
    return texts.map(() => []);
  }

  formatForPgvector(embedding: number[]): string {
    throw new Error('Vector operations not supported in No-op mode');
  }

  getDimension(): number {
    return 0;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
