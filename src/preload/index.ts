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
  toggleClickThrough: (on: boolean) => ipcRenderer.invoke('win:toggleClickThrough', on),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('win:toggleAlwaysOnTop')
});
