import { handler } from "@/lib/api/handler";
import { reopenDomain } from "@/services/purchase";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params, session, requestId }) =>
    Response.json(await reopenDomain(params.id, { userId: session?.user.id, requestId })),
  { auth: "admin" },
);
