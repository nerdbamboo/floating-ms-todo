/** renderer ↔ main 공유 타입 (IPC 계약). LLM 도구와 필드명을 일치시켜 혼선을 줄임. */
export interface RendererTask {
  id: string;
  listId: string;
  title: string;
  isCompleted: boolean;
  importance?: 'low' | 'normal' | 'high';
  dueDate?: string | null;
  notes?: string | null;
}

export type IpcChannels = {
  'todo:list': () => Promise<RendererTask[]>;
  'todo:add': (input: { title: string; dueDate?: string; notes?: string }) => Promise<RendererTask>;
  'todo:complete': (id: string) => Promise<RendererTask>;
  'todo:uncomplete': (id: string) => Promise<RendererTask>;
  'todo:delete': (id: string) => Promise<void>;
  'agent:run': (text: string) => Promise<{ reply: string; tasks: RendererTask[] }>;
  'win:toggleClickThrough': (on: boolean) => Promise<void>;
  'win:setOpacity': (v: number) => Promise<void>;
  'win:toggleAlwaysOnTop': () => Promise<boolean>;
};
