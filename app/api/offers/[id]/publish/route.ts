import { handler } from "@/lib/api/handler";
import { publishOffer } from "@/services/offers";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, session, requestId }) =>
    Response.json(await publishOffer(params.id, { userId: session?.user.id, requestId })),
  { auth: "admin" },
);
