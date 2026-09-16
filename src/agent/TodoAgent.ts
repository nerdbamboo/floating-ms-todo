import type { TodoBackend, TodoTask } from '../core/todo-types.js';
import type { LlmMessage, LlmProvider } from '../core/llm-types.js';
import { TODO_TOOLS, AGENT_SYSTEM_PROMPT } from './tools.js';

/**
 * agent/TodoAgent.ts
 * ------------------
 * 자연어 → TodoBackend 실행. LLM 공급자에 무관하게 동작.
 *
 *   const agent = new TodoAgent(backend, llm);
 *   const { reply, tasks } = await agent.run("내일 보고서 제출 추가해줘");
 *
 * LLM 없이 쓰고 싶으면 backend 메서드를 직접 호출해도 됩니다.
 * (에이전트는 얇은 오케스트레이터일 뿐, 진짜 상태는 항상 TodoBackend에 있음)
 */
export interface AgentResult {
  reply: string;
  toolCalls: { name: string; arguments: Record<string, unknown>; result: unknown }[];
  tasks: TodoTask[];
}

export class TodoAgent {
  constructor(
    private backend: TodoBackend,
    private llm: LlmProvider
  ) {}

  async run(userText: string, history: LlmMessage[] = []): Promise<AgentResult> {
    const messages: LlmMessage[] = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      ...history.slice(-10),
      { role: 'user', content: userText }
    ];

    const first = await this.llm.chat(messages, { tools: TODO_TOOLS, toolChoice: 'auto' });
    const executed: AgentResult['toolCalls'] = [];

    if (first.toolCalls.length === 0) {
      // LLM이 도구 없이 답한 경우: 그래도 최신 목록을 함께 반환해 UI 갱신 가능하게
      const tasks = await this.safeList();
      return { reply: first.content || '완료했습니다.', toolCalls: [], tasks };
    }

    // 최대 3턴 tool loop (list→add→confirm 같은 연속 호출 지원)
    let lastContent = first.content;
    let pending = first.toolCalls;
    for (let turn = 0; turn < 3 && pending.length > 0; turn++) {
      const toolMessages: LlmMessage[] = [];
      for (const call of pending) {
        const result = await this.executeTool(call.name, call.arguments);
        executed.push({ name: call.name, arguments: call.arguments, result });
        toolMessages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(result).slice(0, 4000)
        });
      }
      const followup = await this.llm.chat([...messages, { role: 'assistant', content: lastContent, toolCalls: pending }, ...toolMessages], {
        tools: TODO_TOOLS
      });
      lastContent = followup.content || lastContent;
      pending = followup.toolCalls;
      messages.push(
        { role: 'assistant', content: lastContent, toolCalls: executed.length ? undefined : pending },
        ...toolMessages
      );
      if (pending.length === 0) break;
    }

    const tasks = await this.safeList();
    return { reply: lastContent || this.summarize(executed), toolCalls: executed, tasks };
  }

  /** LLM 도구 호출 → 백엔드 실행. MCP 서버와 동일한 로직을 공유. */
  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    switch (name) {
      case 'list_tasks': {
        const listId = str(args.listId) ?? (await this.backend.defaultListId());
        const tasks = await this.backend.getTasks(listId);
        if (args.includeCompleted === false) return tasks.filter((t) => !t.isCompleted);
        return tasks;
      }
      case 'add_task': {
        const title = str(args.title)?.trim();
        if (!title) throw new Error('add_task.title is required');
        return this.backend.createTask({
          title,
          notes: str(args.notes),
          dueDate: str(args.dueDate),
          importance: (str(args.importance) as TodoTask['importance']) ?? 'normal',
          source: 'llm'
        });
      }
      case 'complete_task': {
        const listId = str(args.listId) ?? (await this.backend.defaultListId());
        let taskId = str(args.taskId);
        if (!taskId) {
          const q = str(args.query) ?? '';
          const tasks = await this.backend.getTasks(listId);
          const hit =
            tasks.find((t) => !t.isCompleted && t.title.includes(q)) ??
            tasks.find((t) => t.title.toLowerCase().includes(q.toLowerCase()));
          if (!hit) throw new Error(`완료할 작업을 찾지 못했습니다: "${q}"`);
          taskId = hit.id;
        }
        return this.backend.completeTask(listId, taskId);
      }
      case 'delete_task': {
        const listId = str(args.listId) ?? (await this.backend.defaultListId());
        let taskId = str(args.taskId);
        if (!taskId) {
          const q = str(args.query) ?? '';
          const tasks = await this.backend.getTasks(listId);
          const hit = tasks.find((t) => t.title.includes(q));
          if (!hit) throw new Error(`삭제할 작업을 찾지 못했습니다: "${q}"`);
          taskId = hit.id;
        }
        await this.backend.deleteTask(listId, taskId);
        return { deleted: taskId };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  private async safeList(): Promise<TodoTask[]> {
    try {
      return await this.backend.getTasks(await this.backend.defaultListId());
    } catch {
      return [];
    }
  }

  private summarize(calls: AgentResult['toolCalls']): string {
    if (calls.length === 0) return '완료했습니다.';
    const last = calls[calls.length - 1];
    if (last.name === 'add_task') return '할 일을 추가했습니다.';
    if (last.name === 'complete_task') return '완료 처리했습니다.';
    if (last.name === 'delete_task') return '삭제했습니다.';
    return '목록을 가져왔습니다.';
  }
}
