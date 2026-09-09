import { handler } from "@/lib/api/handler";
import { failTransfer } from "@/services/transfer";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(1).max(2000) })
      .parse(await req.json().catch(() => ({})));
    return Response.json(
      await failTransfer(params.id, reason, { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
