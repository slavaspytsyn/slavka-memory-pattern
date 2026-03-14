// memory_status MCP tool for HUD integration

import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { PostgresDriver } from '../database/pg-driver.js';
import type { MemoryStats } from '../types.js';

export const memoryStatusSchema = z.object({
  writeToFile: z.boolean()
    .optional()
    .default(false)
    .describe('Write status to file for HUD consumption'),
});

export type MemoryStatusInput = z.infer<typeof memoryStatusSchema>;

export interface MemoryStatusResult extends MemoryStats {
  topEntities: string[];
  recentMemories: number;
  expiringMemories: number;
}

const STATUS_FILE = process.env.STATUS_FILE_PATH;

export async function memoryStatus(
  input: MemoryStatusInput,
  db: PostgresDriver
): Promise<MemoryStatusResult> {
  const { writeToFile } = input;

  // Get basic stats
  const stats = await db.getStats();

  // Get additional stats
  const [topEntities, recentCount, expiringCount] = await Promise.all([
    getTopEntities(db, 5),
    getRecentMemoriesCount(db, 24), // Last 24 hours
    getExpiringMemoriesCount(db, 7), // Expiring in 7 days
  ]);

  const result: MemoryStatusResult = {
    ...stats,
    topEntities,
    recentMemories: recentCount,
    expiringMemories: expiringCount,
  };

  // Write to file for HUD consumption if configured
  if (writeToFile && STATUS_FILE) {
    try {
      const statusDir = dirname(STATUS_FILE);
      mkdirSync(statusDir, { recursive: true });
      writeFileSync(STATUS_FILE, JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('[smp-server] Failed to write status file:', error);
    }
  }

  return result;
}

async function getTopEntities(db: PostgresDriver, limit: number): Promise<string[]> {
  const results = await db.queryAll<{ name: string }>(
    `SELECT e.name
     FROM entities e
     JOIN memory_entities me ON e.id = me.entity_id
     JOIN memories m ON me.memory_id = m.id
     WHERE NOT m.is_deleted
     GROUP BY e.id, e.name
     ORDER BY COUNT(*) DESC
     LIMIT $1`,
    [limit]
  );

  return results.map((r) => r.name);
}

async function getRecentMemoriesCount(db: PostgresDriver, hours: number): Promise<number> {
  const result = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM memories
     WHERE NOT is_deleted
       AND created_at > NOW() - INTERVAL '${hours} hours'`
  );

  return parseInt(result?.count || '0', 10);
}

async function getExpiringMemoriesCount(db: PostgresDriver, days: number): Promise<number> {
  const result = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM memories
     WHERE NOT is_deleted
       AND expires_at IS NOT NULL
       AND expires_at < NOW() + INTERVAL '${days} days'`
  );

  return parseInt(result?.count || '0', 10);
}

/**
 * Update status file periodically (for background updates)
 */
export async function updateStatusFile(db: PostgresDriver): Promise<void> {
  if (STATUS_FILE) {
    await memoryStatus({ writeToFile: true }, db);
  }
}
