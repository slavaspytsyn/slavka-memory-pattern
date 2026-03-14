// Hybrid search engine combining PostgreSQL FTS and pgvector

import type { PostgresDriver } from '../database/pg-driver.js';
import type { EmbeddingsClient } from '../embeddings/types.js';
import type { SearchOptions, SearchResult, Memory } from '../types.js';

export class HybridSearchEngine {
  constructor(
    private db: PostgresDriver,
    private embeddings: EmbeddingsClient
  ) {}

  /**
   * Search memories using hybrid approach (FTS + Vector + RRF)
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const {
      limit = 10,
      offset = 0,
      type,
      project,
      minImportance = 1,
      includeExpired = false,
      searchMode = 'hybrid',
      collection,
    } = options;

    // Generate query embedding for semantic search
    let embeddingStr: string | null = null;
    let effectiveSearchMode = searchMode;

    if (searchMode === 'hybrid' || searchMode === 'vector') {
      try {
        const queryEmbedding = await this.embeddings.getEmbedding(query, 'RETRIEVAL_QUERY');
        if (queryEmbedding && queryEmbedding.length > 0) {
          embeddingStr = this.embeddings.formatForPgvector(queryEmbedding);
        } else {
          // No embeddings produced (e.g. NoopClient)
          effectiveSearchMode = 'fts';
        }
      } catch (error) {
        console.error('[smp-server] Failed to generate query embedding, falling back to FTS');
        if (searchMode === 'vector') {
          throw error;
        }
        // Fall back to FTS-only if hybrid
        effectiveSearchMode = 'fts';
      }
    }

    // Use different queries based on whether we have embeddings
    let results: SearchResultRow[];
    if (effectiveSearchMode === 'fts' || embeddingStr === null) {
      const sql = this.buildFtsOnlyQuery(!!collection);
      const params = [query, minImportance, type || null, project || null, includeExpired, limit, offset, ...(collection ? [collection] : [])];
      results = await this.db.queryAll<SearchResultRow>(sql, params);
    } else {
      const sql = this.buildHybridQuery(!!collection);
      const params = [query, embeddingStr, minImportance, type || null, project || null, includeExpired, limit, offset, ...(collection ? [collection] : [])];
      results = await this.db.queryAll<SearchResultRow>(sql, params);
    }

    // Enrich with entities
    const enrichedResults = await this.enrichWithEntities(results);

    // Record access for top results
    if (enrichedResults.length > 0) {
      await this.recordAccess(enrichedResults.slice(0, 5).map((r) => r.id));
    }

    return enrichedResults;
  }

  /**
   * FTS-only query
   */
  private buildFtsOnlyQuery(withCollection: boolean): string {
    const collectionJoin = withCollection
      ? `JOIN import_chunk_map icm ON icm.memory_id = memories.id
         JOIN import_batches ib ON ib.id = icm.batch_id AND ib.title = $8`
      : '';

    return `
      WITH fts_results AS (
        SELECT
          memories.id,
          ts_rank_cd(fts_vector, websearch_to_tsquery('simple', $1)) as fts_rank,
          ROW_NUMBER() OVER (ORDER BY ts_rank_cd(fts_vector, websearch_to_tsquery('simple', $1)) DESC) as fts_position
        FROM memories
        ${collectionJoin}
        WHERE
          fts_vector @@ websearch_to_tsquery('simple', $1)
          AND NOT memories.is_deleted
          AND memories.importance >= $2
          AND ($3::varchar IS NULL OR memories.type = $3)
          AND ($4::varchar IS NULL OR memories.project = $4)
          AND ($5::boolean = TRUE OR memories.expires_at IS NULL OR memories.expires_at > NOW())
        LIMIT 100
      )
      SELECT
        m.id,
        m.content,
        m.summary,
        m.type,
        m.project,
        m.importance,
        m.created_at,
        m.last_accessed,
        m.expires_at,
        m.access_count,
        m.is_deleted,
        m.metadata,
        f.fts_rank,
        2.0::real as vector_distance,
        1.0 / (60 + f.fts_position) as rrf_score,
        hybrid_rank(
          f.fts_rank::real,
          2.0::real,
          m.importance,
          EXTRACT(EPOCH FROM (NOW() - m.last_accessed)) / 3600,
          m.access_count
        ) as hybrid_score
      FROM fts_results f
      JOIN memories m ON f.id = m.id
      ORDER BY hybrid_score DESC
      LIMIT $6
      OFFSET $7
    `;
  }

  /**
   * Hybrid query (FTS + Vector)
   */
  private buildHybridQuery(withCollection: boolean): string {
    const collectionJoin = withCollection
      ? `JOIN import_chunk_map icm ON icm.memory_id = memories.id
         JOIN import_batches ib ON ib.id = icm.batch_id AND ib.title = $9`
      : '';

    return `
      WITH fts_results AS (
        SELECT
          memories.id,
          ts_rank_cd(fts_vector, websearch_to_tsquery('simple', $1)) as fts_rank,
          ROW_NUMBER() OVER (ORDER BY ts_rank_cd(fts_vector, websearch_to_tsquery('simple', $1)) DESC) as fts_position
        FROM memories
        ${collectionJoin}
        WHERE
          fts_vector @@ websearch_to_tsquery('simple', $1)
          AND NOT memories.is_deleted
          AND memories.importance >= $3
          AND ($4::varchar IS NULL OR memories.type = $4)
          AND ($5::varchar IS NULL OR memories.project = $5)
          AND ($6::boolean = TRUE OR memories.expires_at IS NULL OR memories.expires_at > NOW())
        LIMIT 100
      ),
      vector_results AS (
        SELECT
          memories.id,
          memories.embedding <=> $2::vector as vector_distance,
          ROW_NUMBER() OVER (ORDER BY memories.embedding <=> $2::vector) as vector_position
        FROM memories
        ${collectionJoin}
        WHERE
          memories.embedding IS NOT NULL
          AND NOT memories.is_deleted
          AND memories.importance >= $3
          AND ($4::varchar IS NULL OR memories.type = $4)
          AND ($5::varchar IS NULL OR memories.project = $5)
          AND ($6::boolean = TRUE OR memories.expires_at IS NULL OR memories.expires_at > NOW())
        LIMIT 100
      ),
      combined AS (
        SELECT
          COALESCE(f.id, v.id) as id,
          COALESCE(f.fts_rank, 0) as fts_rank,
          COALESCE(v.vector_distance, 2) as vector_distance,
          COALESCE(1.0 / (60 + f.fts_position), 0) +
          COALESCE(1.0 / (60 + v.vector_position), 0) as rrf_score
        FROM fts_results f
        FULL OUTER JOIN vector_results v ON f.id = v.id
      )
      SELECT
        m.id,
        m.content,
        m.summary,
        m.type,
        m.project,
        m.importance,
        m.created_at,
        m.last_accessed,
        m.expires_at,
        m.access_count,
        m.is_deleted,
        m.metadata,
        c.fts_rank,
        c.vector_distance,
        c.rrf_score,
        hybrid_rank(
          c.fts_rank::real,
          c.vector_distance::real,
          m.importance,
          EXTRACT(EPOCH FROM (NOW() - m.last_accessed)) / 3600,
          m.access_count
        ) as hybrid_score
      FROM combined c
      JOIN memories m ON c.id = m.id
      ORDER BY hybrid_score DESC
      LIMIT $7
      OFFSET $8
    `;
  }

  private async enrichWithEntities(results: SearchResultRow[]): Promise<SearchResult[]> {
    if (results.length === 0) return [];

    const memoryIds = results.map((r) => r.id);
    const placeholders = memoryIds.map((_, i) => `$${i + 1}`).join(',');

    const entities = await this.db.queryAll<{ memory_id: string; name: string }>(
      `SELECT me.memory_id, e.name
       FROM memory_entities me
       JOIN entities e ON me.entity_id = e.id
       WHERE me.memory_id IN (${placeholders})`,
      memoryIds
    );

    const entityMap = new Map<string, string[]>();
    for (const e of entities) {
      if (!entityMap.has(e.memory_id)) {
        entityMap.set(e.memory_id, []);
      }
      entityMap.get(e.memory_id)!.push(e.name);
    }

    return results.map((row) => ({
      id: row.id,
      content: row.content,
      summary: row.summary,
      type: row.type as any,
      project: row.project,
      importance: row.importance,
      embedding: null,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      expiresAt: row.expires_at,
      accessCount: row.access_count,
      isDeleted: row.is_deleted,
      metadata: row.metadata,
      ftsRank: row.fts_rank,
      vectorDistance: row.vector_distance,
      hybridScore: row.hybrid_score,
      entities: entityMap.get(row.id) || [],
    }));
  }

  private async recordAccess(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;

    const placeholders = memoryIds.map((_, i) => `($${i + 1}, 'access', 'hybrid-search')`).join(',');

    await this.db.execute(
      `INSERT INTO provenance (memory_id, operation, source) VALUES ${placeholders}`,
      memoryIds
    );

    const updatePlaceholders = memoryIds.map((_, i) => `$${i + 1}`).join(',');
    await this.db.execute(
      `UPDATE memories SET access_count = access_count + 1, last_accessed = NOW()
       WHERE id IN (${updatePlaceholders})`,
      memoryIds
    );
  }
}

interface SearchResultRow {
  id: string;
  content: string;
  summary: string | null;
  type: string;
  project: string;
  importance: number;
  created_at: Date;
  last_accessed: Date;
  expires_at: Date | null;
  access_count: number;
  is_deleted: boolean;
  metadata: Record<string, unknown>;
  fts_rank: number;
  vector_distance: number;
  rrf_score: number;
  hybrid_score: number;
}
