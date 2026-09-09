import { handler } from "@/lib/api/handler";
import { completeTransfer } from "@/services/transfer";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const { notes } = z
      .object({ notes: z.string().trim().max(2000).optional() })
      .parse(await req.json().catch(() => ({})));
    return Response.json(
      await completeTransfer(params.id, { notes }, { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
