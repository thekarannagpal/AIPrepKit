/**
 * Typed application errors. Every failure the API and the batch command can
 * surface has a stable machine-readable code (Appendix B's error.code).
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_URL"
  | "COMPANY_UNREACHABLE"
  | "ROBOTS_DISALLOWED"
  | "LLM_RATE_LIMITED"
  | "LLM_INVALID_RESPONSE"
  | "LLM_UNAVAILABLE"
  | "LLM_BUDGET_EXCEEDED"
  | "JD_EMPTY"
  | "INPUT_INVALID"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError("VALIDATION", message, 400, details);
export const unauthenticated = (message = "Sign in to continue.") =>
  new AppError("UNAUTHENTICATED", message, 401);
export const forbidden = (message = "Not yours.") => new AppError("FORBIDDEN", message, 403);
export const notFound = (message = "Not found.") => new AppError("NOT_FOUND", message, 404);
export const conflict = (message: string) => new AppError("CONFLICT", message, 409);
export const internal = (message = "Internal error.") => new AppError("INTERNAL", message, 500);
