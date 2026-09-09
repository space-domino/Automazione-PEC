import * as z from "zod/v4";

/** Input passato all'AI (serializzato in JSON nel messaggio user). */
export const DiscoveryInputSchema = z.object({
  legalName: z.string(),
  normalizedName: z.string(),
  companyForm: z.string().nullable(),
  province: z.string().nullable(),
  provinceName: z.string().nullable(),
  sector: z.string().nullable(),
  websiteHost: z.string().nullable(),
  allowedExtensions: z.array(z.string()),
  maxCandidates: z.number().int().min(1).max(10),
});
export type DiscoveryInput = z.infer<typeof DiscoveryInputSchema>;

/** Un candidato come lo restituisce l'AI (pre post-processing deterministico). */
export const DiscoveryCandidateSchema = z.object({
  sld: z.string().min(1).max(63),
  extension: z.string().max(24), // "" ammesso -> espansione a valle
  score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  reason: z.string().min(1).max(300),
});
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidateSchema>;

export const DiscoveryOutputSchema = z.object({
  candidates: z.array(DiscoveryCandidateSchema).min(1).max(8),
});
export type DiscoveryOutput = z.infer<typeof DiscoveryOutputSchema>;
