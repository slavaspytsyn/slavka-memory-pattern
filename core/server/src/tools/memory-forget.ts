// memory_forget MCP tool

import { z } from 'zod';
import type { PostgresDriver } from '../database/pg-driver.js';
import type { ForgetResult } from '../types.js';

export const memoryForgetSchema = z.object({
  id: z.string().uuid()
    .optional()
    .describe('Specific memory ID to forget'),
  query: z.string()
    .optional()
    .describe('Search query to find memories to forget'),
  olderThan: z.string()
    .optional()
    .describe('Delete memories older than duration (e.g., "30d", "1w")'),
  type: z.enum(['general', 'code', 'decision', 'context', 'error', 'task'])
    .optional()
    .describe('Delete only memories of this type'),
  batchId: z.string().uuid()
    .optional()
    .describe('Delete all memories from an import batch'),
  confirm: z.boolean()
    .optional()
    .default(false)
    .describe('Confirm deletion (required for bulk operations)'),
});

export type MemoryForgetInput = z.infer<typeof memoryForgetSchema>;

export async function memoryForget(
  input: MemoryForgetInput,
  db: PostgresDriver
): Promise<ForgetResult> {
  const { id, query, olderThan, type, batchId, confirm } = input;

  // Single memory deletion by ID
  if (id) {
    return forgetById(db, id);
  }

  // Batch deletion by import batchId
  if (batchId) {
    return forgetByBatch(db, batchId);
  }

  // Bulk deletion requires confirmation
  if (!confirm && (query || olderThan || type)) {
    // Return preview of what would be deleted
    const preview = await previewDeletion(db, query, olderThan, type);
    throw new Error(
      `This will delete ${preview.count} memories. Set confirm=true to proceed. ` +
      `IDs: ${preview.ids.slice(0, 5).join(', ')}${preview.ids.length > 5 ? '...' : ''}`
    );
  }

  // Bulk deletion with confirmation
  return forgetBulk(db, query, olderThan, type);
}

async function forgetById(db: PostgresDriver, id: string): Promise<ForgetResult> {
  // Soft delete
  const result = await db.execute(
    `UPDATE memories
     SET is_deleted = TRUE, deleted_at = NOW()
     WHERE id = $1 AND NOT is_deleted`,
    [id]
  );

  if (result > 0) {
    // Record provenance
    await db.execute(
      `INSERT INTO provenance (memory_id, operation, source)
       VALUES ($1, 'delete', 'claude-code')`,
      [id]
    );
  }

  return {
    deletedCount: result,
    deletedIds: result > 0 ? [id] : [],
  };
}

async function forgetByBatch(db: PostgresDriver, batchId: string): Promise<ForgetResult> {
  // Get all memory IDs for this batch
  const memories = await db.queryAll<{ memory_id: string }>(
    `SELECT icm.memory_id FROM import_chunk_map icm
     JOIN memories m ON m.id = icm.memory_id
     WHERE icm.batch_id = $1 AND NOT m.is_deleted`,
    [batchId]
  );

  if (memories.length === 0) {
    return { deletedCount: 0, deletedIds: [] };
  }

  const ids = memories.map((m) => m.memory_id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

  // Soft delete all memories in batch
  const deletedCount = await db.execute(
    `UPDATE memories SET is_deleted = TRUE, deleted_at = NOW()
     WHERE id IN (${placeholders}) AND NOT is_deleted`,
    ids
  );

  // Record provenance
  for (const memId of ids) {
    await db.execute(
      `INSERT INTO provenance (memory_id, operation, source, context)
       VALUES ($1, 'delete', 'claude-code', $2)`,
      [memId, `batch deletion: ${batchId}`]
    );
  }

  // Update batch status
  await db.execute(
    `UPDATE import_batches SET status = 'deleted' WHERE id = $1`,
    [batchId]
  );

  return {
    deletedCount,
    deletedIds: ids,
  };
}

async function previewDeletion(
  db: PostgresDriver,
  query: string | undefined,
  olderThan: string | undefined,
  type: string | undefined
): Promise<{ count: number; ids: string[] }> {
  const { sql, params } = buildDeleteQuery(query, olderThan, type, true);

  const results = await db.queryAll<{ id: string }>(sql, params);

  return {
    count: results.length,
    ids: results.map((r) => r.id),
  };
}

async function forgetBulk(
  db: PostgresDriver,
  query: string | undefined,
  olderThan: string | undefined,
  type: string | undefined
): Promise<ForgetResult> {
  const { sql, params } = buildDeleteQuery(query, olderThan, type, false);

  // Get IDs before deletion
  const { sql: selectSql, params: selectParams } = buildDeleteQuery(query, olderThan, type, true);
  const toDelete = await db.queryAll<{ id: string }>(selectSql, selectParams);
  const ids = toDelete.map((r) => r.id);

  // Perform soft delete
  const result = await db.execute(sql, params);

  // Record provenance for all deleted memories
  for (const id of ids) {
    await db.execute(
      `INSERT INTO provenance (memory_id, operation, source, context)
       VALUES ($1, 'delete', 'claude-code', 'bulk deletion')`,
      [id]
    );
  }

  return {
    deletedCount: result,
    deletedIds: ids,
  };
}

function buildDeleteQuery(
  query: string | undefined,
  olderThan: string | undefined,
  type: string | undefined,
  selectOnly: boolean
): { sql: string; params: unknown[] } {
  const conditions: string[] = ['NOT is_deleted'];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (query) {
    conditions.push(`fts_vector @@ plainto_tsquery('english', $${paramIndex})`);
    params.push(query);
    paramIndex++;
  }

  if (olderThan) {
    const interval = parseInterval(olderThan);
    if (interval) {
      conditions.push(`created_at < NOW() - INTERVAL '${interval}'`);
    }
  }

  if (type) {
    conditions.push(`type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  if (selectOnly) {
    return {
      sql: `SELECT id FROM memories WHERE ${whereClause} LIMIT 100`,
      params,
    };
  }

  return {
    sql: `UPDATE memories SET is_deleted = TRUE, deleted_at = NOW() WHERE ${whereClause}`,
    params,
  };
}

function parseInterval(duration: string): string | null {
  const match = duration.match(/^(\d+)([hdwm])$/);
  if (!match) return null;

  const [, value, unit] = match;
  const units: Record<string, string> = {
    h: 'hours',
    d: 'days',
    w: 'weeks',
    m: 'months',
  };

  return `${value} ${units[unit]}`;
}
