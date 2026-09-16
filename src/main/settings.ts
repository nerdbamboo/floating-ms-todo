import { safeStorage } from 'electron';
import { createJsonStore, type JsonStore } from './store.js';

/**
 * main/settings.ts
 * ----------------
 * UI에서 입력한 MS/LLM 설정을 userData/settings.json에 저장.
 * LLM API 키는 safeStorage(Windows DPAPI 등 OS 키체인)로 암호화해서 보관.
 * safeStorage를 쓸 수 없는 Linux 환경이면 평문 + 경고 플래그.
 */

export interface AppSettings {
  todoBackend: 'memory' | 'mstodo';
  azureClientId: string;
  azureTenantId: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmModel: string;
}

interface PersistedSettings extends Record<string, unknown> {
  todoBackend: 'memory' | 'mstodo';
  azureClientId: string;
  azureTenantId: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmModel: string;
  /** { enc: base64 } 또는 { plain } */
  llmApiKey: { enc?: string; plain?: string };
}

function defaults(): PersistedSettings {
  const backend = (process.env.TODO_BACKEND ?? 'memory').toLowerCase();
  return {
    todoBackend: backend === 'mstodo' ? 'mstodo' : 'memory',
    azureClientId: process.env.AZURE_CLIENT_ID ?? '',
    azureTenantId: process.env.AZURE_TENANT_ID ?? 'consumers',
    llmProvider: process.env.LLM_PROVIDER ?? 'mock',
    llmBaseUrl: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
    llmModel: process.env.LLM_MODEL ?? 'llama3.1',
    llmApiKey:
      process.env.LLM_API_KEY && process.env.LLM_API_KEY !== 'ollama'
        ? { plain: process.env.LLM_API_KEY }
        : {}
  };
}

let store: JsonStore<PersistedSettings> | null = null;

export function getSettingsStore(): JsonStore<PersistedSettings> {
  if (!store) store = createJsonStore<PersistedSettings>('settings.json', defaults);
  return store;
}

function encrypt(key: string): { enc?: string; plain?: string } {
  if (!key) return {};
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return { enc: safeStorage.encryptString(key).toString('base64') };
    }
  } catch {
    /* fall through to plain + flag */
  }
  return { plain: key };
}

export function decryptKey(stored: { enc?: string; plain?: string }): string {
  if (stored.enc) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'));
    } catch {
      return '';
    }
  }
  return stored.plain ?? '';
}

export function keyProtection(): 'os-keychain' | 'plain' | 'none' {
  const s = getSettingsStore().getAll();
  if (s.llmApiKey.enc) return 'os-keychain';
  if (s.llmApiKey.plain) {
    try {
      if (safeStorage.isEncryptionAvailable()) return 'plain';
    } catch {
      /* ignore */
    }
    return 'plain';
  }
  return 'none';
}

/** renderer에 내려주는 DTO — 키 본문은 절대 포함하지 않음 */
export interface SettingsDTO extends AppSettings {
  hasLlmKey: boolean;
  keyProtection: 'os-keychain' | 'plain' | 'none';
}

export function getSettingsDTO(): SettingsDTO {
  const s = getSettingsStore().getAll();
  return {
    todoBackend: s.todoBackend,
    azureClientId: s.azureClientId,
    azureTenantId: s.azureTenantId,
    llmProvider: s.llmProvider,
    llmBaseUrl: s.llmBaseUrl,
    llmModel: s.llmModel,
    hasLlmKey: Boolean(s.llmApiKey.enc || s.llmApiKey.plain),
    keyProtection: keyProtection()
  };
}

/** 복호화된 키 포함 전체 설정 — main 내부에서만 사용 */
export function getRuntimeSettings(): AppSettings & { llmApiKey: string } {
  const s = getSettingsStore().getAll();
  return {
    todoBackend: s.todoBackend,
    azureClientId: s.azureClientId,
    azureTenantId: s.azureTenantId,
    llmProvider: s.llmProvider,
    llmBaseUrl: s.llmBaseUrl,
    llmModel: s.llmModel,
    llmApiKey: decryptKey(s.llmApiKey)
  };
}

export interface SettingsInput {
  todoBackend?: unknown;
  azureClientId?: unknown;
  azureTenantId?: unknown;
  llmProvider?: unknown;
  llmBaseUrl?: unknown;
  llmModel?: unknown;
  /** 빈 문자열/undefined면 기존 키 유지 */
  llmApiKey?: unknown;
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  if (t.length > max) throw new Error(`값이 너무 깁니다 (max ${max})`);
  return t;
}

export function saveSettings(input: SettingsInput): SettingsDTO {
  const s = getSettingsStore();
  const backend = str(input.todoBackend, 16)?.toLowerCase();
  if (backend !== undefined) {
    if (backend !== 'memory' && backend !== 'mstodo') throw new Error('todoBackend must be memory|mstodo');
    s.set('todoBackend', backend);
  }
  const cid = str(input.azureClientId, 64);
  if (cid !== undefined) s.set('azureClientId', cid);
  const tenant = str(input.azureTenantId, 32);
  if (tenant !== undefined) s.set('azureTenantId', tenant);
  const prov = str(input.llmProvider, 32)?.toLowerCase();
  if (prov !== undefined) {
    const allowed = ['mock', 'openai', 'azure', 'ollama', 'compatible', 'openai-compatible'];
    if (!allowed.includes(prov)) throw new Error(`llmProvider must be one of ${allowed.join(',')}`);
    s.set('llmProvider', prov);
  }
  const url = str(input.llmBaseUrl, 256);
  if (url !== undefined) {
    if (!/^https?:\/\/.+/.test(url)) throw new Error('llmBaseUrl must start with http(s)://');
    s.set('llmBaseUrl', url.replace(/\/+$/, ''));
  }
  const model = str(input.llmModel, 128);
  if (model !== undefined) s.set('llmModel', model);
  if (typeof input.llmApiKey === 'string' && input.llmApiKey.length > 0) {
    if (input.llmApiKey.length > 512) throw new Error('API 키가 너무 깁니다');
    s.set('llmApiKey', encrypt(input.llmApiKey.trim()));
  }
  return getSettingsDTO();
}

export function clearLlmKey(): SettingsDTO {
  getSettingsStore().set('llmApiKey', {});
  return getSettingsDTO();
}
