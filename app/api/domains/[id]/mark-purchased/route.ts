import { handler } from "@/lib/api/handler";
import { markAsPurchased, markPurchasedSchema } from "@/services/purchase";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const body = markPurchasedSchema.parse(await req.json().catch(() => ({})));
    const result = await markAsPurchased(params.id, body, {
      userId: session?.user.id,
      requestId,
    });
    return Response.json(result);
  },
  { auth: "admin" },
);
