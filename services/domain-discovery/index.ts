import { db } from "@/lib/db";
import { features } from "@/lib/env";
import { logger } from "@/lib/logger";
import { enqueue } from "@/lib/queue";
import { getSetting } from "@/lib/settings";
import { AiBudgetExceededError, generateDomainCandidates } from "@/services/ai-gateway";
import { enqueueAvailabilityForDomains } from "@/services/availability";
import { buildDiscoveryInput, discoveryInputHash } from "./build-input";
import { postProcessCandidates } from "./post-process";

export { postProcessCandidates } from "./post-process";
export { buildDiscoveryInput, discoveryInputHash } from "./build-input";

export interface DiscoveryOutcome {
  companyId: string;
  created: number;
  proposed: number;
  skippedCached: boolean;
}

/** Genera e persiste i candidati dominio per un'azienda (D — Fase 4). */
export async function discoverForCompany(
  companyId: string,
  opts: { force?: boolean } = {},
): Promise<DiscoveryOutcome> {
  const log = logger.child({ companyId, job: "discovery.company" });

  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error(`Company ${companyId} non trovata`);
  if (company.deletedAt || company.isBlocked) {
    log.info({ blocked: company.isBlocked, deleted: !!company.deletedAt }, "discovery saltata");
    return { companyId, created: 0, proposed: 0, skippedCached: false };
  }

  const [allowedExtensions, maxCandidates, promptVersions, ttlDays] = await Promise.all([
    getSetting("domain.extensions"),
    getSetting("discovery.max_candidates"),
    getSetting("ai.prompt_versions"),
    getSetting("discovery.result_ttl_days"),
  ]);

  const input = buildDiscoveryInput(company, allowedExtensions, maxCandidates);
  const inputHash = discoveryInputHash(input);
  const promptVersion = promptVersions["domain-discovery"] ?? "v1";

  if (!opts.force) {
    const cutoff = ttlDays > 0 ? new Date(Date.now() - ttlDays * 86_400_000) : undefined;
    const cached = await db.domain.findFirst({
      where: {
        companyId,
        deletedAt: null,
        aiPromptName: "domain-discovery",
        aiInputHash: inputHash,
        ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
      },
    });
    if (cached) {
      log.info("risultato in cache, chiamata AI saltata");
      return { companyId, created: 0, proposed: 0, skippedCached: true };
    }
  }

  let output: Awaited<ReturnType<typeof generateDomainCandidates>>;
  try {
    output = await generateDomainCandidates(input, { companyId });
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      await db.notification.create({
        data: {
          type: "ai.budget_exceeded",
          title: "Budget AI giornaliero superato",
          body: err.message,
          severity: "WARN",
        },
      });
    }
    throw err;
  }

  const processed = postProcessCandidates(output.candidates, allowedExtensions, maxCandidates);
  if (processed.length === 0) {
    log.warn("nessun candidato valido dopo il post-processing");
    return { companyId, created: 0, proposed: 0, skippedCached: false };
  }

  let created = 0;
  const createdDomainIds: string[] = [];
  for (const c of processed) {
    const existing = await db.domain.findUnique({ where: { fqdn: c.fqdn } });
    if (existing) continue; // fqdn è unico globale: un dominio appartiene a un'azienda sola

    const domain = await db.domain.create({
      data: {
        companyId,
        fqdn: c.fqdn,
        sld: c.sld,
        extension: c.extension,
        aiScore: c.score,
        aiConfidence: c.confidence,
        aiReasoning: c.reason,
        aiPromptName: "domain-discovery",
        aiPromptVersion: promptVersion,
        aiInputHash: inputHash,
        status: "DISCOVERED",
      },
    });
    await db.stateTransition.create({
      data: {
        entityType: "Domain",
        entityId: domain.id,
        fromStatus: null,
        toStatus: "DISCOVERED",
        actorType: "SYSTEM",
        reason: "discovery.company",
      },
    });
    created++;
    createdDomainIds.push(domain.id);
  }

  // D — Fase 5: verifica disponibilità automatica dei nuovi candidati.
  if (createdDomainIds.length > 0) {
    await enqueueAvailabilityForDomains(createdDomainIds).catch((err) =>
      log.warn({ err }, "enqueue availability fallito (discovery comunque ok)"),
    );
  }

  log.info({ created, proposed: processed.length }, "discovery.company completata");
  return { companyId, created, proposed: processed.length, skippedCached: false };
}

/**
 * Accoda `discovery.company` per una lista di aziende.
 * No-op silenzioso se nessuna API key AI è configurata (l'import resta funzionante).
 */
export async function enqueueDiscoveryForCompanies(
  companyIds: string[],
  opts: { force?: boolean } = {},
): Promise<number> {
  if (!features.ai) {
    logger.info({ count: companyIds.length }, "discovery non accodata: AI non configurata");
    return 0;
  }
  const nonce = opts.force ? `:${Date.now()}` : "";
  let n = 0;
  for (const id of companyIds) {
    await enqueue(
      "discovery",
      "discovery.company",
      { companyId: id, force: opts.force ?? false },
      { dedupeKey: `discovery.company:${id}${nonce}` },
    );
    n++;
  }
  return n;
}
