import { handler } from "@/lib/api/handler";
import { setTransferAuthCode } from "@/services/transfer";
import { z } from "zod";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const { authCode } = z
      .object({ authCode: z.string().trim().min(1).max(200) })
      .parse(await req.json().catch(() => ({})));
    return Response.json(
      await setTransferAuthCode(params.id, authCode, { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
