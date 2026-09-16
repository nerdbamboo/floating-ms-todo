import type { LlmProvider } from '../core/llm-types.js';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import { MockProvider } from './MockProvider.js';

/**
 * llm/factory.ts — LLM_PROVIDER 하나로 교체
 *   mock (기본) | openai | ollama | azure | compatible
 * ollama 예: LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3.1
 */
export function createLlmProvider(kind?: string): LlmProvider {
  const k = (kind ?? process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
  switch (k) {
    case 'openai':
    case 'azure':
    case 'ollama':
    case 'compatible':
    case 'openai-compatible':
      return new OpenAICompatibleProvider({ name: k });
    case 'mock':
    default:
      return new MockProvider();
  }
}
