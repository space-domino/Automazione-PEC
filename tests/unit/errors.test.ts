import {
  ConflictError,
  RateLimitError,
  UnauthorizedError,
  toErrorResponse,
} from "@/lib/api/errors";
import { describe, expect, it } from "vitest";

const noopLog = { warn: () => {}, error: () => {} };

describe("lib/api/errors", () => {
  it("UnauthorizedError -> 401 con envelope e requestId", async () => {
    const res = toErrorResponse(new UnauthorizedError(), "req_1", noopLog);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.requestId).toBe("req_1");
    expect(res.headers.get("x-request-id")).toBe("req_1");
  });

  it("ConflictError trasporta un codice custom", async () => {
    const res = toErrorResponse(
      new ConflictError("INVALID_TRANSITION", "Domain X -> Y non ammessa"),
      "req_2",
      noopLog,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_TRANSITION");
  });

  it("RateLimitError -> 429 con header Retry-After", async () => {
    const res = toErrorResponse(new RateLimitError(42), "req_3", noopLog);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("errore generico -> 500 INTERNAL senza dettagli", async () => {
    const res = toErrorResponse(new Error("boom"), "req_4", noopLog);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("boom");
  });
});
