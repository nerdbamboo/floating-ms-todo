import type { TodoBackend } from '../core/todo-types.js';
import { MemoryBackend } from './MemoryBackend.js';
import { MsTodoBackend } from './MsTodoBackend.js';

/**
 * backends/BackendFactory.ts
 * --------------------------
 * TODO_BACKEND env 하나로 백엔드 교체.
 * 테스트/LLM 개발 중엔 memory, 실사용은 mstodo.
 */
export type BackendKind = 'memory' | 'mstodo';

let singleton: TodoBackend | null = null;

export function createBackend(kind?: string): TodoBackend {
  const k = (kind ?? process.env.TODO_BACKEND ?? 'memory').toLowerCase() as BackendKind;
  if (k === 'mstodo') return new MsTodoBackend();
  return new MemoryBackend();
}

/** Electron main / MCP server에서 공유할 싱글톤 */
export function getBackend(): TodoBackend {
  if (!singleton) singleton = createBackend();
  return singleton;
}

export function setBackend(b: TodoBackend): void {
  singleton = b;
}
