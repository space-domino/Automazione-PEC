import { ConflictError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { features } from "@/lib/env";
import { polishPec } from "@/services/pec";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  tone: z.string().trim().max(120).optional(),
  instructions: z.string().trim().max(1000).optional(),
});

/** Rifinisce con AI il corpo della bozza PEC. Richiede una chiave AI configurata. */
export const POST = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    if (!features.ai) throw new ConflictError("AI_DISABLED", "Nessun provider AI configurato");
    const opts = bodySchema.parse(await req.json().catch(() => ({})));
    return Response.json(await polishPec(params.id, opts, { userId: session?.user.id, requestId }));
  },
  {
    auth: "admin",
    rateLimit: { key: () => "pec.polish", limit: 20, windowSec: 60 },
  },
);
