import { handler } from "@/lib/api/handler";
import { createCampaign, listCampaigns } from "@/services/campaigns";
import { z } from "zod";

export const runtime = "nodejs";

export const GET = handler(async () => Response.json(await listCampaigns()), { auth: "admin" });

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  companiesText: z.string().min(1).max(500_000),
  templateName: z.string().trim().min(1).max(80),
  promoPrice: z.coerce.number().positive().optional(),
});

/** Incolla/carica la lista, abbina al catalogo spacedomino, crea la campagna in MATCHED. */
export const POST = handler(
  async ({ req, session }) => {
    const input = createSchema.parse(await req.json().catch(() => ({})));
    return Response.json(await createCampaign(input, { userId: session?.user.id }), {
      status: 201,
    });
  },
  { auth: "admin", rateLimit: { key: () => "campaigns.create", limit: 10, windowSec: 60 } },
);
