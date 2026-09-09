import { handler } from "@/lib/api/handler";
import { pauseOffer } from "@/services/offers";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const { reason } = z
      .object({ reason: z.string().trim().max(500).optional() })
      .parse(await req.json().catch(() => ({})));
    return Response.json(
      await pauseOffer(params.id, reason ?? "", { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
