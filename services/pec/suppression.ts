import { db } from "@/lib/db";
import type { SuppressionEntry } from "@prisma/client";
import { PecSuppressedError } from "./errors";

export interface SuppressionSubject {
  id: string;
  pec: string | null;
  vatNumber: string | null;
}

/** Cerca una soppressione attiva per azienda / PEC / dominio / P.IVA. */
export async function findSuppression(
  company: SuppressionSubject,
  fqdn: string,
): Promise<SuppressionEntry | null> {
  const values: Array<{ type: "PEC_ADDRESS" | "COMPANY" | "DOMAIN" | "VAT"; value: string }> = [
    { type: "COMPANY", value: company.id },
    { type: "DOMAIN", value: fqdn },
  ];
  if (company.pec) values.push({ type: "PEC_ADDRESS", value: company.pec.toLowerCase() });
  if (company.vatNumber) values.push({ type: "VAT", value: company.vatNumber });

  return db.suppressionEntry.findFirst({
    where: {
      OR: values,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
    },
  });
}

/** Come sopra ma lancia `PecSuppressedError` se trova qualcosa. */
export async function assertNotSuppressed(
  company: SuppressionSubject,
  fqdn: string,
): Promise<void> {
  const hit = await findSuppression(company, fqdn);
  if (hit) throw new PecSuppressedError(`${hit.type} (${hit.reason})`);
}
