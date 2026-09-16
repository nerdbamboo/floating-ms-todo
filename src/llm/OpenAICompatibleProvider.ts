import OpenAI from 'openai';
import type { LlmMessage, LlmProvider, LlmResponse, LlmChatOptions } from '../core/llm-types.js';

/**
 * llm/OpenAICompatibleProvider.ts
 * -------------------------------
 * OpenAI Chat Completions + Function Calling 스펙을 그대로 사용.
 * → OpenAI, Azure OpenAI, Ollama, vLLM, LM Studio, Gemini(OpenAI 호환), Groq 등 전부 호환.
 *
 * env: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;
  private client: OpenAI;
  private model: string;

  constructor(opts?: { baseURL?: string; apiKey?: string; model?: string; name?: string }) {
    const baseURL = opts?.baseURL ?? process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
    const apiKey = opts?.apiKey ?? process.env.LLM_API_KEY ?? '';
    this.model = opts?.model ?? process.env.LLM_MODEL ?? 'gpt-4o-mini';
    this.name = opts?.name ?? `openai-compatible(${this.model})`;
    this.client = new OpenAI({ baseURL, apiKey });
  }

  async chat(messages: LlmMessage[], opts?: LlmChatOptions): Promise<LlmResponse> {
    const tools = (opts?.tools ?? []).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>
      }
    }));

    const res = await this.client.chat.completions.create({
      model: this.model,
      temperature: opts?.temperature ?? Number(process.env.LLM_TEMPERATURE ?? 0.2),
      max_tokens: opts?.maxTokens,
      messages: messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, tool_call_id: m.toolCallId!, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: JSON.stringify(c.arguments) }
            }))
          };
        }
        return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
      }),
      ...(tools.length ? { tools, tool_choice: opts?.toolChoice ?? 'auto' } : {})
    });

    const choice = res.choices[0];
    const toolCalls = (choice.message.tool_calls ?? [])
      .filter((t) => t.type === 'function')
      .map((t) => {
        const fn = (t as { function: { name: string; arguments: string }; id: string }).function;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fn.arguments || '{}');
        } catch {
          args = { _raw: fn.arguments };
        }
        return { id: t.id, name: fn.name, arguments: args };
      });

    return { content: choice.message.content ?? '', toolCalls, raw: res };
  }
}
