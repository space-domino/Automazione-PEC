import { auth } from "@/lib/auth";
import { childLogger } from "@/lib/logger";
import type { Session } from "next-auth";
import type { NextRequest } from "next/server";
import { ForbiddenError, RateLimitError, UnauthorizedError, toErrorResponse } from "./errors";
import { rateLimit } from "./rate-limit";

type AuthMode = "public" | "required" | "admin";

export interface HandlerCtx<P extends Record<string, string> = Record<string, string>> {
  req: NextRequest;
  params: P;
  requestId: string;
  session: Session | null;
  log: ReturnType<typeof childLogger>;
}

interface HandlerOpts {
  /** default: "required" */
  auth?: AuthMode;
  rateLimit?: {
    key: (req: NextRequest) => string;
    limit: number;
    windowSec: number;
  };
}

type HandlerFn<P extends Record<string, string>> = (
  ctx: HandlerCtx<P>,
) => Promise<Response | unknown> | Response | unknown;

/**
 * Wrapper unico delle route (sezione F.1): requestId, rate-limit, auth,
 * envelope d'errore, logging. Gli handler restano sottili.
 *
 *   export const POST = handler(async ({ req, session, log }) => { ... }, { auth: "admin" });
 *   export const GET  = handler<{ id: string }>(async ({ params }) => { ... });
 */
export function handler<P extends Record<string, string> = Record<string, string>>(
  fn: HandlerFn<P>,
  opts: HandlerOpts = {},
) {
  // La firma del secondo argomento deve combaciare ESATTAMENTE con RouteContext di Next 15
  // (niente `?` opzionali), altrimenti `next build` fallisce il type-check delle route.
  return async (req: NextRequest, segment: { params: Promise<P> }): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { pathname } = new URL(req.url);
    const log = childLogger({ requestId, method: req.method, path: pathname });
    const startedAt = Date.now();

    try {
      if (opts.rateLimit) {
        const { key, limit, windowSec } = opts.rateLimit;
        const rl = await rateLimit(key(req), limit, windowSec);
        if (!rl.ok) throw new RateLimitError(rl.retryAfter);
      }

      const mode: AuthMode = opts.auth ?? "required";
      let session: Session | null = null;
      if (mode !== "public") {
        session = await auth();
        if (!session?.user) throw new UnauthorizedError();
        if (mode === "admin" && session.user.role !== "ADMIN") throw new ForbiddenError();
      }

      const params = (await segment?.params) ?? ({} as P);
      const out = await fn({ req, params, requestId, session, log });

      const res = out instanceof Response ? out : Response.json(out ?? { ok: true });
      res.headers.set("x-request-id", requestId);
      log.info({ status: res.status, ms: Date.now() - startedAt }, "request");
      return res;
    } catch (err) {
      return toErrorResponse(err, requestId, log);
    }
  };
}
