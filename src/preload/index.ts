import { contextBridge, ipcRenderer } from 'electron';

/** renderer에서 window.todo.xxx 로 호출. 채널명은 shared/ipc.ts와 1:1 대응. */
contextBridge.exposeInMainWorld('todo', {
  list: () => ipcRenderer.invoke('todo:list'),
  add: (input: { title: string; dueDate?: string; notes?: string }) => ipcRenderer.invoke('todo:add', input),
  complete: (id: string) => ipcRenderer.invoke('todo:complete', id),
  uncomplete: (id: string) => ipcRenderer.invoke('todo:uncomplete', id),
  remove: (id: string) => ipcRenderer.invoke('todo:delete', id),
  agent: (text: string) => ipcRenderer.invoke('agent:run', text),
  setOpacity: (v: number) => ipcRenderer.invoke('win:setOpacity', v),
  hide: () => ipcRenderer.invoke('win:hide'),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  collapse: () => ipcRenderer.invoke('win:collapse'),
  expand: () => ipcRenderer.invoke('win:expand'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('win:toggleAlwaysOnTop'),
  // ---- 설정/로그인 ----
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input: Record<string, unknown>) => ipcRenderer.invoke('settings:save', input),
  clearLlmKey: () => ipcRenderer.invoke('settings:clear-key'),
  testLlm: (draft: Record<string, unknown>) => ipcRenderer.invoke('llm:test', draft),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  loginInteractive: () => ipcRenderer.invoke('auth:login-interactive'),
  loginDevice: () => ipcRenderer.invoke('auth:login-device'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  onAuthEvent: (cb: (kind: 'changed' | 'device-code', payload: unknown) => void) => {
    const changed = (_e: unknown, payload: unknown) => cb('changed', payload);
    const code = (_e: unknown, payload: unknown) => cb('device-code', payload);
    ipcRenderer.on('auth:changed', changed);
    ipcRenderer.on('auth:device-code', code);
    return () => {
      ipcRenderer.removeListener('auth:changed', changed);
      ipcRenderer.removeListener('auth:device-code', code);
    };
  }
});
