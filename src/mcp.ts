/**
 * envdoc MCP server. Tool: check_env_docs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCheck, VERSION } from "./core.js";

const server = new McpServer({ name: "envdoc", version: VERSION });

server.tool(
  "check_env_docs",
  "Scan a repo's source for environment variable reads and compare with its .env.example: variables used in code but missing from the example (with file and line), variables documented but never used, and a verdict of IN-SYNC or DRIFT. Values are never read, only names.",
  {
    path: z.string().describe("Target path to check"),
  },
  async ({ path }) => {
    const report = runCheck(path);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
