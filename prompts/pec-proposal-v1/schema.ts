import * as z from "zod/v4";

/** Input per la rifinitura del testo della proposta commerciale (PEC). */
export const ProposalInputSchema = z.object({
  companyName: z.string(),
  domain: z.string(),
  price: z.string(),
  offerUrl: z.string(),
  /** corpo HTML attuale, GIÀ renderizzato (nessun placeholder residuo) */
  currentHtml: z.string(),
  tone: z.string(),
  instructions: z.string().nullable(),
});
export type ProposalInput = z.infer<typeof ProposalInputSchema>;

/** Output dell'AI: solo miglioramento del testo, nessun dato nuovo. */
export const ProposalOutputSchema = z.object({
  /** nuovo corpo HTML (tag semplici: p, strong, em, a, br, ul, li) */
  bodyHtml: z.string().min(20).max(20_000),
  /** una frase su cosa è stato cambiato */
  summary: z.string().max(300),
});
export type ProposalOutput = z.infer<typeof ProposalOutputSchema>;
