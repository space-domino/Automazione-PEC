import { ValidationError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { db } from "@/lib/db";
import { enqueueAvailabilityForDomains } from "@/services/availability";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  domainIds: z.array(z.string().min(1)).min(1).max(5000).optional(),
  /** verifica tutti i domini non ancora conclusi (DISCOVERED o UNKNOWN/ERROR) */
  pending: z.boolean().optional(),
  force: z.boolean().optional(),
});

export const POST = handler(
  async ({ req }) => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    let ids = parsed.data.domainIds ?? [];
    if (parsed.data.pending) {
      const rows = await db.domain.findMany({
        where: {
          deletedAt: null,
          isBlocked: false,
          OR: [{ status: "DISCOVERED" }, { availabilityResult: { in: ["UNKNOWN", "ERROR"] } }],
        },
        select: { id: true },
        take: 5000,
      });
      ids = [...new Set([...ids, ...rows.map((r) => r.id)])];
    }
    if (ids.length === 0) throw new ValidationError(undefined, "Nessun dominio da verificare");

    const queued = await enqueueAvailabilityForDomains(ids, { force: parsed.data.force });
    return Response.json({ ok: true, queued }, { status: 202 });
  },
  {
    auth: "admin",
    rateLimit: { key: () => "availability.bulk", limit: 10, windowSec: 60 },
  },
);
