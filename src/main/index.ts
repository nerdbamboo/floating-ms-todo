import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createStore } from './store.js';
import type { SimpleStore } from './store.js';
import { getBackend } from '../backends/BackendFactory.js';
import { createLlmProvider } from '../llm/factory.js';
import { TodoAgent } from '../agent/TodoAgent.js';
import 'dotenv/config';

let store: SimpleStore;

function initStore(): void {
  if (!store) store = createStore();
}

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

/** renderer 입력 검증 — Graph 400/남용 방지용 최소 가드 */
function cleanTitle(v: unknown): string {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!t) throw new Error('title is required');
  if (t.length > 500) throw new Error('title too long (max 500)');
  return t;
}
function cleanId(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 256) throw new Error('invalid id');
  return s;
}
function cleanDueDate(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('dueDate must be YYYY-MM-DD');
  return v;
}

function registerIpc() {
  ipcMain.handle('todo:list', async () => {
    const backend = getBackend();
    return backend.getTasks(await backend.defaultListId());
  });
  ipcMain.handle('todo:add', async (_e, input: { title: string; dueDate?: string; notes?: string }) => {
    const backend = getBackend();
    const notes = typeof input?.notes === 'string' ? input.notes.slice(0, 2000) : undefined;
    return backend.createTask({
      title: cleanTitle(input?.title),
      dueDate: cleanDueDate(input?.dueDate),
      notes,
      source: 'user'
    });
  });
  ipcMain.handle('todo:complete', async (_e, id: string) => {
    const backend = getBackend();
    return backend.completeTask(await defaultListIdSafe(), cleanId(id));
  });
  ipcMain.handle('todo:uncomplete', async (_e, id: string) => {
    const backend = getBackend();
    return backend.uncompleteTask(await defaultListIdSafe(), cleanId(id));
  });
  ipcMain.handle('todo:delete', async (_e, id: string) => {
    const backend = getBackend();
    await backend.deleteTask(await defaultListIdSafe(), cleanId(id));
  });
  ipcMain.handle('agent:run', async (_e, text: string) => {
    const t = typeof text === 'string' ? text.slice(0, 2000) : '';
    if (!t.trim()) throw new Error('text is required');
    const res = await getAgent().run(t);
    return { reply: res.reply, tasks: res.tasks };
  });
  ipcMain.handle('win:hide', async () => {
    win?.hide();
  });
  ipcMain.handle('win:toggleClickThrough', async (_e, on: boolean) => {
    win?.setIgnoreMouseEvents(on === true, { forward: true });
  });
  ipcMain.handle('win:setOpacity', async (_e, v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('invalid opacity');
    const clamped = Math.min(1, Math.max(0.4, n));
    store.set('opacity', clamped);
    win?.setOpacity(clamped);
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
  initStore();
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

// GPU 없는 환경(원격 데스크톱/VM/일부 Linux)에서 렌더러 크래시 시
// --disable-gpu 로 1회 자동 재시작. (정상 GPU 환경에서는 발동하지 않음)
let gpuRelaunched = process.argv.includes('--float-disable-gpu');
app.on('render-process-gone', (_e, _wc, details) => {
  if ((details.reason === 'crashed' || details.reason === 'killed') && !gpuRelaunched) {
    gpuRelaunched = true;
    const isUnpackedJs = process.argv.slice(1).some((a) => a.endsWith('.js'));
    if (isUnpackedJs) {
      app.relaunch({ args: [...process.argv.slice(1), '--float-disable-gpu', '--disable-gpu'] });
      app.exit(0);
    }
  }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// file:// preload 경로 이슈 대비 (electron-vite preview)
export const _rendererEntry = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
