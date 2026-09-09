import { handler } from "@/lib/api/handler";
import { blockDomain } from "@/services/purchase";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(1).max(500) })
      .parse(await req.json().catch(() => ({})));
    return Response.json(
      await blockDomain(params.id, reason, { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
