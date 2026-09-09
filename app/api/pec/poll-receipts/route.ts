import { handler } from "@/lib/api/handler";
import { pollReceipts } from "@/services/pec";

export const runtime = "nodejs";

/** Trigger manuale del poll IMAP delle ricevute PEC (il worker lo esegue ogni 5 min). */
export const POST = handler(
  async ({ requestId }) => Response.json(await pollReceipts({ requestId })),
  {
    auth: "admin",
    rateLimit: { key: () => "pec.poll", limit: 10, windowSec: 60 },
  },
);
