import { handler } from "@/lib/api/handler";
import { updateCampaignRow } from "@/services/campaigns";
import { z } from "zod";

export const runtime = "nodejs";

const patchSchema = z.object({
  domain: z.string().trim().max(200).nullable().optional(),
  tld: z.string().trim().max(20).nullable().optional(),
});

/** Corregge a mano il dominio abbinato a una riga, prima dell'invio. */
export const PUT = handler<{ id: string; row: string }>(
  async ({ req, params }) => {
    const input = patchSchema.parse(await req.json().catch(() => ({})));
    const rowNumber = Number(params.row);
    return Response.json(await updateCampaignRow(params.id, rowNumber, input));
  },
  { auth: "admin" },
);
