import { handler } from "@/lib/api/handler";
import { approvePec } from "@/services/pec";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, session, requestId }) =>
    Response.json(await approvePec(params.id, { userId: session?.user.id, requestId })),
  { auth: "admin" },
);
