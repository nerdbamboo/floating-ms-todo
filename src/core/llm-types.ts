/**
 * core/llm-types.ts
 * -----------------
 * LLM 공급자를 갈아끼우기 위한 최소 추상화.
 * OpenAI 호환 API(chat completions + tools) 하나만 구현하면
 * OpenAI / Azure OpenAI / Ollama / vLLM / LM Studio / Gemini(OpenAI 호환) 전부 동작합니다.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema (OpenAI function calling 형식) */
  parameters: Record<string, unknown>;
}

export interface LlmChatOptions {
  tools?: LlmTool[];
  /** 'auto' | 'none' | { name } — 간단화를 위해 string만 지원 */
  toolChoice?: 'auto' | 'none';
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResponse {
  content: string;
  toolCalls: LlmToolCall[];
  raw?: unknown;
}

export interface LlmProvider {
  readonly name: string;
  chat(messages: LlmMessage[], opts?: LlmChatOptions): Promise<LlmResponse>;
}
