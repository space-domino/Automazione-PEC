import { handler } from "@/lib/api/handler";
import { getDomainDetail } from "@/services/catalog/domains";
import { updateDomainPricing } from "@/services/purchase";
import { z } from "zod";

export const runtime = "nodejs";

export const GET = handler<{ id: string }>(
  async ({ params }) => {
    const res = await getDomainDetail(params.id);
    if (!res)
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Dominio non trovato" } },
        { status: 404 },
      );
    return Response.json(res);
  },
  { auth: "admin" },
);

const patchSchema = z
  .object({
    sellingPrice: z.coerce.number().nonnegative().max(1_000_000).optional(),
    purchaseNotes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.sellingPrice != null || v.purchaseNotes != null, "Nessun campo da aggiornare");

export const PATCH = handler<{ id: string }>(
  async ({ params, req, session, requestId }) => {
    const patch = patchSchema.parse(await req.json().catch(() => ({})));
    return Response.json(
      await updateDomainPricing(params.id, patch, { userId: session?.user.id, requestId }),
    );
  },
  { auth: "admin" },
);
