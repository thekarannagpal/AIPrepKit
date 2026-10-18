/**
 * LLM provider interface. Every provider speaks the same two verbs:
 * plain text completion and JSON completion (which still may come back
 * malformed — the caller repairs). Providers translate rate-limit
 * responses into AppError("LLM_RATE_LIMITED") so the retry layer can
 * react uniformly.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  text: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  /** Hint for the expected JSON shape; providers use it when supported. */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  /** Human-readable model id for the README / kit metadata. */
  readonly model: string;
  complete(req: LlmRequest): Promise<string>;
}
