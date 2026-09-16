import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import Store from 'electron-store';
import { getBackend } from '../backends/BackendFactory.js';
import { createLlmProvider } from '../llm/factory.js';
import { TodoAgent } from '../agent/TodoAgent.js';
import 'dotenv/config';

const store = new Store<{ opacity: number; alwaysOnTop: boolean; bounds?: Electron.Rectangle }>({
  defaults: {
    opacity: Number(process.env.FLOAT_OPACITY ?? 0.95),
    alwaysOnTop: (process.env.FLOAT_ALWAYS_ON_TOP ?? 'true') === 'true'
  }
});

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let agent: TodoAgent | null = null;

function getAgent(): TodoAgent {
  if (!agent) agent = new TodoAgent(getBackend(), createLlmProvider());
  return agent;
}

async function defaultListIdSafe(): Promise<string> {
  return getBackend().defaultListId();
}

function registerIpc() {
  ipcMain.handle('todo:list', async () => {
    const backend = getBackend();
    return backend.getTasks(await backend.defaultListId());
  });
  ipcMain.handle('todo:add', async (_e, input: { title: string; dueDate?: string; notes?: string }) => {
    const backend = getBackend();
    return backend.createTask({ title: input.title, dueDate: input.dueDate, notes: input.notes, source: 'user' });
  });
  ipcMain.handle('todo:complete', async (_e, id: string) => {
    const backend = getBackend();
    return backend.completeTask(await defaultListIdSafe(), id);
  });
  ipcMain.handle('todo:uncomplete', async (_e, id: string) => {
    const backend = getBackend();
    return backend.uncompleteTask(await defaultListIdSafe(), id);
  });
  ipcMain.handle('todo:delete', async (_e, id: string) => {
    const backend = getBackend();
    await backend.deleteTask(await defaultListIdSafe(), id);
  });
  ipcMain.handle('agent:run', async (_e, text: string) => {
    const res = await getAgent().run(text);
    return { reply: res.reply, tasks: res.tasks };
  });
  ipcMain.handle('win:toggleClickThrough', async (_e, on: boolean) => {
    win?.setIgnoreMouseEvents(on, { forward: true });
  });
  ipcMain.handle('win:setOpacity', async (_e, v: number) => {
    store.set('opacity', v);
    win?.setOpacity(v);
  });
  ipcMain.handle('win:toggleAlwaysOnTop', async () => {
    const next = !win?.isAlwaysOnTop();
    win?.setAlwaysOnTop(next);
    store.set('alwaysOnTop', next);
    return next;
  });
}

function createWindow() {
  const savedBounds = store.get('bounds') as Electron.Rectangle | undefined;
  win = new BrowserWindow({
    width: Number(process.env.FLOAT_WIDTH ?? 360),
    height: Number(process.env.FLOAT_HEIGHT ?? 520),
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    // ---- floating 핵심 ----
    alwaysOnTop: store.get('alwaysOnTop') as boolean,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    opacity: store.get('opacity') as number,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.on('moved', () => store.set('bounds', win?.getBounds()));
  win.on('resized', () => store.set('bounds', win?.getBounds()));

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Linux 일부 WM에서 alwaysOnTop 유지
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip('Floating To Do');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '보이기/숨기기', click: () => (win?.isVisible() ? win.hide() : win?.show()) },
        {
          label: 'Always on top',
          type: 'checkbox',
          checked: store.get('alwaysOnTop') as boolean,
          click: (item) => {
            win?.setAlwaysOnTop(item.checked);
            store.set('alwaysOnTop', item.checked);
          }
        },
        { type: 'separator' },
        { label: '종료', click: () => app.quit() }
      ])
    );
    tray.on('click', () => (win?.isVisible() ? win.hide() : win?.show()));
  } catch {
    /* tray 미지원 환경 무시 */
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  createTray();
  // 전역 단축키: Ctrl+Shift+T 로 숨기기/보이기 (Linux/Windows 공용)
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// file:// preload 경로 이슈 대비 (electron-vite preview)
export const _rendererEntry = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
