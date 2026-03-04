import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WRITE_TOOLS, handleWriteTool } from "./write-tools.js";
import { READ_TOOLS, handleReadTool } from "./read-tools.js";

const server = new Server(
  { name: "rigorous-dev-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = request.params.arguments || {};

  try {
    switch (name) {
      case "iteration_create":
      case "phase_transition":
      case "revision_create":
      case "revision_update":
      case "changelog_insert":
      case "commit_link":
      case "workflow_update":
        return okResponse(handleWriteTool(name, args));

      case "changelog_query":
      case "traceability_query":
      case "revision_history":
      case "iteration_summary":
      case "workflow_status":
        return okResponse(handleReadTool(name, args));

      default:
        return errResponse(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errResponse(err);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("rigorous-dev-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
