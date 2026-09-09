import { handler } from "@/lib/api/handler";
import { reviveOffer } from "@/services/offers";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, session, requestId }) =>
    Response.json(await reviveOffer(params.id, { userId: session?.user.id, requestId })),
  { auth: "admin" },
);
