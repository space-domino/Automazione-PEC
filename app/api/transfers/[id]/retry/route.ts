import { handler } from "@/lib/api/handler";
import { retryTransfer } from "@/services/transfer";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, session, requestId }) =>
    Response.json(await retryTransfer(params.id, { userId: session?.user.id, requestId })),
  { auth: "admin" },
);
