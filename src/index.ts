import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerChequeTools } from './tools/cheques.js';
import { registerPartyTools } from './tools/parties.js';

const server = new McpServer({
  name: 'cheque-mcp',
  version: '1.0.0',
});

registerChequeTools(server);
registerPartyTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('cheque-mcp server running on stdio\n');
}

main().catch((err: Error) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
