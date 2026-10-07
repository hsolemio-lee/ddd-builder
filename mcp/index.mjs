import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.mjs';

try {
  const readOnly = process.env.DDD_READ_ONLY !== 'false';
  const server = createMcpServer({
    url: process.env.DDD_URL || 'http://127.0.0.1:3210',
    code: process.env.DDD_CODE,
    token: process.env.DDD_TOKEN,
    readOnly,
    name: process.env.DDD_AI_NAME || 'AI 도우미',
  });
  await server.connect(new StdioServerTransport());
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await server.close();
      process.exit(0);
    });
} catch (error) {
  console.error(`DDD Builder MCP: ${error.message}`);
  process.exitCode = 1;
}
