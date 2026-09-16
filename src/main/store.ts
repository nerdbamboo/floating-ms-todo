import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * main/store.ts
 * -------------
 * electron-store 대체용 초소형 JSON 저장소 (node stdlib만 사용).
 * electron-store v10은 ESM-only라 CJS로 번들되는 main 프로세스에서
 * require() 크래시(ERR_REQUIRE_ESM)가 나기 때문에 직접 구현함.
 * 저장 위치: app.getPath('userData')/store.json (OS 표준 앱 데이터 경로)
 */
export interface StoreSchema extends Record<string, unknown> {
  opacity: number;
  alwaysOnTop: boolean;
  bounds?: Electron.Rectangle;
}

function defaults(): StoreSchema {
  const opacity = Number(process.env.FLOAT_OPACITY ?? 0.95);
  return {
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.4, opacity)) : 0.95,
    alwaysOnTop: (process.env.FLOAT_ALWAYS_ON_TOP ?? 'true') === 'true'
  };
}

export interface SimpleStore {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
}

/** settings.json 같은 다른 JSON 파일에도 재사용 가능한 제네릭 저장소 */
export interface JsonStore<T extends Record<string, unknown>> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  getAll(): T;
}

export function createJsonStore<T extends Record<string, unknown>>(
  filename: string,
  defaults: () => T
): JsonStore<T> {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, filename);
  let data: T = defaults();
  try {
    const raw = readFileSync(file, 'utf-8');
    data = { ...defaults(), ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    /* 첫 실행 또는 손상된 파일 → 기본값 */
  }

  function save(): void {
    try {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      /* 저장 실패는 치명적이지 않음 (다음 기회에 재시도) */
    }
  }

  return {
    get(key) {
      return data[key];
    },
    set(key, value) {
      (data as Record<string, unknown>)[key as string] = value;
      save();
    },
    getAll() {
      return { ...data };
    }
  };
}

export function createStore(): SimpleStore {
  return createJsonStore<StoreSchema>('store.json', defaults);
}
