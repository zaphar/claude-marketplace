#!/usr/bin/env bash
# PreToolUse hook: block direct SQLite access.
# Works with both Claude Code and Copilot CLI input formats.
#
# Claude Code sends:
#   { "tool_name": "Bash", "tool_input": { "command": "sqlite3 ..." } }
#
# Copilot CLI sends:
#   { "toolName": "bash", "toolArgs": "{\"command\":\"sqlite3 ...\"}" }
#   (toolArgs is a JSON string, not an object; no matcher — fires for all tools)

set -euo pipefail

# Fail-closed: if jq is missing, deny rather than silently allowing everything
if ! command -v jq &>/dev/null; then
  echo '{"permissionDecision":"deny","permissionDecisionReason":"Hook cannot run: jq not found"}'
  exit 0
fi

DENY_REASON="Direct SQLite access is not permitted. Use the rigor MCP server tools (changelog_query, changelog_update, changelog_insert, traceability_query, export_findings, etc.) to interact with the rigor database. Never run sqlite3 or any database client directly."

input=$(cat)

# --- Extract the command string from whichever format we received ---

# Try Claude Code format first: .tool_input.command
command=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

if [ -z "$command" ]; then
  # Try Copilot CLI format: .toolArgs is a JSON *string* containing {"command":"..."}
  # But first, verify this is actually a bash tool call (Copilot has no matcher filter).
  tool_name=$(echo "$input" | jq -r '.toolName // empty' 2>/dev/null || true)
  if [ -n "$tool_name" ]; then
    # Copilot format detected — only inspect bash tool calls
    tool_lower=$(echo "$tool_name" | tr '[:upper:]' '[:lower:]')
    if [ "$tool_lower" != "bash" ]; then
      # Not a bash tool call — allow it
      exit 0
    fi
  fi

  tool_args=$(echo "$input" | jq -r '.toolArgs // empty' 2>/dev/null || true)
  if [ -n "$tool_args" ]; then
    command=$(echo "$tool_args" | jq -r '.command // empty' 2>/dev/null || true)
  fi
fi

# If we still have no command, allow (nothing to check)
if [ -z "$command" ]; then
  exit 0
fi

# --- Check if the command starts with "sqlite" (case-insensitive, trim leading whitespace) ---

trimmed=$(echo "$command" | sed 's/^[[:space:]]*//')
if echo "$trimmed" | grep -iq '^sqlite'; then
  # Deny the tool call
  jq -n --arg reason "$DENY_REASON" '{
    "permissionDecision": "deny",
    "permissionDecisionReason": $reason
  }'
  exit 0
fi

# Allow — exit cleanly with no output
exit 0
