import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WRITE_TOOLS, handleWriteTool } from "./write-tools.js";
import { READ_TOOLS, handleReadTool } from "./read-tools.js";

// ---------------------------------------------------------------------------
// McpServer setup
//
// We use McpServer (the recommended high-level API) but register tool handlers
// via its underlying Server instance. This is the documented escape hatch for
// advanced use cases — our tools define inputSchema as raw JSON Schema objects,
// which McpServer.registerTool() cannot consume (it expects Zod schemas).
// See: "For advanced usage (like sending notifications or setting custom
// request handlers), use the underlying Server instance available via the
// `server` property."
// ---------------------------------------------------------------------------

const mcpServer = new McpServer(
  { name: "rigor-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...WRITE_TOOLS,
    ...READ_TOOLS,
  ],
}));

/**
 * Format a successful result as a text content response.
 * @param {any} data
 * @returns {{ content: Array<{type: string, text: string}> }}
 */
function okResponse(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Format an error as a text content response.
 * @param {unknown} err
 * @returns {{ content: Array<{type: string, text: string}>, isError: true }}
 */
function errResponse(err) {
  return {
    content: [
      {
        type: "text",
        text: err instanceof Error ? err.message : String(err),
      },
    ],
    isError: true,
  };
}

mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = request.params.arguments || {};

  try {
    switch (name) {
      case "iteration_create":
      case "phase_transition":
      case "work_item_transition":
      case "revision_create":
      case "revision_update":
      case "changelog_insert":
      case "changelog_update":
      case "commit_link":
      case "project_update":
      case "blocker_resolve":
      case "iteration_close":
      case "bulk_import":
      case "checkpoint":
        return okResponse(handleWriteTool(name, args));

      case "changelog_query":
      case "traceability_query":
      case "revision_history":
      case "iteration_summary":
      case "project_status":
      case "list_iterations":
        return okResponse(handleReadTool(name, args));

      default:
        return errResponse(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err.code === "PAYLOAD_TOO_LARGE") {
      return {
        content: [{ type: "text", text: JSON.stringify(err.details, null, 2) }],
        isError: true,
      };
    }
    return errResponse(err);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("rigor-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
