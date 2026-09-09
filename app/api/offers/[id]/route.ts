import { handler } from "@/lib/api/handler";
import { getOffer, updateOfferContent, updateOfferSchema } from "@/services/offers";

export const runtime = "nodejs";

export const GET = handler<{ id: string }>(
  async ({ params }) => Response.json(await getOffer(params.id)),
  { auth: "admin" },
);

export const PATCH = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const patch = updateOfferSchema.parse(await req.json().catch(() => ({})));
    return Response.json(
      await updateOfferContent(params.id, patch, { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
