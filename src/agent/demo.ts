import { MemoryBackend } from '../backends/MemoryBackend.js';
import { MockProvider } from '../llm/MockProvider.js';
import { TodoAgent } from './TodoAgent.js';

/** LLM 파이프라인 데모: npx tsx src/agent/demo.ts "내일 보고서 추가해줘" */
async function main() {
  const text = process.argv.slice(2).join(' ') || '내일 보고서 제출 추가해줘';
  const agent = new TodoAgent(new MemoryBackend(), new MockProvider());
  const res = await agent.run(text);
  console.log('reply:', res.reply);
  console.log('tools:', JSON.stringify(res.toolCalls, null, 2));
  console.log('tasks:', JSON.stringify(res.tasks, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
