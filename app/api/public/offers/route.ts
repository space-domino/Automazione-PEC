import { preflight, withCors } from "@/lib/api/cors";
import { handler } from "@/lib/api/handler";
import { listPublicOffers } from "@/services/catalog/public";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anon"
  );
}

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export const GET = handler(
  async ({ req }) => {
    const u = new URL(req.url);
    const result = await listPublicOffers({
      q: u.searchParams.get("q") ?? undefined,
      extension: u.searchParams.get("extension") ?? undefined,
      minPrice: num(u.searchParams.get("minPrice")),
      maxPrice: num(u.searchParams.get("maxPrice")),
      page: Number.parseInt(u.searchParams.get("page") ?? "1", 10) || 1,
      pageSize: Number.parseInt(u.searchParams.get("pageSize") ?? "24", 10) || 24,
    });
    const res = Response.json(result, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=120" },
    });
    return withCors(res, req);
  },
  {
    auth: "public",
    rateLimit: {
      key: (req) => `public.offers:${clientIp(req as NextRequest)}`,
      limit: 120,
      windowSec: 60,
    },
  },
);

export function OPTIONS(req: Request): Response {
  return preflight(req);
}
