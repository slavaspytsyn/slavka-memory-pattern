#!/bin/bash
# Security hook for PreToolUse (Bash)
# Blocks commands that contain hardcoded secrets
# Allows legitimate secret management commands (gcloud secrets, etc.)

INPUT=$(cat -)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Allow legitimate secret management commands
if echo "$CMD" | grep -qiE 'gcloud\s+(secrets|iam)'; then
  exit 0
fi

# Block commands with hardcoded secrets
if echo "$CMD" | grep -qiE '(sshpass|password|token|api_key|secret|Bearer).*=.*[A-Za-z0-9]{10}'; then
  echo 'BLOCKED: Command contains hardcoded secret. Use environment variables or secret manager instead.' >&2
  exit 2
fi
