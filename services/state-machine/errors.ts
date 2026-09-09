import { ApiError } from "@/lib/api/errors";

/** Transizione non presente nella mappa degli stati ammessi. */
export class InvalidTransitionError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(409, "INVALID_TRANSITION", message, details);
    this.name = "InvalidTransitionError";
  }
}

/** Transizione ammessa dalla mappa ma un'invariante (guardia) non è soddisfatta. */
export class GuardFailedError extends ApiError {
  constructor(message: string) {
    super(409, "GUARD_FAILED", message);
    this.name = "GuardFailedError";
  }
}
