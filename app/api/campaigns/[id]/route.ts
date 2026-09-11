import { handler } from "@/lib/api/handler";
import { getCampaign } from "@/services/campaigns";

export const runtime = "nodejs";

/** Stato + righe della campagna. Usato anche per il polling durante l'invio. */
export const GET = handler<{ id: string }>(
  async ({ params }) => {
    const c = await getCampaign(params.id);
    return c ? Response.json(c) : new Response("not found", { status: 404 });
  },
  { auth: "admin" },
);
