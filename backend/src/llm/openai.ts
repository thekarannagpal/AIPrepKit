import { AppError } from "../lib/errors";
import { translateHttpError } from "./gemini";
import type { LlmProvider, LlmRequest } from "./provider";

/**
 * Any OpenAI-compatible chat-completions endpoint: Groq (free tier),
 * OpenRouter, Together, or a local Ollama/LM Studio server. Kept so the
 * assessment never depends on a single provider's free tier surviving.
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly name = "openai";

  constructor(
    private apiKey: string,
    private baseUrl: string,
    readonly model: string
  ) {}

  async complete(req: LlmRequest): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxOutputTokens ?? 4096,
        ...(req.json ? { response_format: { type: "json_object" } } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.text })),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw translateHttpError(res.status, await res.text().catch(() => ""), res.headers.get("retry-after"));
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text.trim()) {
      throw new AppError(
        "LLM_INVALID_RESPONSE",
        `Model returned no text (finish_reason: ${choice?.finish_reason ?? "unknown"}).`,
        502
      );
    }
    return text;
  }
}
