import type { LlmTool } from '../core/llm-types.js';

/**
 * agent/tools.ts
 * --------------
 * LLM Function Calling / MCP / OpenAI tools 스펙의 단일 소스.
 * 새 기능을 추가하고 싶으면 여기 + TodoAgent.executeTool()에만 추가하면
 * 채팅 UI, MCP 서버, 모든 LLM 공급자에 자동 반영됩니다.
 */
export const TODO_TOOLS: LlmTool[] = [
  {
    name: 'list_tasks',
    description: '현재 할 일 목록을 조회한다. 필터 없이 전체 미완료+완료를 반환.',
    parameters: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: '리스트 ID (생략 시 기본 리스트)' },
        includeCompleted: { type: 'boolean', description: '완료 포함 여부', default: true }
      }
    }
  },
  {
    name: 'add_task',
    description: '새 할 일을 추가한다.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '할 일 제목' },
        notes: { type: 'string', description: '메모' },
        dueDate: { type: 'string', description: '마감일 YYYY-MM-DD' },
        importance: { type: 'string', enum: ['low', 'normal', 'high'] }
      },
      required: ['title']
    }
  },
  {
    name: 'complete_task',
    description: '할 일을 완료 처리한다. taskId가 없으면 query로 제목 검색 후 첫 매칭을 완료.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '작업 ID' },
        query: { type: 'string', description: '제목 검색어 (taskId 없을 때)' }
      }
    }
  },
  {
    name: 'delete_task',
    description: '할 일을 삭제한다.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '작업 ID' },
        query: { type: 'string', description: '제목 검색어' }
      }
    }
  }
];

export const AGENT_SYSTEM_PROMPT = `당신은 Microsoft To Do 비서입니다.
사용자의 한국어/영어 자연어 요청을 TODO_TOOLS 함수 호출로 변환하세요.
규칙:
1. "내일 회의 준비 추가해줘" → add_task(title="회의 준비", dueDate=내일 날짜)
2. "보고서 끝냈어" → complete_task(query="보고서")
3. "뭐 있어?" → list_tasks
4. 확신 없으면 list_tasks로 먼저 확인 후 답하세요.
5. tool 호출 전후로 짧은 한국어 확인 메시지를 content에 남기세요.
오늘 날짜: ${new Date().toISOString().slice(0, 10)}`;
