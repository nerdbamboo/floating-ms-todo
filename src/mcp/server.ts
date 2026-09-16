/**
 * mcp/server.ts
 * -------------
 * 외부 LLM(Claude Desktop / Cursor / Cline / Continue 등)에서
 * 이 TODO 앱을 직접 조종할 수 있게 하는 MCP(stdio) 서버.
 *
 * 실행:  npm run mcp
 *   TODO_BACKEND=memory npm run mcp
 *   TODO_BACKEND=mstodo AZURE_CLIENT_ID=... npm run mcp
 *
 * Claude Desktop 설정(claude_desktop_config.json) 예:
 * {
 *   "mcpServers": {
 *     "floating-todo": { "command": "npx", "args": ["tsx", "/절대경로/floating_todo/src/mcp/server.ts"] }
 *   }
 * }
 *
 * 프로토콜: JSON-RPC 2.0 over stdio (MCP tools/list, tools/call 최소 구현)
 * 의존성 없이 stdlib만 사용 → 설치 없이 어떤 LLM 클라이언트에서도 연결 가능.
 */
import { getBackend } from '../backends/BackendFactory.js';
import { TodoAgent } from '../agent/TodoAgent.js';
import { TODO_TOOLS } from '../agent/tools.js';
import { MockProvider } from '../llm/MockProvider.js';

const backend = getBackend();
// MCP는 도구 실행만 담당하므로 LLM 없이도 동작. 에이전트 재사용으로 로직 단일화.
const agent = new TodoAgent(backend, new MockProvider());

function mcpToolSchemas() {
  return TODO_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters
  }));
}

async function handleRequest(req: { jsonrpc: string; id: number | string | null; method: string; params?: Record<string, unknown> }) {
  const { id, method, params } = req;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

  try {
    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'floating-todo', version: '0.1.0' }
        });
      case 'tools/list':
        return ok({ tools: mcpToolSchemas() });
      case 'tools/call': {
        const name = params?.name as string;
        const args = (params?.arguments as Record<string, unknown>) ?? {};
        const result = await agent.executeTool(name, args);
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      }
      case 'ping':
        return ok({});
      default:
        return err(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    return err(-32000, e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  process.stdin.setEncoding('utf-8');
  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const req = JSON.parse(trimmed);
        const res = await handleRequest(req);
        process.stdout.write(JSON.stringify(res) + '\n');
      } catch (e) {
        process.stdout.write(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: String(e) } }) + '\n'
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
