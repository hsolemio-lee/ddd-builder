import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.mjs';

// Each request owns its server and credentials; no user state is shared.
export async function handleMcpHttp(req, res, payload, options) {
  const server = createMcpServer(options);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.once('close', () => {
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, payload);
  } catch (error) {
    await server.close();
    throw error;
  }
}
