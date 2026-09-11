import * as z from "zod/v4";

/**
 * Stima del dominio migliore per un'azienda (sezione "Campagne" / ranking).
 * A differenza di domain-discovery (N candidati grezzi), qui l'AI riceve ANCHE
 * gli esiti di una ricerca web sul settore e deve scegliere UN SOLO dominio.
 */
export const EstimateInputSchema = z.object({
  legalName: z.string(),
  normalizedName: z.string(),
  companyForm: z.string().nullable(),
  province: z.string().nullable(),
  provinceName: z.string().nullable(),
  sector: z.string().nullable(),
  websiteHost: z.string().nullable(),
  allowedExtensions: z.array(z.string()),
  /** Sintesi testuale della ricerca web (naming di attività simili nel settore). */
  researchNotes: z.string(),
});
export type EstimateInput = z.infer<typeof EstimateInputSchema>;

export const EstimateOutputSchema = z.object({
  sld: z.string().min(1).max(63),
  extension: z.string().min(1).max(24),
  confidence: z.number().int().min(0).max(100),
  reasoning: z.string().min(1).max(500),
});
export type EstimateOutput = z.infer<typeof EstimateOutputSchema>;
