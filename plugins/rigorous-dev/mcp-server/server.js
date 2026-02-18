import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifact } from "./validate.js";
import { listIds, queryArtifact } from "./query.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMAS_DIR = process.env.CLAUDE_PLUGIN_ROOT
  ? path.join(process.env.CLAUDE_PLUGIN_ROOT, "schemas")
  : path.resolve(__dirname, "..", "schemas");

const VALIDATE_SCHEMA = {
  type: "object",
  properties: {
    artifact_path: {
      type: "string",
      description: "Absolute path to the YAML artifact file to validate",
    },
    schema_name: {
      type: "string",
      description:
        "Schema filename, e.g. requirements.schema.yaml. Resolved relative to the plugin schemas/ directory.",
    },
  },
  required: ["artifact_path", "schema_name"],
};

const LIST_IDS_SCHEMA = {
  type: "object",
  properties: {
    artifact_path: {
      type: "string",
      description:
        "Absolute path to a YAML artifact file (requirements, architecture_components, ux_specification, or implementation_plan). Returns a structural index: every item ID with summary fields (name, category, type) plus available top-level sections.",
    },
  },
  required: ["artifact_path"],
};

const QUERY_ARTIFACT_SCHEMA = {
  type: "object",
  properties: {
    artifact_path: {
      type: "string",
      description: "Absolute path to the YAML artifact file to query",
    },
    ids: {
      type: "array",
      items: { type: "string" },
      description:
        'Item IDs to retrieve in full, e.g. ["REQ-001", "REQ-003"] or ["COMP-002"] or ["phase-1"]. Returns complete entries for each matched ID.',
    },
    field: {
      type: "string",
      description:
        'Field name to filter by, e.g. "category", "priority", "type", "requirements_addressed". Used with value parameter.',
    },
    value: {
      type: "string",
      description:
        'Value to match against the field, e.g. "security", "must-have". For array fields, matches if the array contains this value.',
    },
    section: {
      type: "string",
      description:
        'Return an entire top-level section by key name, e.g. "personas", "constraints", "design_system", "metadata". Use list_artifact_ids first to see available sections.',
    },
  },
  required: ["artifact_path"],
};

const server = new Server(
  { name: "rigorous-dev-mcp", version: "0.9.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "validate_artifact",
      description:
        "Validate a YAML artifact against a JSON Schema. Returns structured errors if invalid.",
      inputSchema: VALIDATE_SCHEMA,
    },
    {
      name: "list_artifact_ids",
      description:
        "Return a structural index of a YAML artifact: every item ID with summary fields (name, category, type, truncated description) plus available top-level sections. Use this first to orient yourself before querying specific items. Works with requirements, architecture_components, ux_specification, and implementation_plan artifacts.",
      inputSchema: LIST_IDS_SCHEMA,
    },
    {
      name: "query_artifact",
      description:
        "Query a YAML artifact for specific items. Three modes: (1) by IDs — pass ids array to get full entries; (2) by field filter — pass field+value to find items matching a field; (3) by section — pass section name to get an entire top-level section. Use list_artifact_ids first to discover what's available.",
      inputSchema: QUERY_ARTIFACT_SCHEMA,
    },
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
      case "validate_artifact": {
        const artifactPath = /** @type {string} */ (args.artifact_path);
        const schemaName = /** @type {string} */ (args.schema_name);
        if (!artifactPath || !schemaName) {
          return errResponse(
            "Missing required arguments: artifact_path and schema_name"
          );
        }
        const schemaPath = path.join(SCHEMAS_DIR, schemaName);
        const result = await validateArtifact(artifactPath, schemaPath);
        return okResponse({
          valid: result.valid,
          errors: result.errors || [],
          schema_name: schemaName,
        });
      }

      case "list_artifact_ids": {
        const artifactPath = /** @type {string} */ (args.artifact_path);
        if (!artifactPath) {
          return errResponse("Missing required argument: artifact_path");
        }
        return okResponse(listIds(artifactPath));
      }

      case "query_artifact": {
        const artifactPath = /** @type {string} */ (args.artifact_path);
        if (!artifactPath) {
          return errResponse("Missing required argument: artifact_path");
        }
        const opts = {
          ids: /** @type {string[]|undefined} */ (args.ids),
          field: /** @type {string|undefined} */ (args.field),
          value: /** @type {string|undefined} */ (args.value),
          section: /** @type {string|undefined} */ (args.section),
        };
        return okResponse(queryArtifact(artifactPath, opts));
      }

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
