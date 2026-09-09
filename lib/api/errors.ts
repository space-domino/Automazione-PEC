import { logger as defaultLogger } from "@/lib/logger";
import { ZodError } from "zod";

/**
 * Envelope d'errore uniforme (sezione F.4):
 *   { "error": { "code", "message", "details?", "requestId" } }
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ValidationError extends ApiError {
  constructor(details?: unknown, message = "Dati non validi") {
    super(400, "VALIDATION", message, details);
  }
}
export class UnauthorizedError extends ApiError {
  constructor(message = "Autenticazione richiesta") {
    super(401, "UNAUTHORIZED", message);
  }
}
export class ForbiddenError extends ApiError {
  constructor(message = "Permesso negato") {
    super(403, "FORBIDDEN", message);
  }
}
export class NotFoundError extends ApiError {
  constructor(message = "Risorsa non trovata") {
    super(404, "NOT_FOUND", message);
  }
}
export class ConflictError extends ApiError {
  constructor(code = "CONFLICT", message = "Conflitto di stato", details?: unknown) {
    super(409, code, message, details);
  }
}
export class RateLimitError extends ApiError {
  constructor(public retryAfter = 60) {
    super(429, "RATE_LIMITED", "Troppe richieste");
  }
}

export function toErrorResponse(
  err: unknown,
  requestId: string,
  log: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void } = defaultLogger,
): Response {
  if (err instanceof ApiError) {
    if (err.status >= 500) log.error({ err }, err.message);
    else log.warn({ code: err.code, status: err.status }, err.message);

    const headers = new Headers({ "x-request-id": requestId });
    if (err instanceof RateLimitError) headers.set("Retry-After", String(err.retryAfter));

    return Response.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? undefined,
          requestId,
        },
      },
      { status: err.status, headers },
    );
  }

  if (err instanceof ZodError) {
    log.warn({ issues: err.issues }, "validation error");
    return Response.json(
      { error: { code: "VALIDATION", message: "Dati non validi", details: err.issues, requestId } },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  log.error({ err }, "unhandled error");
  return Response.json(
    { error: { code: "INTERNAL", message: "Errore interno", requestId } },
    { status: 500, headers: { "x-request-id": requestId } },
  );
}
