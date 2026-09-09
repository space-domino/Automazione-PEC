import { createHash } from "node:crypto";
import type { DiscoveryInput } from "@/prompts/domain-discovery-v1/schema";
import { normalizeCompany } from "@/services/company-registry";
import type { Company } from "@prisma/client";

function hostFromWebsite(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function buildDiscoveryInput(
  company: Company,
  allowedExtensions: string[],
  maxCandidates: number,
): DiscoveryInput {
  // La forma societaria non è persistita a parte: la ricaviamo dal legalName.
  const { companyForm } = normalizeCompany({ legalName: company.legalName });

  return {
    legalName: company.legalName,
    normalizedName: company.normalizedName,
    companyForm,
    province: company.province ?? null,
    provinceName: company.provinceName ?? null,
    sector: company.sector ?? null,
    websiteHost: hostFromWebsite(company.website),
    allowedExtensions,
    maxCandidates,
  };
}

/** Hash stabile dei soli campi che influenzano il risultato (per la cache, H.7). */
export function discoveryInputHash(input: DiscoveryInput): string {
  const key = JSON.stringify({
    n: input.normalizedName.toLowerCase().trim(),
    f: input.companyForm,
    p: input.province,
    s: input.sector,
    w: input.websiteHost,
    e: [...input.allowedExtensions].map((x) => x.toLowerCase()).sort(),
    m: input.maxCandidates,
  });
  return createHash("sha256").update(key).digest("hex");
}
