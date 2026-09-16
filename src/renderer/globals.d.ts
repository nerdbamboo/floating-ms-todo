interface TodoBridge {
  list: () => Promise<RendererTask[]>;
  add: (input: { title: string; dueDate?: string; notes?: string }) => Promise<RendererTask>;
  complete: (id: string) => Promise<RendererTask>;
  uncomplete: (id: string) => Promise<RendererTask>;
  remove: (id: string) => Promise<void>;
  agent: (text: string) => Promise<{ reply: string; tasks: RendererTask[] }>;
  setOpacity: (v: number) => Promise<void>;
  toggleClickThrough: (on: boolean) => Promise<void>;
  toggleAlwaysOnTop: () => Promise<boolean>;
}

interface RendererTask {
  id: string;
  listId: string;
  title: string;
  isCompleted: boolean;
  importance?: 'low' | 'normal' | 'high';
  dueDate?: string | null;
  notes?: string | null;
}

interface Window {
  todo: TodoBridge;
}
