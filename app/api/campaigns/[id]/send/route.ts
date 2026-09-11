import { handler } from "@/lib/api/handler";
import { startCampaignSend } from "@/services/campaigns";

export const runtime = "nodejs";

/** Avvia l'invio: accoda l'elaborazione sul worker, righe non presidiate una a una. */
export const POST = handler<{ id: string }>(
  async ({ params, session }) =>
    Response.json(await startCampaignSend(params.id, { userId: session?.user.id })),
  { auth: "admin", rateLimit: { key: () => "campaigns.send", limit: 10, windowSec: 60 } },
);
