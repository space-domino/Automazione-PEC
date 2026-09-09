import { ValidationError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { DOMAIN_TRANSITIONS, domainStateConfig, forceTransition } from "@/services/state-machine";
import type { DomainStatus } from "@prisma/client";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  entityType: z.enum(["Domain"]),
  entityId: z.string().min(1),
  toStatus: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const POST = handler(
  async ({ req, session, requestId }) => {
    const { entityType, entityId, toStatus, reason } = bodySchema.parse(
      await req.json().catch(() => ({})),
    );

    if (entityType === "Domain") {
      if (!(toStatus in DOMAIN_TRANSITIONS)) {
        throw new ValidationError(undefined, `Stato "${toStatus}" non valido per Domain`);
      }
      const result = await forceTransition(domainStateConfig, entityId, toStatus as DomainStatus, {
        actorType: "USER",
        actorUserId: session?.user.id,
        requestId,
        reason,
      });
      return Response.json(result);
    }

    throw new ValidationError(undefined, `Override non supportato per ${entityType}`);
  },
  { auth: "admin" },
);
