import { InvalidTransitionError } from "./errors";

export { writeAudit } from "./audit";
export type { AuditArgs } from "./audit";
export { COMMUNICATION_TRANSITIONS, communicationStateConfig } from "./communication";
export { DOMAIN_TRANSITIONS, domainStateConfig, loadDomain } from "./domain";
export { forceTransition, transition } from "./engine";
export type { EntityStateConfig, TransitionCtx, TransitionResult } from "./engine";
export { GuardFailedError, InvalidTransitionError } from "./errors";
export { OFFER_TRANSITIONS, offerStateConfig } from "./offer";
export { ORDER_TRANSITIONS, orderStateConfig } from "./order";

/** Verifica una transizione contro una mappa; lancia InvalidTransitionError se non ammessa. */
export function assertTransition<S extends string>(
  map: Readonly<Record<S, readonly S[]>>,
  entityType: string,
  from: S,
  to: S,
): void {
  if (from === to) return;
  if (!map[from]?.includes(to)) {
    throw new InvalidTransitionError(`${entityType} ${from} -> ${to} non ammessa`, { from, to });
  }
}
