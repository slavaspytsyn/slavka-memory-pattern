#!/bin/bash
# Pre-session hook: auto-load context from Memory System
# Called by Claude Code SessionStart hook
# Outputs additional context that gets injected into the conversation

# === CONFIGURE THESE ===
MEMORY_URL="http://{YOUR_MCP_SERVER_URL}/mcp"
# Map your project directories to project names
# Used for loading project-specific context at session start
# === END CONFIGURE ===

CWD=$(echo "$1" | jq -r '.cwd // empty' 2>/dev/null)

# Session anchors: clear only on new day, preserve on same-day restarts
# This prevents losing anchors when session continues after context overflow
SESSION_FILE="$HOME/.claude-memory/session.md"
if [ -f "$SESSION_FILE" ]; then
  FILE_DATE=$(date -r "$SESSION_FILE" +%Y-%m-%d 2>/dev/null)
  TODAY=$(date +%Y-%m-%d)
  if [ "$FILE_DATE" = "$TODAY" ]; then
    echo "$(date +%H:%M:%S) | --- session continued ---" >> "$SESSION_FILE"
  else
    echo "# Session Anchors ($TODAY $(date +%H:%M))" > "$SESSION_FILE"
  fi
else
  echo "# Session Anchors ($(date +%Y-%m-%d %H:%M))" > "$SESSION_FILE"
fi

# Detect project from CWD
# Add your own project paths here
PROJECT=""
case "$CWD" in
  */my-project-1*) PROJECT="project-1" ;;
  */my-project-2*) PROJECT="project-2" ;;
esac

# Initialize MCP session
INIT_RESP=$(curl -s -D /tmp/mcp_pre_headers --connect-timeout 5 --max-time 10 "$MEMORY_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"pre-session","version":"1.0"}}}' 2>/dev/null)

SID=$(grep -i 'mcp-session-id' /tmp/mcp_pre_headers 2>/dev/null | awk '{print $2}' | tr -d '\r\n')

if [ -z "$SID" ]; then
  echo "Memory System unavailable. Continue using CLAUDE.md instructions."
  exit 0
fi

# Send initialized notification
curl -s --max-time 5 "$MEMORY_URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null 2>&1

sleep 0.5

# Recall last session summary
LAST_SESSION=$(curl -s --max-time 15 "$MEMORY_URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_recall","arguments":{"query":"session summary","type":"decision","limit":2}}}' 2>/dev/null \
  | sed 's/^event: message$//' | sed 's/^data: //' | jq -r '.result.content[0].text' 2>/dev/null \
  | jq -r '.memories[0].content // empty' 2>/dev/null)

# If we detected a project, recall project-specific SMP card
PROJECT_CONTEXT=""
if [ -n "$PROJECT" ]; then
  PROJECT_CONTEXT=$(curl -s --max-time 15 "$MEMORY_URL" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -H "mcp-session-id: $SID" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"memory_recall\",\"arguments\":{\"query\":\"[SMP] $PROJECT\",\"project\":\"$PROJECT\",\"limit\":1}}}" 2>/dev/null \
    | sed 's/^event: message$//' | sed 's/^data: //' | jq -r '.result.content[0].text' 2>/dev/null \
    | jq -r '.memories[0].content // empty' 2>/dev/null)
fi

# Get git context if in a git repo
GIT_CONTEXT=""
if [ -d "$CWD/.git" ]; then
  GIT_STATUS=$(cd "$CWD" && git status --short 2>/dev/null | head -10)
  GIT_LOG=$(cd "$CWD" && git log --oneline -3 2>/dev/null)
  if [ -n "$GIT_STATUS" ] || [ -n "$GIT_LOG" ]; then
    GIT_CONTEXT="Git status: $GIT_STATUS | Last commits: $GIT_LOG"
  fi
fi

# Build output
OUTPUT=""

if [ -n "$LAST_SESSION" ]; then
  OUTPUT="${OUTPUT}Last session: ${LAST_SESSION}\n\n"
fi

if [ -n "$PROJECT_CONTEXT" ]; then
  OUTPUT="${OUTPUT}Project ($PROJECT): ${PROJECT_CONTEXT}\n\n"
fi

if [ -n "$GIT_CONTEXT" ]; then
  OUTPUT="${OUTPUT}${GIT_CONTEXT}\n\n"
fi

if [ -n "$OUTPUT" ]; then
  echo -e "$OUTPUT"
else
  echo "New session. Follow startup procedure from CLAUDE.md."
fi

# Close MCP session (cleanup)
curl -s --max-time 5 -X DELETE "$MEMORY_URL" \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" > /dev/null 2>&1

exit 0
