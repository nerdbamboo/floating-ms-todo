import type { TodoBackend, TodoList, TodoTask, CreateTaskInput } from '../core/todo-types.js';

/**
 * backends/MemoryBackend.ts
 * -------------------------
 * 인증 없이 바로 실행해볼 수 있는 인메모리 백엔드.
 * TODO_BACKEND=memory (기본값) 일 때 사용.
 * 나중에 JSON/SQLite 영속화하고 싶으면 이 파일만 확장하면 됩니다.
 */
export class MemoryBackend implements TodoBackend {
  readonly name = 'memory';
  private listsStore: TodoList[] = [{ id: 'default', name: 'Tasks' }];
  private tasks = new Map<string, TodoTask[]>();
  private seq = 1;

  constructor() {
    this.tasks.set('default', []);
  }

  async lists(): Promise<TodoList[]> {
    return [...this.listsStore];
  }

  async defaultListId(): Promise<string> {
    return 'default';
  }

  async getTasks(listId: string): Promise<TodoTask[]> {
    return [...(this.tasks.get(listId) ?? [])].sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
  }

  async createTask(input: CreateTaskInput): Promise<TodoTask> {
    const listId = input.listId ?? (await this.defaultListId());
    if (!this.tasks.has(listId)) this.tasks.set(listId, []);
    const now = new Date().toISOString();
    const task: TodoTask = {
      id: `mem-${this.seq++}`,
      listId,
      title: input.title.trim(),
      isCompleted: false,
      importance: input.importance ?? 'normal',
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now
    };
    if (!task.title) throw new Error('title is required');
    this.tasks.get(listId)!.unshift(task);
    return task;
  }

  async completeTask(listId: string, taskId: string): Promise<TodoTask> {
    return this.setCompleted(listId, taskId, true);
  }

  async uncompleteTask(listId: string, taskId: string): Promise<TodoTask> {
    return this.setCompleted(listId, taskId, false);
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    const arr = this.tasks.get(listId) ?? [];
    this.tasks.set(
      listId,
      arr.filter((t) => t.id !== taskId)
    );
  }

  private async setCompleted(listId: string, taskId: string, done: boolean): Promise<TodoTask> {
    const arr = this.tasks.get(listId) ?? [];
    const found = arr.find((t) => t.id === taskId);
    if (!found) throw new Error(`task not found: ${taskId}`);
    found.isCompleted = done;
    found.updatedAt = new Date().toISOString();
    return { ...found };
  }
}
