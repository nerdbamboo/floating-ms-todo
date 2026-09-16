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
  'win:hide': () => Promise<void>;
  'win:minimize': () => Promise<void>;
  'win:toggleAlwaysOnTop': () => Promise<boolean>;
};

export interface SettingsDTO {
  todoBackend: 'memory' | 'mstodo';
  azureClientId: string;
  azureTenantId: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmModel: string;
  hasLlmKey: boolean;
  keyProtection: 'os-keychain' | 'plain' | 'none';
}

export interface AuthStatus {
  backend: string;
  loggedIn: boolean;
  username: string | null;
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  message: string;
}
