// PostgreSQL driver with connection pooling for smp-server

import pg from 'pg';
import { getDatabaseUrl } from './secrets.js';
import type { MemoryStats } from '../types.js';

const { Pool } = pg;

export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number | null;
}

export class PostgresDriver {
  private pool: pg.Pool | null = null;
  private initialized = false;
  private connectionString: string | null = null;

  constructor(connectionString?: string) {
    this.connectionString = connectionString || null;
  }

  async initialize(): Promise<void> {
    if (this.initialized && this.pool) {
      return;
    }

    const connStr = this.connectionString || await getDatabaseUrl();

    this.pool = new Pool({
      connectionString: connStr,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }

    this.initialized = true;
    console.error('[smp-server] Database connected');
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    const result = await this.pool.query(sql, params);
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount,
    };
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] || null;
  }

  async queryAll<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query<T>(sql, params);
    return result.rows;
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.query(sql, params);
    return result.rowCount || 0;
  }

  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getStats(): Promise<MemoryStats> {
    const result = await this.queryOne<{
      memory_count: string;
      last_sync: Date | null;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE NOT is_deleted) as memory_count,
        MAX(created_at) as last_sync
      FROM memories
    `);

    return {
      memoryCount: parseInt(result?.memory_count || '0', 10),
      lastSync: result?.last_sync || null,
      searchMode: 'hybrid',
      dbStatus: 'connected',
    };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
      console.error('[smp-server] Database disconnected');
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let dbInstance: PostgresDriver | null = null;

export function getDb(): PostgresDriver {
  if (!dbInstance) {
    dbInstance = new PostgresDriver();
  }
  return dbInstance;
}

export async function initDb(connectionString?: string): Promise<PostgresDriver> {
  const db = connectionString ? new PostgresDriver(connectionString) : getDb();
  await db.initialize();
  return db;
}
