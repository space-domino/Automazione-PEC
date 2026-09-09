import { handler } from "@/lib/api/handler";
import { UNBLOCK_TARGETS, unblockDomain } from "@/services/purchase";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  toStatus: z.enum(UNBLOCK_TARGETS).default("DISCOVERED"),
  reason: z.string().trim().max(500).optional(),
});

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const { toStatus, reason } = bodySchema.parse(await req.json().catch(() => ({})));
    return Response.json(
      await unblockDomain(params.id, toStatus, reason ?? "", {
        userId: session?.user.id,
        requestId,
      }),
    );
  },
  { auth: "admin" },
);
