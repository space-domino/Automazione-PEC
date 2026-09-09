import type { Offer, OfferStatus, Prisma } from "@prisma/client";
import type { EntityStateConfig } from "./engine";
import { GuardFailedError } from "./errors";

/** Macchina a stati dell'Offer (sezione E.3). */
export const OFFER_TRANSITIONS: Readonly<Record<OfferStatus, readonly OfferStatus[]>> = {
  DRAFT: ["PUBLISHED", "WITHDRAWN"],
  PUBLISHED: ["PAUSED", "SOLD", "WITHDRAWN", "DRAFT"],
  PAUSED: ["PUBLISHED", "WITHDRAWN"],
  SOLD: ["PUBLISHED"], // riattivazione dopo rimborso ordine
  WITHDRAWN: ["DRAFT"],
};

const OFFER_PROTECTED: readonly OfferStatus[] = ["SOLD"]; // solo ordine pagato

export const offerStateConfig: EntityStateConfig<Offer, OfferStatus> = {
  entityType: "Offer",
  transitions: OFFER_TRANSITIONS,
  protectedStates: OFFER_PROTECTED,
  guards: {
    PUBLISHED: (o) => {
      if (Number(o.price) <= 0) throw new GuardFailedError("Prezzo di vendita non valido");
      if (!o.landingPageUrl) throw new GuardFailedError("landingPageUrl mancante");
    },
  },
  load: (tx, id) => tx.offer.findUnique({ where: { id } }),
  apply: async (tx, id, to, extra) => {
    await tx.offer.update({
      where: { id },
      data: { status: to, ...((extra ?? {}) as Prisma.OfferUpdateInput) },
    });
  },
};
