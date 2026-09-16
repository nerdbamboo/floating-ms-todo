import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, clipboard } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createStore } from './store.js';
import type { SimpleStore } from './store.js';
import { getBackend, setBackend } from '../backends/BackendFactory.js';
import { MemoryBackend } from '../backends/MemoryBackend.js';
import { MsTodoBackend } from '../backends/MsTodoBackend.js';
import { OpenAICompatibleProvider } from '../llm/OpenAICompatibleProvider.js';
import { MockProvider } from '../llm/MockProvider.js';
import type { LlmProvider } from '../core/llm-types.js';
import { TodoAgent } from '../agent/TodoAgent.js';
import {
  getSettingsDTO,
  getRuntimeSettings,
  saveSettings,
  clearLlmKey,
  type SettingsInput
} from './settings.js';
import 'dotenv/config';

let store: SimpleStore;

function initStore(): void {
  if (!store) store = createStore();
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

function getMsBackend(): MsTodoBackend | null {
  const b = getBackend();
  return b instanceof MsTodoBackend ? b : null;
}

/** settings.json → 백엔드 인스턴스 (mstodo 설정이 불완전하면 memory로 폴백) */
function applyBackendFromSettings(): string {
  const s = getRuntimeSettings();
  if (s.todoBackend === 'mstodo' && s.azureClientId && !s.azureClientId.includes('00000000')) {
    setBackend(
      new MsTodoBackend({
        clientId: s.azureClientId,
        tenantId: s.azureTenantId || 'consumers',
        cachePath: join(app.getPath('userData'), 'msal-cache.json')
      })
    );
    return 'mstodo';
  }
  setBackend(new MemoryBackend());
  return 'memory';
}

function buildLlmFromSettings(overrides?: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): LlmProvider {
  const s = getRuntimeSettings();
  const provider = (overrides?.provider || s.llmProvider || 'mock').toLowerCase();
  if (provider === 'mock') return new MockProvider();
  return new OpenAICompatibleProvider({
    name: provider,
    baseURL: overrides?.baseUrl || s.llmBaseUrl,
    apiKey: overrides?.apiKey !== undefined ? overrides.apiKey : s.llmApiKey,
    model: overrides?.model || s.llmModel
  });
}

function getAgent(): TodoAgent {
  return new TodoAgent(getBackend(), buildLlmFromSettings());
}

function notifyAuthChanged(): void {
  getAuthStatus()
    .then((st) => win?.webContents.send('auth:changed', st))
    .catch(() => undefined);
}

async function getAuthStatus(): Promise<{ backend: string; loggedIn: boolean; username: string | null }> {
  const ms = getMsBackend();
  if (!ms) return { backend: 'memory', loggedIn: false, username: null };
  const acc = await ms.getAccountInfo();
  return { backend: 'mstodo', loggedIn: !!acc, username: acc?.username ?? null };
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
  // ---- 설정 (MS/LLM UI 로그인) ----
  ipcMain.handle('settings:get', async () => getSettingsDTO());
  ipcMain.handle('settings:save', async (_e, input: SettingsInput) => {
    const dto = saveSettings(input ?? {});
    applyBackendFromSettings();
    notifyAuthChanged();
    return dto;
  });
  ipcMain.handle('settings:clear-key', async () => clearLlmKey());
  ipcMain.handle(
    'llm:test',
    async (
      _e,
      draft: { provider?: string; baseUrl?: string; apiKey?: string; model?: string }
    ) => {
      const saved = getRuntimeSettings();
      const provider = buildLlmFromSettings({
        provider: draft?.provider || saved.llmProvider,
        baseUrl: draft?.baseUrl || saved.llmBaseUrl,
        // UI에서 키를 비워두면 저장된 키 사용, 저장된 것도 없으면 '' (mock/ollama는 키 불필요)
        apiKey: draft?.apiKey ? draft.apiKey : saved.llmApiKey,
        model: draft?.model || saved.llmModel
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('연결 시간 초과 (25s)')), 25_000)
      );
      try {
        const res = await Promise.race([
          provider.chat([{ role: 'user', content: 'ping이라고만 답해.' }]),
          timeout
        ]);
        return { ok: true as const, reply: res.content.slice(0, 300), provider: provider.name };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
  ipcMain.handle('auth:status', async () => getAuthStatus());
  ipcMain.handle('auth:login-interactive', async () => {
    const ms = getMsBackend();
    if (!ms) throw new Error('Todo 백엔드가 MS To Do가 아닙니다. 설정에서 mstodo로 바꾸고 Client ID를 입력하세요.');
    const acc = await ms.loginInteractive((url) => shell.openExternal(url));
    notifyAuthChanged();
    return acc;
  });
  let deviceLoginBusy = false;
  ipcMain.handle('auth:login-device', async () => {
    const ms = getMsBackend();
    if (!ms) throw new Error('Todo 백엔드가 MS To Do가 아닙니다. 설정에서 mstodo로 바꾸고 Client ID를 입력하세요.');
    if (deviceLoginBusy) throw new Error('이미 로그인 진행 중입니다.');
    deviceLoginBusy = true;
    try {
      let codeInfo: { userCode: string; verificationUri: string; message: string } | null = null;
      const done = ms.loginDeviceCode((info) => {
        codeInfo = info;
        win?.webContents.send('auth:device-code', info);
      });
      // 코드가 발급될 때까지 대기 후 UI에 반환, 폴링은 백그라운드에서 계속
      for (let i = 0; i < 100 && !codeInfo; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!codeInfo) throw new Error('코드 발급 실패. 다시 시도하세요.');
      const info = codeInfo;
      done
        .then(() => notifyAuthChanged())
        .catch(() => undefined)
        .finally(() => {
          deviceLoginBusy = false;
        });
      return info;
    } catch (e) {
      deviceLoginBusy = false;
      throw e;
    }
  });
  ipcMain.handle('auth:logout', async () => {
    await getMsBackend()?.logout();
    notifyAuthChanged();
    return { ok: true };
  });
  ipcMain.handle('clipboard:write', async (_e, text: string) => {
    if (typeof text !== 'string' || text.length === 0 || text.length > 200) throw new Error('invalid text');
    clipboard.writeText(text);
  });
  ipcMain.handle('win:hide', async () => {
    win?.hide();
  });
  ipcMain.handle('win:minimize', async () => {
    win?.minimize(); // 작업표시줄에는 남음
  });
  // ---- 미니바: 최소화 대신 작은 바로 접기 ----
  let prevBounds: Electron.Rectangle | null = null;
  ipcMain.handle('win:collapse', async () => {
    if (!win) return;
    if (!prevBounds) prevBounds = win.getBounds();
    win.setMinimumSize(200, 40);
    win.setMaximumSize(600, 44);
    win.setSize(280, 44, true);
  });
  ipcMain.handle('win:expand', async () => {
    if (!win) return;
    win.setMaximumSize(0, 0); // 제한 해제 (0 = 무제한)
    win.setMinimumSize(220, 160);
    if (prevBounds) {
      win.setBounds({ x: prevBounds.x, y: prevBounds.y, width: prevBounds.width, height: prevBounds.height }, true);
      prevBounds = null;
    } else {
      win.setSize(Number(process.env.FLOAT_WIDTH ?? 360), Number(process.env.FLOAT_HEIGHT ?? 520), true);
    }
    win.focus();
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
    minimizable: true,
    maximizable: false,
    skipTaskbar: false, // 최소화해도 작업표시줄에 남김
    opacity: store.get('opacity') as number,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.on('moved', () => store.set('bounds', win?.getBounds()));
  win.on('resized', () => store.set('bounds', win?.getBounds()));
  // 투명 창이 최소화될 때 작업표시줄 버튼이 같이 사라지는 Chromium 이슈 방지
  win.on('minimize', () => win?.setSkipTaskbar(false));
  win.on('restore', () => win?.focus());

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
  applyBackendFromSettings();
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
