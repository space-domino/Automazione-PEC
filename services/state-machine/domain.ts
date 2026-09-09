import { db } from "@/lib/db";
import type { Domain, DomainStatus, Prisma } from "@prisma/client";
import type { EntityStateConfig, TransitionCtx } from "./engine";
import { GuardFailedError } from "./errors";

/** Macchina a stati del Domain (sezione E.2). */
export const DOMAIN_TRANSITIONS: Readonly<Record<DomainStatus, readonly DomainStatus[]>> = {
  DISCOVERED: ["AVAILABLE", "REGISTERED", "DISCARDED", "BLOCKED"],
  AVAILABLE: ["PURCHASE_PENDING", "PURCHASED", "REGISTERED", "DISCARDED", "BLOCKED"],
  REGISTERED: ["AVAILABLE", "DISCARDED", "BLOCKED"],
  PURCHASE_PENDING: ["PURCHASED", "AVAILABLE", "BLOCKED"],
  PURCHASED: ["OFFER_DRAFT", "DISCARDED", "BLOCKED"],
  OFFER_DRAFT: ["OFFER_PUBLISHED", "PURCHASED", "BLOCKED"],
  OFFER_PUBLISHED: ["PEC_DRAFT", "CHECKOUT_STARTED", "OFFER_DRAFT", "BLOCKED"],
  PEC_DRAFT: ["PEC_APPROVED", "OFFER_PUBLISHED", "BLOCKED"],
  PEC_APPROVED: ["PEC_SENT", "OFFER_PUBLISHED", "BLOCKED"],
  PEC_SENT: ["CUSTOMER_INTERESTED", "CHECKOUT_STARTED", "OFFER_PUBLISHED", "BLOCKED"],
  CUSTOMER_INTERESTED: ["CHECKOUT_STARTED", "PEC_SENT", "OFFER_PUBLISHED", "BLOCKED"],
  CHECKOUT_STARTED: ["PAID", "OFFER_PUBLISHED", "BLOCKED"],
  PAID: ["SOLD", "REFUNDED"],
  SOLD: ["TRANSFER_PENDING", "REFUNDED"],
  TRANSFER_PENDING: ["TRANSFERRED", "TRANSFER_FAILED"],
  TRANSFERRED: [],
  TRANSFER_FAILED: ["TRANSFER_PENDING", "REFUNDED"],
  REFUNDED: ["OFFER_DRAFT"],
  DISCARDED: ["DISCOVERED"],
  BLOCKED: ["AVAILABLE", "DISCOVERED", "DISCARDED"],
};

/** Stati "finanziari": solo trigger reale, mai override manuale (E.8). */
const DOMAIN_PROTECTED: readonly DomainStatus[] = [
  "PAID",
  "SOLD",
  "TRANSFER_PENDING",
  "TRANSFERRED",
  "TRANSFER_FAILED",
  "REFUNDED",
];

function requireAvailable(d: Domain, ctx: TransitionCtx): void {
  if (ctx.metadata?.override === true) return;
  if (d.availabilityResult !== "AVAILABLE") {
    throw new GuardFailedError(
      `Disponibilità = ${d.availabilityResult}: verifica che sia AVAILABLE prima di acquistare (oppure usa l'override)`,
    );
  }
}

export const domainStateConfig: EntityStateConfig<Domain, DomainStatus> = {
  entityType: "Domain",
  transitions: DOMAIN_TRANSITIONS,
  protectedStates: DOMAIN_PROTECTED,
  guards: {
    PURCHASE_PENDING: (d, _tx, ctx) => requireAvailable(d, ctx),
    PURCHASED: (d, _tx, ctx) => {
      // se si passa direttamente da AVAILABLE serve la disponibilità confermata
      if (d.status === "AVAILABLE") requireAvailable(d, ctx);
    },
    OFFER_DRAFT: (d) => {
      if (d.sellingPrice == null) {
        throw new GuardFailedError("Imposta il prezzo di vendita prima di creare l'offerta");
      }
    },
  },
  load: (tx, id) => tx.domain.findUnique({ where: { id } }),
  apply: async (tx, id, to, extra) => {
    await tx.domain.update({
      where: { id },
      data: { status: to, ...((extra ?? {}) as Prisma.DomainUpdateInput) },
    });
  },
};

/** Helper: `db` diretto, senza transazione (per query di supporto). */
export function loadDomain(id: string) {
  return db.domain.findUnique({ where: { id } });
}
