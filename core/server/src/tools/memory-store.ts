// memory_store MCP tool

import { z } from 'zod';
import type { PostgresDriver } from '../database/pg-driver.js';
import type { EmbeddingsClient } from '../embeddings/types.js';
import type { StoreResult, MemoryType } from '../types.js';

export const memoryStoreSchema = z.object({
  content: z.string().min(1).describe('The memory content to store'),
  type: z.enum(['general', 'code', 'decision', 'context', 'error', 'task'])
    .optional()
    .default('general')
    .describe('Memory type'),
  project: z.string()
    .optional()
    .default('default')
    .describe('Project name for organizing memories (e.g., "my-api", "website")'),
  importance: z.number().min(1).max(10)
    .optional()
    .default(5)
    .describe('Importance level 1-10'),
  expiresIn: z.string()
    .optional()
    .describe('Expiration duration (e.g., "7d", "30d", "never")'),
  metadata: z.record(z.unknown())
    .optional()
    .describe('Additional metadata'),
});

export type MemoryStoreInput = z.infer<typeof memoryStoreSchema>;

export async function memoryStore(
  input: MemoryStoreInput,
  db: PostgresDriver,
  embeddings: EmbeddingsClient
): Promise<StoreResult> {
  const { content, type, project, importance, expiresIn, metadata } = input;

  // Generate embedding
  let embeddingStr: string | null = null;
  try {
    const embedding = await embeddings.getEmbedding(content, 'RETRIEVAL_DOCUMENT');
    if (embedding && embedding.length > 0) {
      embeddingStr = embeddings.formatForPgvector(embedding);
    }
  } catch (error) {
    console.error('[smp-server] Failed to generate embedding:', error);
    // Continue without embedding
  }

  // Generate summary for long content
  const summary = content.length > 200
    ? content.slice(0, 200).trim() + '...'
    : null;

  // Calculate expiration
  const expiresAt = calculateExpiration(expiresIn);

  // Extract simple entities
  const entities = extractSimpleEntities(content);

  // Insert memory
  const result = await db.queryOne<{ id: string }>(
    `INSERT INTO memories (content, summary, type, project, importance, embedding, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)
     RETURNING id`,
    [
      content,
      summary,
      type,
      project || 'default',
      importance,
      embeddingStr,
      expiresAt,
      JSON.stringify(metadata || {}),
    ]
  );

  if (!result) {
    throw new Error('Failed to store memory');
  }

  // Link entities
  for (const entity of entities) {
    await linkEntity(db, result.id, entity);
  }

  // Record provenance
  await db.execute(
    `INSERT INTO provenance (memory_id, operation, source)
     VALUES ($1, 'create', 'smp-server')`,
    [result.id]
  );

  return {
    id: result.id,
    summary: summary || content.slice(0, 100) + '...',
    entities: entities.map((e) => e.name),
    expiresAt,
  };
}

function calculateExpiration(duration: string | undefined): Date | null {
  if (!duration || duration === 'never') {
    return null;
  }

  const match = duration.match(/^(\d+)([hdwm])$/);
  if (!match) {
    console.error(`[smp-server] Invalid duration format: ${duration}`);
    return null;
  }

  const [, value, unit] = match;
  const multipliers: Record<string, number> = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() + parseInt(value, 10) * multipliers[unit]);
}

function extractSimpleEntities(content: string): { name: string; type: string }[] {
  const entities: { name: string; type: string }[] = [];

  // Extract file paths
  const fileMatches = content.match(/[\w\/\-\.]+\.(ts|js|tsx|jsx|py|md|json|yaml|yml|sh)/gi);
  if (fileMatches) {
    for (const file of new Set(fileMatches)) {
      entities.push({ name: file, type: 'file' });
    }
  }

  // Extract common technology terms
  const techTerms = [
    'TypeScript', 'JavaScript', 'Python', 'Node.js', 'React', 'Next.js',
    'PostgreSQL', 'Redis', 'Docker', 'Kubernetes', 'GCP', 'AWS', 'Vertex AI',
    'Claude', 'GPT', 'Gemini', 'MCP', 'API', 'REST', 'GraphQL',
  ];

  for (const term of techTerms) {
    if (content.toLowerCase().includes(term.toLowerCase())) {
      entities.push({ name: term, type: 'technology' });
    }
  }

  // Limit to 10 entities
  return entities.slice(0, 10);
}

async function linkEntity(
  db: PostgresDriver,
  memoryId: string,
  entity: { name: string; type: string }
): Promise<void> {
  // Upsert entity
  const entityResult = await db.queryOne<{ id: string }>(
    `INSERT INTO entities (name, type)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type
     RETURNING id`,
    [entity.name, entity.type]
  );

  if (entityResult) {
    // Link to memory
    await db.execute(
      `INSERT INTO memory_entities (memory_id, entity_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [memoryId, entityResult.id]
    );
  }
}
