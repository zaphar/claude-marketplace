// ---------------------------------------------------------------------------
// Entry point — CLI flag selects transport
//
// This file is the executable entry point. It imports the pure-library
// server.js (which has no module-level side effects) and wires up either
// stdio or HTTP transport based on CLI flags.
// ---------------------------------------------------------------------------

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, startHttpServer } from "./server.js";

const args = process.argv.slice(2);

if (args.includes("--http")) {
  const port = parseInt(process.env.RIGOR_MCP_PORT || "3100", 10);
  startHttpServer(port);
} else {
  const transport = new StdioServerTransport();
  const server = createServer();
  await server.connect(transport);
  console.error("rigor-mcp server running on stdio");
}
