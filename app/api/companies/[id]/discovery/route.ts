import { ConflictError, NotFoundError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { db } from "@/lib/db";
import { features } from "@/lib/env";
import { enqueueDiscoveryForCompanies } from "@/services/domain-discovery";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params }) => {
    if (!features.ai) {
      throw new ConflictError(
        "AI_NOT_CONFIGURED",
        "Nessuna API key AI in .env (ANTHROPIC_API_KEY)",
      );
    }
    const company = await db.company.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!company) throw new NotFoundError("Azienda non trovata");

    await enqueueDiscoveryForCompanies([params.id], { force: true });
    return Response.json({ ok: true, queued: 1 }, { status: 202 });
  },
  { auth: "admin" },
);
