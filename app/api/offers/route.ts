import { handler } from "@/lib/api/handler";
import { createOffer, createOfferSchema, listOffers } from "@/services/offers";
import { z } from "zod";

export const runtime = "nodejs";

export const GET = handler(
  async ({ req }) => {
    const u = new URL(req.url);
    return Response.json(
      await listOffers({
        status: u.searchParams.get("status") ?? undefined,
        q: u.searchParams.get("q") ?? undefined,
        page: Number.parseInt(u.searchParams.get("page") ?? "1", 10) || 1,
        pageSize: Number.parseInt(u.searchParams.get("pageSize") ?? "50", 10) || 50,
      }),
    );
  },
  { auth: "admin" },
);

const createBodySchema = createOfferSchema.extend({ domainId: z.string().min(1) });

export const POST = handler(
  async ({ req, session, requestId }) => {
    const { domainId, ...input } = createBodySchema.parse(await req.json().catch(() => ({})));
    return Response.json(
      await createOffer(domainId, input, { userId: session?.user.id, requestId }),
      { status: 201 },
    );
  },
  { auth: "admin" },
);
