import { db } from "@/lib/db";
import type { ActorType, Prisma } from "@prisma/client";
import { writeAudit } from "./audit";
import { InvalidTransitionError } from "./errors";

export type Tx = Prisma.TransactionClient;

export interface TransitionCtx {
  actorType?: ActorType;
  actorUserId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

export interface EntityStateConfig<
  Row extends { status: S; deletedAt?: Date | null },
  S extends string,
> {
  entityType: string;
  transitions: Readonly<Record<S, readonly S[]>>;
  guards?: Partial<Record<S, (row: Row, tx: Tx, ctx: TransitionCtx) => void | Promise<void>>>;
  /** stati raggiungibili solo dal trigger reale, MAI da forceTransition */
  protectedStates?: readonly S[];
  load: (tx: Tx, id: string) => Promise<Row | null>;
  apply: (tx: Tx, id: string, to: S, extra?: Record<string, unknown>) => Promise<void>;
}

export interface TransitionResult<S extends string> {
  from: S;
  to: S;
  changed: boolean;
}

async function runTransition<Row extends { status: S; deletedAt?: Date | null }, S extends string>(
  cfg: EntityStateConfig<Row, S>,
  id: string,
  to: S,
  ctx: TransitionCtx,
  opts: { forced: boolean; extra?: Record<string, unknown> },
): Promise<TransitionResult<S>> {
  return db.$transaction(async (tx) => {
    const row = await cfg.load(tx, id);
    if (!row) throw new InvalidTransitionError(`${cfg.entityType} ${id} inesistente`);
    if (row.deletedAt) throw new InvalidTransitionError(`${cfg.entityType} eliminato`);

    const from = row.status;
    if (from === to) return { from, to, changed: false };

    if (!opts.forced && !cfg.transitions[from]?.includes(to)) {
      throw new InvalidTransitionError(`${cfg.entityType} ${from} -> ${to} non ammessa`, {
        from,
        to,
      });
    }

    // Le invarianti (guardie) si applicano SEMPRE, anche in modalità forzata.
    await cfg.guards?.[to]?.(row, tx, ctx);

    await cfg.apply(tx, id, to, opts.extra);

    const metadata = opts.forced ? { ...(ctx.metadata ?? {}), forced: true } : ctx.metadata;
    await tx.stateTransition.create({
      data: {
        entityType: cfg.entityType,
        entityId: id,
        fromStatus: from,
        toStatus: to,
        actorType: ctx.actorType ?? "SYSTEM",
        actorUserId: ctx.actorUserId ?? null,
        reason: ctx.reason ?? null,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });

    await writeAudit(tx, {
      action: `${cfg.entityType.toLowerCase()}.transition.${opts.forced ? "forced" : to}`,
      entityType: cfg.entityType,
      entityId: id,
      actorType: ctx.actorType ?? "SYSTEM",
      actorUserId: ctx.actorUserId,
      before: { status: from },
      after: opts.forced ? { status: to, forced: true } : { status: to },
      summary: ctx.reason,
      requestId: ctx.requestId,
    });

    return { from, to, changed: true };
  });
}

/** Transizione ammessa dalla mappa (E). Atomica: apply + StateTransition + AuditLog. */
export function transition<Row extends { status: S; deletedAt?: Date | null }, S extends string>(
  cfg: EntityStateConfig<Row, S>,
  id: string,
  to: S,
  ctx: TransitionCtx = {},
  extra?: Record<string, unknown>,
): Promise<TransitionResult<S>> {
  return runTransition(cfg, id, to, ctx, { forced: false, extra });
}

/**
 * Override manuale (solo ADMIN, sezione E.8): salta la mappa ma NON le guardie,
 * vieta l'ingresso negli stati "protetti", `reason` obbligatorio, `metadata.forced=true`.
 */
export function forceTransition<
  Row extends { status: S; deletedAt?: Date | null },
  S extends string,
>(
  cfg: EntityStateConfig<Row, S>,
  id: string,
  to: S,
  ctx: TransitionCtx & { reason: string },
): Promise<TransitionResult<S>> {
  if (cfg.protectedStates?.includes(to)) {
    return Promise.reject(
      new InvalidTransitionError(
        `Ingresso in ${to} non forzabile: richiede il trigger reale (ordine/pagamento/trasferimento)`,
      ),
    );
  }
  return runTransition(
    cfg,
    id,
    to,
    { ...ctx, actorType: ctx.actorType ?? "USER" },
    { forced: true },
  );
}
