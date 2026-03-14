// Core memory types for smp-server

export interface Memory {
  id: string;
  content: string;
  summary: string | null;
  type: MemoryType;
  importance: number;
  project: string;
  embedding: number[] | null;
  createdAt: Date;
  lastAccessed: Date;
  expiresAt: Date | null;
  accessCount: number;
  isDeleted: boolean;
  metadata: Record<string, unknown>;
}

export type MemoryType = 'general' | 'code' | 'decision' | 'context' | 'error' | 'task';

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type EntityType = 'person' | 'project' | 'technology' | 'file' | 'concept' | 'organization';

export interface Provenance {
  id: string;
  memoryId: string;
  operation: OperationType;
  source: string;
  context: string | null;
  createdAt: Date;
}

export type OperationType = 'create' | 'update' | 'delete' | 'access' | 'restore';

export interface SearchOptions {
  limit?: number;
  offset?: number;
  type?: MemoryType;
  project?: string;
  minImportance?: number;
  includeExpired?: boolean;
  searchMode?: 'hybrid' | 'fts' | 'vector';
  collection?: string;
}

export interface SearchResult extends Memory {
  ftsRank: number;
  vectorDistance: number;
  hybridScore: number;
  entities: string[];
}

export interface MemoryStats {
  memoryCount: number;
  lastSync: Date | null;
  searchMode: 'hybrid' | 'fts' | 'vector';
  dbStatus: 'connected' | 'disconnected' | 'error';
}

export interface StoreInput {
  content: string;
  type?: MemoryType;
  project?: string;
  importance?: number;
  expiresIn?: string;
  metadata?: Record<string, unknown>;
}

export interface StoreResult {
  id: string;
  summary: string;
  entities: string[];
  expiresAt: Date | null;
}

export interface RecallInput {
  query: string;
  limit?: number;
  type?: MemoryType;
  project?: string;
  minImportance?: number;
  searchMode?: 'hybrid' | 'fts' | 'vector';
}

export interface ForgetInput {
  id?: string;
  query?: string;
  olderThan?: string;
  type?: MemoryType;
}

export interface ForgetResult {
  deletedCount: number;
  deletedIds: string[];
}
