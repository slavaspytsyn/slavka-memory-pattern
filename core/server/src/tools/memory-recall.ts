// memory_recall MCP tool

import { z } from 'zod';
import type { HybridSearchEngine } from '../search/hybrid-search.js';
import type { SearchResult } from '../types.js';

export const memoryRecallSchema = z.object({
  query: z.string().min(1).describe('Search query for memories'),
  limit: z.number().min(1).max(50)
    .optional()
    .default(10)
    .describe('Maximum number of results'),
  type: z.enum(['general', 'code', 'decision', 'context', 'error', 'task'])
    .optional()
    .describe('Filter by memory type'),
  project: z.string()
    .optional()
    .describe('Filter by project (e.g., "discord-agent-hub", "website"). If not set, searches all projects.'),
  minImportance: z.number().min(1).max(10)
    .optional()
    .default(1)
    .describe('Minimum importance level'),
  searchMode: z.enum(['hybrid', 'fts', 'vector'])
    .optional()
    .default('hybrid')
    .describe('Search mode: hybrid (default), fts (keyword), or vector (semantic)'),
  collection: z.string()
    .optional()
    .describe('Filter by import collection title (search only within a specific imported document)'),
});

export type MemoryRecallInput = z.infer<typeof memoryRecallSchema>;

export interface MemoryRecallResult {
  memories: FormattedMemory[];
  totalFound: number;
  searchMode: string;
}

export interface FormattedMemory {
  id: string;
  content: string;
  summary: string | null;
  type: string;
  project: string;
  importance: number;
  score: number;
  entities: string[];
  createdAt: string;
  lastAccessed: string;
}

export async function memoryRecall(
  input: MemoryRecallInput,
  search: HybridSearchEngine
): Promise<MemoryRecallResult> {
  const { query, limit, type, project, minImportance, searchMode, collection } = input;

  const results = await search.search(query, {
    limit,
    type,
    project,
    minImportance,
    searchMode,
    collection,
  });

  const formatted = results.map(formatMemory);

  return {
    memories: formatted,
    totalFound: formatted.length,
    searchMode: searchMode || 'hybrid',
  };
}

function formatMemory(result: SearchResult): FormattedMemory {
  return {
    id: result.id,
    content: truncateContent(result.content, 500),
    summary: result.summary,
    type: result.type,
    project: result.project,
    importance: result.importance,
    score: Math.round(result.hybridScore * 100) / 100,
    entities: result.entities,
    createdAt: formatDate(result.createdAt),
    lastAccessed: formatDate(result.lastAccessed),
  };
}

function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength).trim() + '...';
}

function formatDate(date: Date): string {
  return date.toISOString();
}
