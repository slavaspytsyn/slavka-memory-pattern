/**
 * SMP Embeddings Client Interface
 */

export type TaskType = 
  | 'RETRIEVAL_DOCUMENT' 
  | 'RETRIEVAL_QUERY' 
  | 'SEMANTIC_SIMILARITY' 
  | 'CLASSIFICATION';

export interface BatchOptions {
  concurrency?: number;
  delayMs?: number;
}

export interface EmbeddingsClient {
  /**
   * Generate embedding for a single text
   */
  getEmbedding(text: string, taskType?: TaskType): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts in batch
   */
  getBatchEmbeddings(
    texts: string[],
    taskType?: TaskType,
    options?: BatchOptions
  ): Promise<number[][]>;

  /**
   * Format embedding array for PostgreSQL pgvector (e.g. "[0.1, 0.2, ...]")
   */
  formatForPgvector(embedding: number[]): string;

  /**
   * Get the embedding dimension (e.g. 768 for Vertex, 1536 for OpenAI)
   */
  getDimension(): number;

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean;

  /**
   * Perform any async initialization
   */
  initialize(): Promise<void>;
}
