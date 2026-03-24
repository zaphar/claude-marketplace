import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { WRITE_TOOLS, handleWriteTool } from "./write-tools.js";
import { READ_TOOLS, handleReadTool } from "./read-tools.js";

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

// ---------------------------------------------------------------------------
// Server factory
//
// createServer() returns a fully-configured McpServer instance. It can be
// called multiple times to create independent servers — HTTP transport needs
// one server per session, while stdio uses a single long-lived instance.
//
// We use McpServer (the recommended high-level API) but register tool handlers
// via its underlying Server instance. This is the documented escape hatch for
// advanced use cases — our tools define inputSchema as raw JSON Schema objects,
// which McpServer.registerTool() cannot consume (it expects Zod schemas).
// See: "For advanced usage (like sending notifications or setting custom
// request handlers), use the underlying Server instance available via the
// `server` property."
// ---------------------------------------------------------------------------

/**
 * Create a fully-configured McpServer with all tool handlers registered.
 * @returns {McpServer}
 */
export function createServer() {
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

  mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = request.params.arguments || {};

    try {
      switch (name) {
        case "iteration_create":
        case "iteration_update":
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
        case "export_findings":
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

  return mcpServer;
}

// ---------------------------------------------------------------------------
// HTTP transport (StreamableHTTP, one McpServer per session)
// ---------------------------------------------------------------------------

/**
 * Collect the full request body from an IncomingMessage.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

/**
 * Send a JSON-RPC error response.
 * @param {import("node:http").ServerResponse} res
 * @param {number} statusCode
 * @param {string} message
 */
function jsonRpcError(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    })
  );
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Start an HTTP server that routes /mcp to StreamableHTTPServerTransport
 * instances, one per session.
 * @param {number} port
 */
export function startHttpServer(port) {
  /** @type {Map<string, StreamableHTTPServerTransport>} */
  const sessions = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const sessionTimers = new Map();

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (url.pathname !== "/mcp") {
      jsonRpcError(res, 404, "Not found");
      return;
    }

    const method = req.method;

    try {
      if (method === "POST") {
        const bodyText = await readBody(req);
        let body;
        try {
          body = JSON.parse(bodyText);
        } catch {
          jsonRpcError(res, 400, "Invalid JSON");
          return;
        }

        const sessionId = req.headers["mcp-session-id"];

        if (sessionId) {
          // Existing session — delegate to its transport
          const transport = sessions.get(sessionId);
          if (!transport) {
            jsonRpcError(res, 404, "Session not found");
            return;
          }
          // Reset idle timer on activity
          clearTimeout(sessionTimers.get(sessionId));
          sessionTimers.set(sessionId, setTimeout(() => {
            const t = sessions.get(sessionId);
            if (t) t.close();
          }, SESSION_TTL_MS));
          await transport.handleRequest(req, res, body);
        } else if (isInitializeRequest(body)) {
          // New session — spin up a fresh server + transport
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });

          transport.onclose = () => {
            const sid = transport.sessionId;
            if (sid) {
              clearTimeout(sessionTimers.get(sid));
              sessionTimers.delete(sid);
              sessions.delete(sid);
              console.error(`[http] session closed: ${sid}`);
            }
          };

          transport.onerror = (err) => {
            console.error(`[http] transport error (${transport.sessionId}):`, err);
          };

          const server = createServer();
          await server.connect(transport);

          // handleRequest sends the initialize response and sets sessionId
          await transport.handleRequest(req, res, body);

          if (transport.sessionId) {
            sessions.set(transport.sessionId, transport);
            sessionTimers.set(transport.sessionId, setTimeout(() => {
              console.error(`[http] session timed out: ${transport.sessionId}`);
              transport.close();
            }, SESSION_TTL_MS));
            console.error(`[http] session created: ${transport.sessionId}`);
          }
        } else {
          jsonRpcError(res, 400, "Bad request: missing session ID");
        }
      } else if (method === "GET" || method === "DELETE") {
        const sessionId = req.headers["mcp-session-id"];
        if (!sessionId) {
          jsonRpcError(res, 400, "Bad request: missing session ID");
          return;
        }
        const transport = sessions.get(sessionId);
        if (!transport) {
          jsonRpcError(res, 404, "Session not found");
          return;
        }
        // Reset idle timer on activity
        clearTimeout(sessionTimers.get(sessionId));
        sessionTimers.set(sessionId, setTimeout(() => {
          const t = sessions.get(sessionId);
          if (t) t.close();
        }, SESSION_TTL_MS));
        await transport.handleRequest(req, res);
      } else {
        jsonRpcError(res, 405, "Method not allowed");
      }
    } catch (err) {
      console.error("[http] request error:", err);
      if (!res.headersSent) {
        jsonRpcError(res, 500, "Internal server error");
      }
    }
  });

  httpServer.listen(port, () => {
    console.error(`rigor-mcp server running on http://localhost:${port}/mcp`);
  });

  const shutdown = async () => {
    console.error("[http] shutting down...");
    const closePromises = [];
    for (const [sid, transport] of sessions) {
      clearTimeout(sessionTimers.get(sid));
      closePromises.push(transport.close().catch(() => {}));
    }
    await Promise.all(closePromises);
    sessions.clear();
    sessionTimers.clear();
    httpServer.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
