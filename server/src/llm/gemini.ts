import { AppError } from "../lib/errors";
import type { LlmProvider, LlmRequest } from "./provider";

/**
 * Google AI Studio (Gemini) REST API — chosen as the default provider for its
 * genuine free tier (15 req/min, 1M tokens/day on gemini-2.0-flash) and its
 * native JSON response mode, which materially reduces malformed output.
 * Uses plain fetch — no SDK dependency, full control over error handling.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";

  constructor(
    private apiKey: string,
    readonly model: string = "gemini-2.0-flash"
  ) {
    if (!apiKey) throw new AppError("LLM_UNAVAILABLE", "GEMINI_API_KEY is not set.", 500);
  }

  async complete(req: LlmRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const systemMessages = req.messages.filter((m) => m.role === "system");
    const conversation = req.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      contents: conversation.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })),
      generationConfig: {
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxOutputTokens ?? 4096,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (systemMessages.length) {
      body.systemInstruction = { parts: [{ text: systemMessages.map((m) => m.text).join("\n\n") }] };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw translateHttpError(res.status, await safeText(res), res.headers.get("retry-after"));
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };

    const block = data.promptFeedback?.blockReason;
    if (block) {
      throw new AppError("LLM_INVALID_RESPONSE", `Gemini blocked the prompt (${block}).`, 502);
    }
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      const reason = candidate?.finishReason ?? "no candidates";
      throw new AppError(
        "LLM_INVALID_RESPONSE",
        `Gemini returned no text (finishReason: ${reason}).`,
        502
      );
    }
    return text;
  }
}

export function translateHttpError(status: number, body: string, retryAfter: string | null): AppError {
  const snippet = body.slice(0, 300);
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  if (status === 429) {
    return new AppError("LLM_RATE_LIMITED", `Provider rate limited (429). ${snippet}`, 429, {
      retryAfterMs,
    });
  }
  if (status >= 500) {
    return new AppError("LLM_UNAVAILABLE", `Provider error (${status}). ${snippet}`, 502, {
      retryAfterMs,
    });
  }
  return new AppError("LLM_INVALID_RESPONSE", `Provider rejected the request (${status}). ${snippet}`, 502);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
