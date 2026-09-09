import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueue } from "@/lib/queue";
import { getSetting } from "@/lib/settings";
import type { AvailabilityResult, DomainStatus, Prisma } from "@prisma/client";
import { getCachedAvailability, setCachedAvailability } from "./cache";
import { rdapCheck } from "./rdap";
import { whoisCheck } from "./whois";

export { rdapCheck, tldOf } from "./rdap";
export { whoisCheck } from "./whois";

export interface AvailabilityCheckResult {
  result: AvailabilityResult;
  provider: string;
  statusCode?: number;
  meta?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  fromCache: boolean;
}

const DEFINITIVE = (r: AvailabilityResult): r is "AVAILABLE" | "REGISTERED" =>
  r === "AVAILABLE" || r === "REGISTERED";

/** RDAP -> (fallback) WHOIS -> cache. Non lancia mai: UNKNOWN/ERROR sono esiti. */
export async function checkAvailability(
  fqdn: string,
  opts: { force?: boolean } = {},
): Promise<AvailabilityCheckResult> {
  const ttlHours = await getSetting("availability.cache_ttl_hours");

  if (!opts.force) {
    const cached = await getCachedAvailability(fqdn);
    if (cached) {
      return { result: cached.result, provider: cached.provider, durationMs: 0, fromCache: true };
    }
  }

  const rdap = await rdapCheck(fqdn);
  let final: AvailabilityCheckResult;

  if (rdap.supported && DEFINITIVE(rdap.result)) {
    final = { ...rdap, fromCache: false };
  } else {
    const whois = await whoisCheck(fqdn);
    if (whois.supported && DEFINITIVE(whois.result)) {
      final = {
        result: whois.result,
        provider: whois.provider,
        error: whois.error,
        durationMs: rdap.durationMs + whois.durationMs,
        fromCache: false,
      };
    } else {
      final = {
        result: rdap.result === "ERROR" || whois.result === "ERROR" ? "ERROR" : "UNKNOWN",
        provider: rdap.supported ? rdap.provider : whois.provider,
        statusCode: rdap.statusCode,
        error: rdap.error ?? whois.error,
        durationMs: rdap.durationMs + (whois.supported ? whois.durationMs : 0),
        fromCache: false,
      };
    }
  }

  if (DEFINITIVE(final.result)) {
    await setCachedAvailability(
      fqdn,
      { result: final.result, provider: final.provider, at: Date.now() },
      ttlHours,
    );
  }
  return final;
}

// Transizioni di stato ammesse in questa milestone (il motore completo arriva in M6).
const AVAIL_TRANSITIONS: Partial<Record<DomainStatus, DomainStatus[]>> = {
  DISCOVERED: ["AVAILABLE", "REGISTERED"],
  AVAILABLE: ["REGISTERED"],
  REGISTERED: ["AVAILABLE"],
};

export function canAvailabilityTransition(from: DomainStatus, to: DomainStatus): boolean {
  return AVAIL_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface DomainAvailabilityOutcome {
  domainId: string;
  result: AvailabilityResult;
  statusChanged: boolean;
  fromCache: boolean;
}

/** Verifica un dominio, salva lo storico, denormalizza e (se lecito) cambia stato. */
export async function runAvailabilityForDomain(
  domainId: string,
  opts: { force?: boolean } = {},
): Promise<DomainAvailabilityOutcome> {
  const log = logger.child({ domainId, job: "availability.check" });

  const domain = await db.domain.findUnique({ where: { id: domainId } });
  if (!domain) throw new Error(`Domain ${domainId} non trovato`);
  if (domain.deletedAt || domain.isBlocked) {
    return { domainId, result: domain.availabilityResult, statusChanged: false, fromCache: false };
  }

  const res = await checkAvailability(domain.fqdn, opts);

  await db.availabilityCheck.create({
    data: {
      domainId,
      result: res.result,
      provider: res.provider,
      responseMeta: (res.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      rawStatusCode: res.statusCode ?? null,
      error: res.error ?? null,
      durationMs: Math.round(res.durationMs),
    },
  });

  const data: Prisma.DomainUpdateInput = {
    availabilityResult: res.result,
    availabilityCheckedAt: new Date(),
    availabilityProvider: res.provider,
  };

  let statusChanged = false;
  if (
    DEFINITIVE(res.result) &&
    res.result !== domain.status &&
    canAvailabilityTransition(domain.status, res.result)
  ) {
    data.status = res.result;
    statusChanged = true;
  }

  await db.domain.update({ where: { id: domainId }, data });

  if (statusChanged) {
    await db.stateTransition.create({
      data: {
        entityType: "Domain",
        entityId: domainId,
        fromStatus: domain.status,
        toStatus: res.result,
        actorType: "SYSTEM",
        reason: `availability.check (${res.provider})`,
      },
    });
  }

  log.info(
    { result: res.result, statusChanged, fromCache: res.fromCache },
    "availability.check completata",
  );
  return { domainId, result: res.result, statusChanged, fromCache: res.fromCache };
}

export async function enqueueAvailabilityForDomains(
  domainIds: string[],
  opts: { force?: boolean } = {},
): Promise<number> {
  const nonce = opts.force ? `:${Date.now()}` : "";
  let n = 0;
  for (const id of domainIds) {
    await enqueue(
      "availability",
      "availability.check",
      { domainId: id, force: opts.force ?? false },
      { dedupeKey: `availability.check:${id}${nonce}` },
    );
    n++;
  }
  return n;
}

/** Domini mai verificati o con verifica scaduta (per il recheck periodico). */
export async function enqueueStaleAvailability(): Promise<number> {
  const recheckDays = await getSetting("availability.recheck_days");
  if (recheckDays <= 0) return 0;
  const cutoff = new Date(Date.now() - recheckDays * 86_400_000);
  const stale = await db.domain.findMany({
    where: {
      deletedAt: null,
      isBlocked: false,
      status: { in: ["DISCOVERED", "AVAILABLE", "REGISTERED"] },
      OR: [{ availabilityCheckedAt: null }, { availabilityCheckedAt: { lt: cutoff } }],
    },
    select: { id: true },
    take: 2000,
  });
  return enqueueAvailabilityForDomains(stale.map((d) => d.id));
}
