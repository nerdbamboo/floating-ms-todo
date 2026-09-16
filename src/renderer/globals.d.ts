interface TodoBridge {
  list: () => Promise<RendererTask[]>;
  add: (input: { title: string; dueDate?: string; notes?: string }) => Promise<RendererTask>;
  complete: (id: string) => Promise<RendererTask>;
  uncomplete: (id: string) => Promise<RendererTask>;
  remove: (id: string) => Promise<void>;
  agent: (text: string) => Promise<{ reply: string; tasks: RendererTask[] }>;
  setOpacity: (v: number) => Promise<void>;
  hide: () => Promise<void>;
  minimize: () => Promise<void>;
  toggleAlwaysOnTop: () => Promise<boolean>;
  settings: () => Promise<SettingsDTO>;
  saveSettings: (input: Record<string, unknown>) => Promise<SettingsDTO>;
  clearLlmKey: () => Promise<SettingsDTO>;
  testLlm: (draft: Record<string, unknown>) => Promise<{ ok: boolean; reply?: string; error?: string; provider?: string }>;
  authStatus: () => Promise<AuthStatus>;
  loginInteractive: () => Promise<{ username: string }>;
  loginDevice: () => Promise<DeviceCodeInfo>;
  logout: () => Promise<{ ok: boolean }>;
  copyText: (text: string) => Promise<void>;
  onAuthEvent: (cb: (kind: 'changed' | 'device-code', payload: unknown) => void) => () => void;
}

interface SettingsDTO {
  todoBackend: 'memory' | 'mstodo';
  azureClientId: string;
  azureTenantId: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmModel: string;
  hasLlmKey: boolean;
  keyProtection: 'os-keychain' | 'plain' | 'none';
}

interface AuthStatus {
  backend: string;
  loggedIn: boolean;
  username: string | null;
}

interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  message: string;
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
