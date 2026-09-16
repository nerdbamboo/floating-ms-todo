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
export interface StoreSchema {
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

export function createStore(): SimpleStore {
  const dir = app.getPath('userData');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'store.json');
  let data: StoreSchema = defaults();
  try {
    const raw = readFileSync(file, 'utf-8');
    data = { ...defaults(), ...(JSON.parse(raw) as Partial<StoreSchema>) };
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
      data[key] = value;
      save();
    }
  };
}
