import { handler } from "@/lib/api/handler";
import { startTransfer, startTransferSchema } from "@/services/transfer";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const input = startTransferSchema.parse(await req.json().catch(() => ({})));
    return Response.json(
      await startTransfer(params.id, input, { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
