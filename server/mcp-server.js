import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-tools.js';

// Local stdio MCP entry point (npm run mcp). The hosted deployment exposes
// the same tools over HTTP at /mcp instead — see http-server.js.
const transport = new StdioServerTransport();
await createMcpServer().connect(transport);
