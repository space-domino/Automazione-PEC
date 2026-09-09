import { preflight, withCors } from "@/lib/api/cors";
import { NotFoundError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { getPublicOfferBySlug } from "@/services/catalog/public";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anon"
  );
}

export const GET = handler<{ slug: string }>(
  async ({ params, req }) => {
    const offer = await getPublicOfferBySlug(params.slug);
    if (!offer) throw new NotFoundError("Offerta non trovata");
    const res = Response.json(offer, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=120" },
    });
    return withCors(res, req);
  },
  {
    auth: "public",
    rateLimit: {
      key: (req) => `public.offer:${clientIp(req as NextRequest)}`,
      limit: 240,
      windowSec: 60,
    },
  },
);

export function OPTIONS(req: Request): Response {
  return preflight(req);
}
