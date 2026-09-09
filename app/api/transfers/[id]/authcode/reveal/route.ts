import { handler } from "@/lib/api/handler";
import { revealAuthCode } from "@/services/transfer";

export const runtime = "nodejs";

/** Restituisce l'authcode in chiaro. Accesso sensibile: scrive un AuditLog. */
export const POST = handler<{ id: string }>(
  async ({ params, session, requestId }) =>
    Response.json(await revealAuthCode(params.id, { userId: session?.user.id, requestId })),
  {
    auth: "admin",
    rateLimit: { key: () => "transfer.authcode.reveal", limit: 30, windowSec: 60 },
  },
);
