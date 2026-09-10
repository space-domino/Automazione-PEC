import { handler } from "@/lib/api/handler";
import { queuePecSend, sendApprovedPec } from "@/services/pec";

export const runtime = "nodejs";

/**
 * Invia la PEC approvata. Default: accoda il job `pec.send` (l'SMTP lo fa il
 * worker). `?sync=1` invia in linea nel processo corrente: da usare SOLO da CLI
 * / test — la UI non lo usa, così il web non dipende dai segreti SMTP.
 */
export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const actor = { userId: session?.user.id, requestId };
    const sync = new URL(req.url).searchParams.get("sync");
    if (sync === "1" || sync === "true") {
      return Response.json(await sendApprovedPec(params.id, actor));
    }
    return Response.json(await queuePecSend(params.id, actor), { status: 202 });
  },
  {
    auth: "admin",
    rateLimit: { key: () => "pec.send.api", limit: 30, windowSec: 60 },
  },
);
