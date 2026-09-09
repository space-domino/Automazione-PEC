import { NotFoundError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { db } from "@/lib/db";
import { enqueueAvailabilityForDomains } from "@/services/availability";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params }) => {
    const domain = await db.domain.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!domain) throw new NotFoundError("Dominio non trovato");
    await enqueueAvailabilityForDomains([params.id], { force: true });
    return Response.json({ ok: true, queued: 1 }, { status: 202 });
  },
  { auth: "admin" },
);
