import { handler } from "@/lib/api/handler";
import { discardDomain } from "@/services/purchase";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const { reason } = z
      .object({ reason: z.string().trim().max(500).optional() })
      .parse(await req.json().catch(() => ({})));
    return Response.json(
      await discardDomain(params.id, reason ?? "", { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
