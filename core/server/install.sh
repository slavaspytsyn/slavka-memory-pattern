#!/bin/bash
# SMP (Smart Memory Pattern) Quick Install
# Sets up the memory server and provides instructions for connection.

set -e

echo "🚀 Starting SMP Memory Server..."

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed. Please install Docker and Docker Compose."
    exit 1
fi

# Build and start services
docker compose up -d --build

echo "⏳ Waiting for server to be ready (health check)..."
MAX_ATTEMPTS=30
for i in $(seq 1 $MAX_ATTEMPTS); do
  if curl -s http://localhost:3100/health > /dev/null 2>&1; then
    echo "✅ Server is ready!"
    SUCCESS=1
    break
  fi
  if [ $i -eq $MAX_ATTEMPTS ]; then
    echo "❌ Timeout: Server did not become ready after $MAX_ATTEMPTS seconds."
    echo "Check logs with: docker compose logs server"
    exit 1
  fi
  sleep 1
done

echo ""
echo "🎉 SMP Memory Server (v0.1.0-alpha) is successfully installed!"
echo "------------------------------------------------------------"
echo "To connect your AI agents:"
echo ""
echo "1. Claude Code:"
echo "   claude mcp add --transport http --scope user memory http://localhost:3100/mcp"
echo ""
echo "2. Gemini CLI (add to ~/.gemini/settings.json):"
echo '   "mcpServers": { "memory": { "httpUrl": "http://localhost:3100/mcp" } }'
echo ""
echo "3. MCP Tools available:"
echo "   - memory_store, memory_recall, memory_forget, memory_status, memory_import"
echo "------------------------------------------------------------"
echo "Default DB: smp_db | Default Port: 3100"
echo "Mode: FTS-only (To enable Vector, set OPENAI_API_KEY in .env)"
