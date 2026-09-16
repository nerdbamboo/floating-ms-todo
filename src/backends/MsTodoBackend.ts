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

  // ---- auth ----

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
        console.log(`\n[MS 로그인] ${res.message}\n`);
      }
    }).catch((e) => {
      throw new Error(`[MsTodoBackend] 디바이스 로그인 실패: ${String(e?.message ?? e)}`);
    });
    const token = device?.accessToken;
    if (!token) throw new Error('[MsTodoBackend] 토큰 획득 실패');
    try {
      const { writeFile } = await import('node:fs/promises');
      // 토큰 캐시는 타인이 읽지 못하게 0o600 (POSIX). Windows에서는 ACL 상속.
      await writeFile(this.tokenCachePath, this.pca.getTokenCache().serialize(), { encoding: 'utf-8', mode: 0o600 });
    } catch {
      /* 캐시 저장 실패는 치명적이지 않음 */
    }
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
