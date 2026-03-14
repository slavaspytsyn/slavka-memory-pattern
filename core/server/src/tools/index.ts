// MCP Tools registration for smp-server

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { PostgresDriver } from '../database/pg-driver.js';
import type { EmbeddingsClient } from '../embeddings/types.js';
import type { HybridSearchEngine } from '../search/hybrid-search.js';

import { memoryStore, memoryStoreSchema } from './memory-store.js';
import { memoryRecall, memoryRecallSchema } from './memory-recall.js';
import { memoryForget, memoryForgetSchema } from './memory-forget.js';
import { memoryStatus, memoryStatusSchema, updateStatusFile } from './memory-status.js';
import { memoryImport, memoryImportSchema } from './memory-import.js';

export interface ToolDependencies {
  db: PostgresDriver;
  embeddings: EmbeddingsClient;
  search: HybridSearchEngine;
}

export function registerTools(server: Server, deps: ToolDependencies): void {
  const { db, embeddings, search } = deps;

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'memory_store',
        description: 'Store a new memory or update existing one. Use this to save important context, decisions, code snippets, or any information worth remembering.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The memory content to store',
            },
            type: {
              type: 'string',
              enum: ['general', 'code', 'decision', 'context', 'error', 'task'],
              default: 'general',
              description: 'Memory type for categorization',
            },
            importance: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              default: 5,
              description: 'Importance level (1=low, 10=critical)',
            },
            expiresIn: {
              type: 'string',
              description: 'When to expire (e.g., "7d", "30d", "never")',
            },
            metadata: {
              type: 'object',
              description: 'Additional metadata',
            },
            project: {
              type: 'string',
              description: 'Project name (e.g., "discord-agent-hub", "website")',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'memory_recall',
        description: 'Search and recall memories using hybrid search (keyword + semantic). Use this to find relevant context from previous sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 50,
              default: 10,
              description: 'Maximum results',
            },
            type: {
              type: 'string',
              enum: ['general', 'code', 'decision', 'context', 'error', 'task'],
              description: 'Filter by type',
            },
            minImportance: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              default: 1,
              description: 'Minimum importance level',
            },
            searchMode: {
              type: 'string',
              enum: ['hybrid', 'fts', 'vector'],
              default: 'hybrid',
              description: 'Search mode',
            },
            project: {
              type: 'string',
              description: 'Filter by project (e.g., "discord-agent-hub", "website")',
            },
            collection: {
              type: 'string',
              description: 'Filter by import collection title (search only within imported document)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_forget',
        description: 'Delete memories by ID, query, age, type, or batchId. Use confirm=true for bulk deletions.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Specific memory ID to delete',
            },
            query: {
              type: 'string',
              description: 'Search query to find memories to delete',
            },
            olderThan: {
              type: 'string',
              description: 'Delete older than duration (e.g., "30d")',
            },
            type: {
              type: 'string',
              enum: ['general', 'code', 'decision', 'context', 'error', 'task'],
              description: 'Delete only this type',
            },
            batchId: {
              type: 'string',
              format: 'uuid',
              description: 'Delete all memories from an import batch',
            },
            confirm: {
              type: 'boolean',
              default: false,
              description: 'Confirm bulk deletion',
            },
          },
        },
      },
      {
        name: 'memory_status',
        description: 'Get memory system status including counts, top entities, and recent activity.',
        inputSchema: {
          type: 'object',
          properties: {
            writeToFile: {
              type: 'boolean',
              default: false,
              description: 'Write status to file for HUD (requires STATUS_FILE_PATH env)',
            },
          },
        },
      },
      {
        name: 'memory_import',
        description: 'Import large text content by automatically chunking it into separate memories with embeddings. Supports paragraph, fixed, and markdown chunking strategies. Use for importing documents, books, guides, or any large text.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The text content to import (up to ~2MB)',
            },
            title: {
              type: 'string',
              description: 'Title for this import (used as collection name for filtering)',
            },
            strategy: {
              type: 'string',
              enum: ['paragraph', 'fixed', 'markdown'],
              default: 'paragraph',
              description: 'Chunking strategy: paragraph (default), fixed, markdown',
            },
            chunkSize: {
              type: 'number',
              default: 1500,
              description: 'Target chunk size in characters (~300 tokens at 1500)',
            },
            chunkOverlap: {
              type: 'number',
              default: 200,
              description: 'Overlap between chunks (for fixed strategy)',
            },
            project: {
              type: 'string',
              description: 'Project name',
            },
            type: {
              type: 'string',
              enum: ['general', 'code', 'decision', 'context', 'error', 'task'],
              default: 'context',
              description: 'Memory type for all chunks',
            },
            importance: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              default: 5,
              description: 'Importance level for all chunks',
            },
            metadata: {
              type: 'object',
              description: 'Additional metadata for all chunks',
            },
          },
          required: ['content', 'title'],
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'memory_store': {
          const input = memoryStoreSchema.parse(args);
          const result = await memoryStore(input, db, embeddings);
          // Update status file after storing
          await updateStatusFile(db);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'memory_recall': {
          const input = memoryRecallSchema.parse(args);
          const result = await memoryRecall(input, search);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'memory_forget': {
          const input = memoryForgetSchema.parse(args);
          const result = await memoryForget(input, db);
          // Update status file after forgetting
          await updateStatusFile(db);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'memory_status': {
          const input = memoryStatusSchema.parse(args);
          const result = await memoryStatus(input, db);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'memory_import': {
          const input = memoryImportSchema.parse(args);
          const result = await memoryImport(input, db, embeddings);
          // Update status file after import
          await updateStatusFile(db);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });
}
