import { env } from "@/lib/env";

/**
 * CORS per l'API pubblica del catalogo (sezione F / M7).
 * Origini ammesse: `PUBLIC_CORS_ORIGINS` (CSV). Nessun wildcard.
 * L'origine viene riflessa solo se in whitelist; `Vary: Origin` sempre.
 */

const ALLOWED = new Set(
  env.PUBLIC_CORS_ORIGINS.split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

export function corsHeaders(req: Request): Headers {
  const h = new Headers({ Vary: "Origin" });
  const origin = req.headers.get("origin")?.replace(/\/+$/, "");
  if (origin && ALLOWED.has(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type");
    h.set("Access-Control-Max-Age", "600");
  }
  return h;
}

/** Applica gli header CORS a una Response esistente. */
export function withCors(res: Response, req: Request): Response {
  for (const [k, v] of corsHeaders(req)) res.headers.set(k, v);
  return res;
}

/** Risposta alla preflight OPTIONS. */
export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
