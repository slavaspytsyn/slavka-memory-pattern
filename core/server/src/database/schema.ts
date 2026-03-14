// Database schema and migrations for smp-server

import type { PostgresDriver } from './pg-driver.js';
import { getEmbeddings } from '../embeddings/index.js';

/**
 * Returns the migrations array. 
 * We use a function to allow dynamic values like embedding dimension.
 */
export function getMigrations(dimension: number): { version: number; name: string; sql: string }[] {
  return [
    {
      version: 1,
      name: 'initial_schema',
      sql: `
        -- Core memories table
        CREATE TABLE IF NOT EXISTS memories (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          content TEXT NOT NULL,
          summary TEXT,
          type VARCHAR(50) DEFAULT 'general',
          project VARCHAR(255) DEFAULT 'default',
          importance INTEGER DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ,
          access_count INTEGER DEFAULT 0,
          is_deleted BOOLEAN DEFAULT FALSE,
          deleted_at TIMESTAMPTZ,
          metadata JSONB DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project) WHERE NOT is_deleted;
        CREATE TABLE IF NOT EXISTS entities (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          name VARCHAR(255) NOT NULL UNIQUE,
          type VARCHAR(50) NOT NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS memory_entities (
          memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          relevance REAL DEFAULT 1.0,
          PRIMARY KEY (memory_id, entity_id)
        );
        CREATE TABLE IF NOT EXISTS provenance (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          operation VARCHAR(20) NOT NULL,
          source VARCHAR(100),
          context TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type) WHERE NOT is_deleted;
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC) WHERE NOT is_deleted;
        CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed DESC) WHERE NOT is_deleted;
        CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at) WHERE expires_at IS NOT NULL AND NOT is_deleted;
        CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
        CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
        CREATE INDEX IF NOT EXISTS idx_provenance_memory ON provenance(memory_id);
        CREATE INDEX IF NOT EXISTS idx_provenance_created ON provenance(created_at DESC);
      `,
    },
    {
      version: 2,
      name: 'add_pgvector',
      sql: `
        -- Add embedding column with dynamic dimension
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(${dimension > 0 ? dimension : 768});
        CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
      `,
    },
    {
      version: 3,
      name: 'add_fts',
      sql: `
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS fts_vector TSVECTOR
          GENERATED ALWAYS AS (
            setweight(to_tsvector('simple', COALESCE(summary, '')), 'A') ||
            setweight(to_tsvector('simple', content), 'B')
          ) STORED;
        CREATE INDEX IF NOT EXISTS idx_memories_fts ON memories USING GIN(fts_vector);
        CREATE INDEX IF NOT EXISTS idx_memories_metadata ON memories USING GIN(metadata);
      `,
    },
    {
      version: 4,
      name: 'add_hybrid_rank_function',
      sql: `
        CREATE OR REPLACE FUNCTION hybrid_rank(
          fts_rank REAL,
          vector_distance REAL,
          importance INTEGER,
          recency_hours REAL,
          access_count INTEGER
        ) RETURNS REAL AS $$
        DECLARE
          recency_score REAL;
          access_score REAL;
          normalized_vector REAL;
        BEGIN
          recency_score := CASE
            WHEN recency_hours < 1 THEN 1.0
            WHEN recency_hours < 6 THEN 0.9
            WHEN recency_hours < 24 THEN 0.7
            WHEN recency_hours < 168 THEN 0.5
            WHEN recency_hours < 720 THEN 0.3
            ELSE 0.1
          END;
          access_score := LEAST(1.0, LN(access_count + 1) / 5);
          normalized_vector := 1.0 - (COALESCE(vector_distance, 2) / 2.0);
          RETURN (
            COALESCE(fts_rank, 0) * 0.25 +
            normalized_vector * 0.35 +
            (importance / 10.0) * 0.20 +
            recency_score * 0.15 +
            access_score * 0.05
          );
        END;
        $$ LANGUAGE plpgsql IMMUTABLE;
      `,
    },
    {
      version: 5,
      name: 'add_import_tables',
      sql: `
        CREATE TABLE IF NOT EXISTS import_batches (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          title VARCHAR(255) NOT NULL,
          project VARCHAR(255) NOT NULL DEFAULT 'default',
          strategy VARCHAR(50) NOT NULL,
          chunk_size INTEGER NOT NULL,
          chunk_overlap INTEGER NOT NULL,
          total_chunks INTEGER NOT NULL DEFAULT 0,
          chunks_completed INTEGER NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'processing',
          error_message TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS import_chunk_map (
          batch_id UUID REFERENCES import_batches(id) ON DELETE CASCADE,
          memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          PRIMARY KEY (batch_id, chunk_index)
        );
        CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);
        CREATE INDEX IF NOT EXISTS idx_import_batches_title_project ON import_batches(title, project);
        CREATE INDEX IF NOT EXISTS idx_import_chunk_map_memory ON import_chunk_map(memory_id);
      `,
    },
    {
      version: 6,
      name: 'ensure_dimension_consistency',
      sql: `
        -- If current dimension is different from stored, we might need to recreate the column.
        -- For MVP, we just ensure the column exists. In production, changing dimensions requires a data migration.
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memories' AND column_name = 'embedding') THEN
                -- Check if we need to resize (this is dangerous on large datasets, so we just log or skip for now)
                -- ALTER TABLE memories ALTER COLUMN embedding TYPE vector(${dimension > 0 ? dimension : 768});
                NULL;
            END IF;
        END $$;
      `
    }
  ];
}

export async function runMigrations(db: PostgresDriver): Promise<void> {
  // Ensure extension exists
  await db.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await db.execute('CREATE EXTENSION IF NOT EXISTS "vector"');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const currentVersion = await db.queryOne<{ version: number }>(
    'SELECT MAX(version) as version FROM schema_version'
  );
  const version = currentVersion?.version || 0;

  const dimension = getEmbeddings().getDimension();
  const migrations = getMigrations(dimension);

  for (const migration of migrations) {
    if (migration.version > version) {
      console.error(`[smp-server] Running migration ${migration.version}: ${migration.name}`);

      await db.transaction(async (client) => {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_version (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
      });

      console.error(`[smp-server] Migration ${migration.version} complete`);
    }
  }
}

export async function getCurrentVersion(db: PostgresDriver): Promise<number> {
  const result = await db.queryOne<{ version: number }>(
    'SELECT MAX(version) as version FROM schema_version'
  );
  return result?.version || 0;
}
