/**
 * core/todo-types.ts
 * ------------------
 * 모든 Todo 백엔드(MS To Do, 로컬 메모리, 추후 Notion 등)가 구현해야 하는 계약.
 * LLM 에이전트/도구는 이 인터페이스에만 의존하므로 백엔드를 갈아끼워도
 * LLM 코드는 손대지 않아도 됩니다.
 */

export interface TodoTask {
  /** 백엔드 고유 ID (MS To Do면 Graph task id) */
  id: string;
  /** 리스트 ID (MS To Do면 taskList id) */
  listId: string;
  title: string;
  /** 완료 여부 */
  isCompleted: boolean;
  /** 중요도 */
  importance?: 'low' | 'normal' | 'high';
  dueDate?: string | null; // ISO date, e.g. 2026-09-20
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TodoList {
  id: string;
  name: string;
}

export interface CreateTaskInput {
  listId?: string;
  title: string;
  notes?: string;
  dueDate?: string;
  importance?: TodoTask['importance'];
  /** LLM이 남기는 근거/출처 메모 */
  source?: 'user' | 'llm' | 'mcp';
}

export interface TodoBackend {
  readonly name: string;
  lists(): Promise<TodoList[]>;
  getTasks(listId: string): Promise<TodoTask[]>;
  /** listId 생략 시 기본 리스트 사용 */
  createTask(input: CreateTaskInput): Promise<TodoTask>;
  completeTask(listId: string, taskId: string): Promise<TodoTask>;
  uncompleteTask(listId: string, taskId: string): Promise<TodoTask>;
  deleteTask(listId: string, taskId: string): Promise<void>;
  defaultListId(): Promise<string>;
}
