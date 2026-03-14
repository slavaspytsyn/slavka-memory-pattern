/**
 * SMP Embeddings Provider Factory
 */
import { EmbeddingsClient } from './types.js';
import { VertexEmbeddingsClient } from './vertex-client.js';
import { OpenAIEmbeddingsClient } from './openai-client.js';
import { NoopEmbeddingsClient } from './noop-client.js';

export * from './types.js';

let embeddingsInstance: EmbeddingsClient | null = null;

/**
 * Get the configured embeddings client
 */
export function getEmbeddings(): EmbeddingsClient {
  if (embeddingsInstance) {
    return embeddingsInstance;
  }

  const provider = process.env.EMBEDDING_PROVIDER || 'none';

  switch (provider.toLowerCase()) {
    case 'vertex':
      embeddingsInstance = new VertexEmbeddingsClient();
      break;
    case 'openai':
      embeddingsInstance = new OpenAIEmbeddingsClient();
      break;
    case 'none':
    default:
      embeddingsInstance = new NoopEmbeddingsClient();
      break;
  }

  return embeddingsInstance;
}

/**
 * Initialize the embeddings client
 */
export async function initEmbeddings(): Promise<EmbeddingsClient> {
  const client = getEmbeddings();
  await client.initialize();
  return client;
}
