import type { LlmChatOptions, LlmMessage, LlmProvider, LlmResponse } from '../core/llm-types.js';

/**
 * llm/MockProvider.ts
 * -------------------
 * API 키 없이 테스트용. tools가 주어지면 간단한 규칙으로 tool_call을 흉내냅니다.
 * "내일 보고서 추가해줘" 같은 입력의 파이프라인 테스트에 사용.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  async chat(messages: LlmMessage[], opts?: LlmChatOptions): Promise<LlmResponse> {
    // tool 실행 결과를 받은 후턴이면 더 이상 도구를 호출하지 않고 최종 답만 반환
    // (실제 LLM의 follow-up 응답을 흉내 → TodoAgent 무한/중복 호출 방지)
    if (messages.some((m) => m.role === 'tool')) {
      const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
      return { content: `처리했습니다: ${(lastTool?.content ?? '').slice(0, 200)}`, toolCalls: [] };
    }
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const tools = opts?.tools ?? [];
    const has = (n: string) => tools.some((t) => t.name === n);

    // 완료 의도
    if (/완료|끝냈|done|complete|체크/i.test(lastUser) && has('complete_task')) {
      return {
        content: '완료 처리할 작업을 찾았습니다.',
        toolCalls: [{ id: 'mock-1', name: 'complete_task', arguments: { query: lastUser } }]
      };
    }
    // 목록 조회 의도
    if (/보여|목록|리스트|뭐.*있|list|show/i.test(lastUser) && has('list_tasks')) {
      return {
        content: '목록을 조회합니다.',
        toolCalls: [{ id: 'mock-1', name: 'list_tasks', arguments: {} }]
      };
    }
    // 기본: 추가 의도
    if (has('add_task')) {
      const title = lastUser
        .replace(/(추가|넣어|만들어|해줘|주세요|해 줘)/g, '')
        .replace(/^(할일|할 일|투두|todo)[:\s]*/i, '')
        .trim()
        .slice(0, 200) || lastUser.slice(0, 200);
      return {
        content: `작업 "${title}"을(를) 추가합니다.`,
        toolCalls: [{ id: 'mock-1', name: 'add_task', arguments: { title } }]
      };
    }
    return { content: `Mock 응답: "${lastUser}"`, toolCalls: [] };
  }
}
