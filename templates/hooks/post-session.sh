#!/bin/bash
# Post-session hook: save session summary to Memory System
# Called by Claude Code SessionEnd hook
# Reads today's raw log and creates a summary entry

# === CONFIGURE ===
MEMORY_URL="http://{YOUR_MCP_SERVER_URL}/mcp"
# === END CONFIGURE ===

# Only run if there's a meaningful raw log for today
DATE=$(date +%Y-%m-%d)
RAW_LOG="$HOME/.claude-memory/raw/$DATE.md"

if [ ! -f "$RAW_LOG" ]; then
  exit 0
fi

# Count lines in today's log
LINE_COUNT=$(wc -l < "$RAW_LOG" 2>/dev/null)

# Only summarize if there's been significant activity (20+ lines)
if [ "$LINE_COUNT" -lt 20 ]; then
  exit 0
fi

# Debounce: don't save more than once per 30 minutes
MARKER_FILE="/tmp/claude-memory-summary-marker"
if [ -f "$MARKER_FILE" ]; then
  MARKER_AGE=$(( $(date +%s) - $(stat -f%m "$MARKER_FILE" 2>/dev/null || stat -c%Y "$MARKER_FILE" 2>/dev/null || echo 0) ))
  if [ "$MARKER_AGE" -lt 1800 ]; then
    exit 0
  fi
fi

# Get last 30 lines of raw log as context
TAIL=$(tail -30 "$RAW_LOG")

# Initialize MCP session
INIT_RESP=$(curl -s -D /tmp/mcp_post_headers --connect-timeout 5 --max-time 10 "$MEMORY_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"post-session","version":"1.0"}}}' 2>/dev/null)

SID=$(grep -i 'mcp-session-id' /tmp/mcp_post_headers 2>/dev/null | awk '{print $2}' | tr -d '\r\n')

if [ -z "$SID" ]; then
  exit 0
fi

curl -s --max-time 5 "$MEMORY_URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null 2>&1

sleep 0.5

# Build summary from raw log
FILES_TOUCHED=$(echo "$TAIL" | grep -oP '\*\*(Edit|Write)\*\* \| \K[^\s]+' | sort -u | head -10 | tr '\n' ', ' | sed 's/,$//')
COMMANDS=$(echo "$TAIL" | grep '**Bash**' | grep -v 'ls\|cat\|head\|git status\|git log' | head -5 | sed 's/.*\*\*Bash\*\* | //' | tr '\n' '; ' | head -c 300)

SUMMARY="Session auto-summary $DATE ($(date +%H:%M)). Raw log: $LINE_COUNT lines."
if [ -n "$FILES_TOUCHED" ]; then
  SUMMARY="$SUMMARY Files: $FILES_TOUCHED."
fi
if [ -n "$COMMANDS" ]; then
  SUMMARY="$SUMMARY Commands: $COMMANDS"
fi

# Escape for JSON
SUMMARY_ESCAPED=$(echo "$SUMMARY" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))' 2>/dev/null || echo "\"$SUMMARY\"")

# Store summary
curl -s --max-time 15 "$MEMORY_URL" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"memory_store\",\"arguments\":{\"content\":$SUMMARY_ESCAPED,\"type\":\"task\",\"importance\":5}}}" > /dev/null 2>&1

touch "$MARKER_FILE"

# Close session
curl -s --max-time 5 -X DELETE "$MEMORY_URL" \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: $SID" > /dev/null 2>&1

exit 0
