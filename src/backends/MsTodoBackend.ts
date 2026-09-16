import { PublicClientApplication, type AuthenticationResult } from '@azure/msal-node';
import type { TodoBackend, TodoList, TodoTask, CreateTaskInput } from '../core/todo-types.js';

/**
 * backends/MsTodoBackend.ts
 * -------------------------
 * Microsoft To Do (Microsoft Graph /todo API) 구현.
 *
 * 인증: Device Code Flow — 리다이렉트 서버 없이 Windows/Linux 터미널에서 OK.
 *   1. 첫 실행 시 터미널에 https://microsoft.com/devicelogin + 코드 출력
 *   2. 브라우저에서 1회 로그인 → 토큰 캐시 저장 → 이후 자동 갱신
 *
 * 필요한 Azure App 설정:
 *   - entra.microsoft.com → App registrations → Supported account types
 *     개인 계정만 쓰면 "Personal Microsoft accounts only" (= consumers)
 *   - Redirect URI 설정 불필요 (device code)
 *   - API permissions: Tasks.ReadWrite (Delegated) + offline_access
 *
 * 환경변수:
 *   AZURE_CLIENT_ID, AZURE_TENANT_ID(=consumers|organizations|common),
 *   TODO_DEFAULT_LIST, MSAL_CACHE_PATH
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['Tasks.ReadWrite', 'offline_access'];

interface GraphTaskList {
  id: string;
  displayName: string;
}
interface GraphTask {
  id: string;
  title: string;
  status: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred';
  importance: 'low' | 'normal' | 'high';
  body?: { content?: string };
  dueDateTime?: { dateTime?: string };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

function toTodoTask(listId: string, g: GraphTask): TodoTask {
  return {
    id: g.id,
    listId,
    title: g.title,
    isCompleted: g.status === 'completed',
    importance: g.importance ?? 'normal',
    notes: g.body?.content ?? null,
    dueDate: g.dueDateTime?.dateTime ? g.dueDateTime.dateTime.slice(0, 10) : null,
    createdAt: g.createdDateTime,
    updatedAt: g.lastModifiedDateTime
  };
}

export class MsTodoBackend implements TodoBackend {
  readonly name = 'mstodo';
  private pca: PublicClientApplication;
  private accountCache: AuthenticationResult | null = null;
  private tokenCachePath: string;
  private defaultListName: string;

  constructor(opts?: { clientId?: string; tenantId?: string; cachePath?: string; defaultList?: string }) {
    const clientId = opts?.clientId ?? process.env.AZURE_CLIENT_ID ?? '';
    const tenantId = opts?.tenantId ?? process.env.AZURE_TENANT_ID ?? 'consumers';
    if (!clientId || clientId.includes('00000000')) {
      throw new Error(
        '[MsTodoBackend] AZURE_CLIENT_ID가 필요합니다. .env.example 참고 → Entra에서 App 등록 후 Client ID 발급.'
      );
    }
    this.pca = new PublicClientApplication({
      auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` }
    });
    this.tokenCachePath =
      opts?.cachePath ?? process.env.MSAL_CACHE_PATH ?? './msal-cache.json';
    this.defaultListName = opts?.defaultList ?? process.env.TODO_DEFAULT_LIST ?? 'Tasks';
  }

  // ---- auth (UI 로그인용 공개 API) ----

  /** 저장된 캐시만 보고 로그인 여부 확인 — 네트워크 호출 없음 */
  async getAccountInfo(): Promise<{ username: string } | null> {
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.tokenCachePath, 'utf-8').catch(() => null);
      if (!raw) return null;
      this.pca.getTokenCache().deserialize(raw);
      const accounts = await this.pca.getTokenCache().getAllAccounts();
      if (accounts.length === 0) return null;
      return { username: accounts[0].username };
    } catch {
      return null;
    }
  }

  /**
   * 브라우저 로그인 (Auth Code + loopback).
   * openBrowser를 넘기면 그걸로, 없으면 msal 내장 방식(기본 브라우저)으로 엽니다.
   * Electron main에서는 shell.openExternal을 넘겨주세요.
   */
  async loginInteractive(openBrowser?: (url: string) => Promise<void>): Promise<{ username: string }> {
    let opener = openBrowser;
    if (!opener) {
      try {
        const mod = (await import('electron')) as unknown as {
          shell?: { openExternal?: (url: string) => Promise<void> };
        };
        if (mod.shell?.openExternal) {
          const openExternal = mod.shell.openExternal.bind(mod.shell);
          opener = (url: string) => openExternal(url);
        }
      } catch {
        /* plain node에서는 아래 에러로 안내 */
      }
    }
    if (!opener) {
      throw new Error('[MsTodoBackend] 브라우저 열기가 지원되지 않는 환경입니다. Electron 앱에서 실행하거나 device code 로그인을 사용하세요.');
    }
    const result = await this.pca
      .acquireTokenInteractive({
        scopes: SCOPES,
        openBrowser: opener,
        successTemplate: '<h1>로그인 완료</h1><p>Floating To Do로 돌아가세요. 이 창은 닫아도 됩니다.</p>'
      })
      .catch((e) => {
        throw new Error(`[MsTodoBackend] 브라우저 로그인 실패: ${String(e?.message ?? e)}`);
      });
    await this.persistCache();
    return { username: result.account?.username ?? '' };
  }

  /**
   * Device Code 로그인 — onCode로 { userCode, verificationUri, message }를
   * UI에 전달하고, 사용자가 브라우저에서 입력할 때까지 대기합니다.
   */
  async loginDeviceCode(
    onCode: (info: { userCode: string; verificationUri: string; message: string }) => void
  ): Promise<{ username: string }> {
    const result = await this.pca
      .acquireTokenByDeviceCode({
        scopes: SCOPES,
        deviceCodeCallback: (res) => {
          // 콘솔 한글 깨짐(Win cp949) 방지용 영어 로그. UI에는 한글로 표시됨.
          console.log(`\n[MS sign-in] ${res.message}\n`);
          onCode({ userCode: res.userCode, verificationUri: res.verificationUri, message: res.message });
        }
      })
      .catch((e) => {
        throw new Error(`[MsTodoBackend] 디바이스 로그인 실패: ${String(e?.message ?? e)}`);
      });
    if (!result) throw new Error('[MsTodoBackend] 토큰 획득 실패');
    await this.persistCache();
    return { username: result.account?.username ?? '' };
  }

  /** 캐시 + 파일 삭제 */
  async logout(): Promise<void> {
    try {
      const { readFile, unlink } = await import('node:fs/promises');
      const raw = await readFile(this.tokenCachePath, 'utf-8').catch(() => null);
      if (raw) {
        this.pca.getTokenCache().deserialize(raw);
        const accounts = await this.pca.getTokenCache().getAllAccounts().catch(() => []);
        for (const a of accounts) {
          await this.pca.getTokenCache().removeAccount(a).catch(() => undefined);
        }
      }
      await unlink(this.tokenCachePath).catch(() => undefined);
    } catch {
      /* 로그아웃은 항상 성공扱い */
    }
  }

  private async persistCache(): Promise<void> {
    try {
      const { writeFile } = await import('node:fs/promises');
      // 토큰 캐시는 타인이 읽지 못하게 0o600 (POSIX). Windows에서는 ACL 상속.
      await writeFile(this.tokenCachePath, this.pca.getTokenCache().serialize(), { encoding: 'utf-8', mode: 0o600 });
    } catch {
      /* 캐시 저장 실패는 치명적이지 않음 */
    }
  }

  private async getToken(): Promise<string> {
    // 1) 캐시된 계정으로 silent 획득 시도
    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(this.tokenCachePath, 'utf-8').catch(() => null);
      if (raw) {
        // NOTE: 최소 구현 — MSAL의 직렬화 캐시를 복원하려면
        // tokenCache.deserialize(raw) 사용. 여기선 silent 실패 시 device code로 폴백.
        this.pca.getTokenCache().deserialize(raw);
        const accounts = await this.pca.getTokenCache().getAllAccounts();
        if (accounts.length > 0) {
          const silent = await this.pca
            .acquireTokenSilent({ scopes: SCOPES, account: accounts[0] })
            .catch(() => null);
          if (silent) return silent.accessToken;
        }
      }
    } catch {
      /* fall through to device code */
    }
    // 2) Device Code Flow
    const device = await this.pca.acquireTokenByDeviceCode({
      scopes: SCOPES,
      deviceCodeCallback: (res) => {
          console.log(`\n[MS sign-in] ${res.message}\n`);
      }
    }).catch((e) => {
      throw new Error(`[MsTodoBackend] 디바이스 로그인 실패: ${String(e?.message ?? e)}`);
    });
    const token = device?.accessToken;
    if (!token) throw new Error('[MsTodoBackend] 토큰 획득 실패');
    await this.persistCache();
    return token;
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${GRAPH}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[Graph ${res.status}] ${path} :: ${body.slice(0, 500)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ---- TodoBackend ----

  async lists(): Promise<TodoList[]> {
    const data = await this.api<{ value: GraphTaskList[] }>('/me/todo/lists');
    return data.value.map((l) => ({ id: l.id, name: l.displayName }));
  }

  async defaultListId(): Promise<string> {
    const all = await this.lists();
    const hit = all.find((l) => l.name.toLowerCase() === this.defaultListName.toLowerCase());
    if (hit) return hit.id;
    // 없으면 생성
    const created = await this.api<GraphTaskList>('/me/todo/lists', {
      method: 'POST',
      body: JSON.stringify({ displayName: this.defaultListName })
    });
    return created.id;
  }

  async getTasks(listId: string): Promise<TodoTask[]> {
    const data = await this.api<{ value: GraphTask[] }>(
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=100&$orderby=createdDateTime desc`
    );
    return data.value.map((g) => toTodoTask(listId, g));
  }

  async createTask(input: CreateTaskInput): Promise<TodoTask> {
    const listId = input.listId ?? (await this.defaultListId());
    const g = await this.api<GraphTask>(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        importance: input.importance ?? 'normal',
        ...(input.notes ? { body: { content: input.notes, contentType: 'text' } } : {}),
        ...(input.dueDate
          ? { dueDateTime: { dateTime: `${input.dueDate}T12:00:00.0000000`, timeZone: 'UTC' } }
          : {})
      })
    });
    return toTodoTask(listId, g);
  }

  async completeTask(listId: string, taskId: string): Promise<TodoTask> {
    const g = await this.api<GraphTask>(
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }
    );
    return toTodoTask(listId, g);
  }

  async uncompleteTask(listId: string, taskId: string): Promise<TodoTask> {
    const g = await this.api<GraphTask>(
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: JSON.stringify({ status: 'notStarted' }) }
    );
    return toTodoTask(listId, g);
  }

  async deleteTask(listId: string, taskId: string): Promise<void> {
    await this.api<void>(
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'DELETE' }
    );
  }
}
