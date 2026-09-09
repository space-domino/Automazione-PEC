import { ConflictError, ValidationError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { features } from "@/lib/env";
import { enqueueDiscoveryForCompanies } from "@/services/domain-discovery";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  companyIds: z.array(z.string().min(1)).min(1).max(5000),
  force: z.boolean().optional(),
});

export const POST = handler(
  async ({ req }) => {
    if (!features.ai) {
      throw new ConflictError(
        "AI_NOT_CONFIGURED",
        "Nessuna API key AI in .env (ANTHROPIC_API_KEY)",
      );
    }
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    const queued = await enqueueDiscoveryForCompanies(parsed.data.companyIds, {
      force: parsed.data.force,
    });
    return Response.json({ ok: true, queued }, { status: 202 });
  },
  {
    auth: "admin",
    rateLimit: { key: () => "discovery.bulk", limit: 10, windowSec: 60 },
  },
);
