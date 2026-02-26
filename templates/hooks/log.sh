#!/bin/bash
# Claude Memory Raw Logger
# Called by PostToolUse hook — logs meaningful actions to daily raw file
# Data comes via STDIN as JSON from Claude Code

DATE=$(date +%Y-%m-%d)
TIME=$(date +%H:%M:%S)
LOG_DIR="$HOME/.claude-memory/raw"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$DATE.md"

# Read JSON from stdin
INPUT=$(cat -)

# Extract fields from JSON
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
SESSION=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | head -c 8)

# Only log meaningful actions, skip reads/searches
case "$TOOL" in
  Edit|Write)
    DETAIL=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
    ;;
  Bash)
    DETAIL=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null | head -c 200)
    ;;
  mcp__memory__memory_store)
    DETAIL=$(echo "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null | head -c 200)
    ;;
  *)
    # Don't log Read, Glob, Grep, etc. — too noisy
    exit 0
    ;;
esac

# Write log entry
echo "- $TIME [$SESSION] **$TOOL** | $DETAIL" >> "$LOG_FILE"

# Auto-cleanup: delete raw logs older than 14 days
find "$LOG_DIR" -name "*.md" -mtime +14 -delete 2>/dev/null

exit 0
