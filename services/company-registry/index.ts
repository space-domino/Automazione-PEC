import { db } from "@/lib/db";
import type { Company, Prisma } from "@prisma/client";
import { type NormalizedCompany, type RawCompanyFields, normalizeCompany } from "./normalize";

export { normalizeCompany, isValidPartitaIva, computeDedupeHash } from "./normalize";
export type { NormalizedCompany, RawCompanyFields } from "./normalize";

export type ImportRowOutcome =
  | { kind: "created"; companyId: string; normalized: NormalizedCompany }
  | { kind: "duplicate"; companyId: string; normalized: NormalizedCompany };

/**
 * Trova un'azienda già presente:
 *  1. per P.IVA valida (chiave forte)
 *  2. altrimenti per dedupeHash (nome normalizzato + provincia + pec + piva)
 * Ignora i record soft-deleted.
 */
export async function findExistingCompany(n: NormalizedCompany): Promise<Company | null> {
  if (n.vatNumber) {
    const byVat = await db.company.findFirst({
      where: { vatNumber: n.vatNumber, deletedAt: null },
    });
    if (byVat) return byVat;
  }
  return db.company.findFirst({ where: { dedupeHash: n.dedupeHash, deletedAt: null } });
}

/**
 * Importa una singola riga: normalizza, deduplica, inserisce.
 * Conserva `rawData` (la riga CSV originale). Non lancia sui duplicati.
 */
export async function importCompanyRow(
  raw: RawCompanyFields,
  rawData: Prisma.InputJsonValue,
  importBatchId: string,
): Promise<ImportRowOutcome> {
  const normalized = normalizeCompany(raw);

  const existing = await findExistingCompany(normalized);
  if (existing) return { kind: "duplicate", companyId: existing.id, normalized };

  try {
    const created = await db.company.create({
      data: {
        legalName: normalized.legalName,
        normalizedName: normalized.normalizedName,
        province: normalized.province,
        provinceName: normalized.provinceName,
        pec: normalized.pec,
        vatNumber: normalized.vatNumber,
        website: normalized.website,
        sector: normalized.sector,
        rawData,
        dedupeHash: normalized.dedupeHash,
        importBatchId,
      },
    });
    return { kind: "created", companyId: created.id, normalized };
  } catch (err) {
    // Corsa con un'altra riga/batch sullo stesso dedupeHash o vatNumber -> è un duplicato.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      const again = await findExistingCompany(normalized);
      if (again) return { kind: "duplicate", companyId: again.id, normalized };
    }
    throw err;
  }
}
