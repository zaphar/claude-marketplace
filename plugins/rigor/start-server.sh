#!/usr/bin/env bash
# Start the rigor MCP server in HTTP transport mode.
# Usage: ./start-server.sh
# Port defaults to 3100; override with RIGOR_MCP_PORT env var.
set -euo pipefail
cd "$(dirname "$0")/mcp-server"
npm install --silent --prefer-offline 2>/dev/null
exec node main.js --http
