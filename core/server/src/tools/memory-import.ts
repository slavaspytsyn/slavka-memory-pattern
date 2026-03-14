// memory_import MCP tool — bulk import with chunking

import { z } from 'zod';
import type { PostgresDriver } from '../database/pg-driver.js';
import type { EmbeddingsClient } from '../embeddings/types.js';
import { chunkText, type ChunkStrategy } from '../chunking/index.js';

export const memoryImportSchema = z.object({
  content: z.string().min(1).describe('The text content to import (up to ~2MB)'),
  title: z.string().min(1).max(255).describe('Title for this import (used for collection filtering)'),
  strategy: z.enum(['paragraph', 'fixed', 'markdown'])
    .optional()
    .default('paragraph')
    .describe('Chunking strategy: paragraph (default), fixed, markdown'),
  chunkSize: z.number().min(100).max(10000)
    .optional()
    .default(1500)
    .describe('Target chunk size in characters (~300 tokens at 1500)'),
  chunkOverlap: z.number().min(0).max(2000)
    .optional()
    .default(200)
    .describe('Overlap between chunks in characters (for fixed strategy)'),
  project: z.string()
    .optional()
    .default('default')
    .describe('Project name'),
  type: z.enum(['general', 'code', 'decision', 'context', 'error', 'task'])
    .optional()
    .default('context')
    .describe('Memory type for all chunks'),
  importance: z.number().min(1).max(10)
    .optional()
    .default(5)
    .describe('Importance level for all chunks'),
  metadata: z.record(z.unknown())
    .optional()
    .describe('Additional metadata for all chunks'),
});

export type MemoryImportInput = z.infer<typeof memoryImportSchema>;

export interface MemoryImportResult {
  batchId: string;
  title: string;
  project: string;
  strategy: string;
  totalChunks: number;
  status: 'completed' | 'resumed' | 'error';
  message: string;
}

const MICRO_BATCH_SIZE = 5;
const MICRO_BATCH_DELAY_MS = 200;

export async function memoryImport(
  input: MemoryImportInput,
  db: PostgresDriver,
  embeddings: EmbeddingsClient
): Promise<MemoryImportResult> {
  const {
    content,
    title,
    strategy,
    chunkSize,
    chunkOverlap,
    project,
    type,
    importance,
    metadata,
  } = input;

  // Check for incomplete import with same title+project (resume)
  const existingBatch = await db.queryOne<{
    id: string;
    chunks_completed: number;
    total_chunks: number;
    status: string;
  }>(
    `SELECT id, chunks_completed, total_chunks, status
     FROM import_batches
     WHERE title = $1 AND project = $2 AND status = 'processing'
     ORDER BY created_at DESC LIMIT 1`,
    [title, project]
  );

  let batchId: string;
  let startFromChunk = 0;

  if (existingBatch) {
    batchId = existingBatch.id;
    startFromChunk = existingBatch.chunks_completed;
    console.error(`[smp-server] Resuming import "${title}" from chunk ${startFromChunk}`);
  } else {
    // Create new batch record
    const batchResult = await db.queryOne<{ id: string }>(
      `INSERT INTO import_batches (title, project, strategy, chunk_size, chunk_overlap, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [title, project, strategy, chunkSize, chunkOverlap, JSON.stringify(metadata || {})]
    );

    if (!batchResult) {
      throw new Error('Failed to create import batch');
    }
    batchId = batchResult.id;
  }

  try {
    // Collect all chunks from generator
    const allChunks = [...chunkText(content, { strategy: strategy as ChunkStrategy, chunkSize, chunkOverlap })];

    // Update total_chunks
    await db.execute(
      'UPDATE import_batches SET total_chunks = $1 WHERE id = $2',
      [allChunks.length, batchId]
    );

    // Process chunks in micro-batches of 5
    let processed = 0;

    for (let i = startFromChunk; i < allChunks.length; i += MICRO_BATCH_SIZE) {
      const batch = allChunks.slice(i, i + MICRO_BATCH_SIZE);

      // Prepare chunk texts with context prefix
      const chunkTexts = batch.map((chunk) => {
        const heading = chunk.heading ? ` ${chunk.heading}` : '';
        return `[Import: ${title}]${heading}\n\n${chunk.text}`;
      });

      // Generate embeddings in parallel
      const embeddingResults = await embeddings.getBatchEmbeddings(chunkTexts, 'RETRIEVAL_DOCUMENT', {
        concurrency: MICRO_BATCH_SIZE,
      });

      // INSERT all chunks + chunk_map in one transaction
      await db.transaction(async (client) => {
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const chunkContent = chunkTexts[j];
          
          let embeddingStr: string | null = null;
          const embedding = embeddingResults[j];
          if (embedding && embedding.length > 0) {
            embeddingStr = embeddings.formatForPgvector(embedding);
          }
          
          const summary = chunkContent.length > 200
            ? chunkContent.slice(0, 200).trim() + '...'
            : null;

          const chunkMeta = {
            ...(metadata || {}),
            importBatchId: batchId,
            importTitle: title,
            chunkIndex: chunk.index,
            ...(chunk.heading ? { heading: chunk.heading } : {}),
          };

          // Insert memory
          const memResult = await client.query(
            `INSERT INTO memories (content, summary, type, project, importance, embedding, metadata)
             VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
             RETURNING id`,
            [chunkContent, summary, type, project, importance, embeddingStr, JSON.stringify(chunkMeta)]
          );

          const memoryId = memResult.rows[0].id;

          // Insert chunk map
          await client.query(
            `INSERT INTO import_chunk_map (batch_id, memory_id, chunk_index)
             VALUES ($1, $2, $3)
             ON CONFLICT (batch_id, chunk_index) DO NOTHING`,
            [batchId, memoryId, chunk.index]
          );

          // Record provenance
          await client.query(
            `INSERT INTO provenance (memory_id, operation, source, context)
             VALUES ($1, 'create', 'memory_import', $2)`,
            [memoryId, `batch:${batchId} chunk:${chunk.index}`]
          );
        }

        // Update chunks_completed
        await client.query(
          'UPDATE import_batches SET chunks_completed = $1 WHERE id = $2',
          [i + batch.length, batchId]
        );
      });

      processed += batch.length;

      // Delay between micro-batches
      if (i + MICRO_BATCH_SIZE < allChunks.length) {
        await new Promise((resolve) => setTimeout(resolve, MICRO_BATCH_DELAY_MS));
      }
    }

    // Mark batch as completed
    await db.execute(
      `UPDATE import_batches SET status = 'completed', completed_at = NOW(), chunks_completed = total_chunks
       WHERE id = $1`,
      [batchId]
    );

    return {
      batchId,
      title,
      project: project || 'default',
      strategy: strategy || 'paragraph',
      totalChunks: allChunks.length,
      status: existingBatch ? 'resumed' : 'completed',
      message: `Imported ${allChunks.length} chunks from "${title}"${existingBatch ? ` (resumed from chunk ${startFromChunk})` : ''}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Mark batch as failed
    await db.execute(
      `UPDATE import_batches SET status = 'error', error_message = $1 WHERE id = $2`,
      [errorMessage, batchId]
    );

    throw new Error(`Import failed: ${errorMessage}. Batch ${batchId} saved — retry with same title to resume.`);
  }
}
