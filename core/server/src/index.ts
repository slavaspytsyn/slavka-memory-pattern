#!/usr/bin/env node
/**
 * SMP Server - MCP Server Entry Point (HTTP transport)
 */

import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';

import { initDb, runMigrations } from './database/index.js';
import { initEmbeddings } from './embeddings/index.js';
import { NoopEmbeddingsClient } from './embeddings/noop-client.js';
import { HybridSearchEngine } from './search/index.js';
import { registerTools } from './tools/index.js';
import { updateStatusFile } from './tools/memory-status.js';

const SERVER_NAME = 'smp-server';
const SERVER_VERSION = '0.1.0-alpha';

const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || '3100', 10);

async function main() {
  console.error(`[${SERVER_NAME}] Starting v${SERVER_VERSION} (HTTP mode)...`);

  // Initialize shared resources
  console.error(`[${SERVER_NAME}] Connecting to database...`);
  const db = await initDb();
  await runMigrations(db);
  console.error(`[${SERVER_NAME}] Database connected`);

  console.error(`[${SERVER_NAME}] Initializing embeddings...`);
  let embeddings;
  try {
    embeddings = await initEmbeddings();
    console.error(`[${SERVER_NAME}] Embeddings provider: ${process.env.EMBEDDING_PROVIDER || 'none'}`);
  } catch (error) {
    const provider = process.env.EMBEDDING_PROVIDER || 'none';
    console.error(`[${SERVER_NAME}] Warning: ${provider} embeddings failed:`, error instanceof Error ? error.message : String(error));
    console.error(`[${SERVER_NAME}] Falling back to FTS-only mode`);
    embeddings = new NoopEmbeddingsClient();
    await embeddings.initialize();
  }

  const search = new HybridSearchEngine(db, embeddings);

  // Session management
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  // Create a new MCP Server for each session
  function createMcpServer(): Server {
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } }
    );
    registerTools(server, { db, embeddings, search });
    return server;
  }

  // Express app
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            console.error(`[${SERVER_NAME}] New session: ${sid}`);
            transports[sid] = transport;
          }
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.error(`[${SERVER_NAME}] Session closed: ${sid}`);
            delete transports[sid];
          }
        };

        const server = createMcpServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID' },
          id: null
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[${SERVER_NAME}] Error handling POST:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: SERVER_VERSION,
      sessions: Object.keys(transports).length,
      uptime: process.uptime()
    });
  });

  app.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.error(`[${SERVER_NAME}] HTTP server listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
  });

  updateStatusFile(db).catch(err =>
    console.error(`[${SERVER_NAME}] Status update failed:`, err)
  );
  
  const statusInterval = setInterval(async () => {
    try { await updateStatusFile(db); }
    catch (e) { console.error(`[${SERVER_NAME}] Status update failed:`, e); }
  }, 5 * 60 * 1000);

  const shutdown = async () => {
    console.error(`[${SERVER_NAME}] Shutting down...`);
    clearInterval(statusInterval);
    for (const sid in transports) {
      try { await transports[sid].close(); delete transports[sid]; }
      catch (_) { /* ignore */ }
    }
    await db.close();
    console.error(`[${SERVER_NAME}] Database disconnected`);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, error);
  process.exit(1);
});
