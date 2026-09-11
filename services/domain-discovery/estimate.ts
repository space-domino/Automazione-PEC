import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSetting } from "@/lib/settings";
import { rankBestDomain, researchDomainNaming } from "@/services/ai-gateway";
import { runAvailabilityForDomain } from "@/services/availability";
import { normalizeCompany } from "@/services/company-registry";
import type { AvailabilityResult } from "@prisma/client";
import { isValidFqdn, normExt, normSld, toAsciiHost } from "./post-process";

const log = logger.child({ svc: "domain-estimate" });

export interface Actor {
  userId?: string;
  requestId?: string;
}

export interface EstimateResult {
  companyId: string;
  domainId: string | null;
  fqdn: string;
  available: boolean;
  availabilityResult: AvailabilityResult;
  confidence: number;
  reasoning: string;
  researchNotes: string;
}

function hostFromWebsite(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * Stima IL dominio migliore per un'azienda: dati azienda + ricerca web su
 * attività simili -> un solo candidato -> verifica WHOIS/RDAP reale.
 * Se libero, il risultato è quel dominio (persistito come Domain, pronto
 * all'uso come qualunque altro candidato); se occupato, lo comunica senza
 * crearne uno spurio nel sistema.
 */
export async function estimateBestDomain(
  companyId: string,
  actor: Actor = {},
): Promise<EstimateResult> {
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new NotFoundError("Azienda non trovata");
  if (company.deletedAt || company.isBlocked) {
    throw new ValidationError(undefined, "Azienda bloccata o eliminata: stima non disponibile");
  }

  const allowedExtensions = await getSetting("domain.extensions");
  const { companyForm } = normalizeCompany({ legalName: company.legalName });

  const { notes: researchNotes } = await researchDomainNaming(
    { legalName: company.legalName, sector: company.sector, province: company.province },
    { companyId },
  );
  log.info({ companyId, researchNotes: researchNotes.slice(0, 200) }, "ricerca web completata");

  const estimate = await rankBestDomain(
    {
      legalName: company.legalName,
      normalizedName: company.normalizedName,
      companyForm,
      province: company.province,
      provinceName: company.provinceName,
      sector: company.sector,
      websiteHost: hostFromWebsite(company.website),
      allowedExtensions,
      researchNotes,
    },
    { companyId },
  );

  const sld = toAsciiHost(normSld(estimate.sld).replace(/\.+/g, "-"));
  const extension = normExt(estimate.extension);
  if (!sld) throw new ValidationError(undefined, "L'AI ha proposto un dominio non valido");
  const fqdn = `${sld}.${extension}`;
  if (!isValidFqdn(fqdn)) {
    throw new ValidationError(undefined, `Dominio proposto non valido: "${fqdn}"`);
  }

  let domain = await db.domain.findUnique({ where: { fqdn } });
  if (domain && domain.companyId !== companyId) {
    // stesso principio di sicurezza delle campagne: mai riusare un dominio di
    // un'altra azienda già presente nel sistema.
    throw new ValidationError(
      undefined,
      `${fqdn} è già nel sistema, assegnato a un'altra azienda: non riutilizzabile`,
    );
  }

  if (!domain) {
    domain = await db.domain.create({
      data: {
        companyId,
        fqdn,
        sld,
        extension,
        status: "DISCOVERED",
        aiScore: estimate.confidence,
        aiConfidence: estimate.confidence,
        aiReasoning: estimate.reasoning,
        aiPromptName: "domain-estimate",
        aiPromptVersion: "v1",
        rankScore: estimate.confidence,
      },
    });
  }

  const outcome = await runAvailabilityForDomain(domain.id, { force: true });
  log.info(
    { companyId, domainId: domain.id, fqdn, result: outcome.result, requestId: actor.requestId },
    "stima dominio completata",
  );

  return {
    companyId,
    domainId: domain.id,
    fqdn,
    available: outcome.result === "AVAILABLE",
    availabilityResult: outcome.result,
    confidence: estimate.confidence,
    reasoning: estimate.reasoning,
    researchNotes,
  };
}
