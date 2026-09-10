import { z } from "zod";

/**
 * Validazione fail-fast dell'ambiente (sezione G.1).
 * Se una variabile obbligatoria manca o è malformata, l'app NON si avvia.
 *
 * NB: modulo SERVER-ONLY per convenzione (usato da app/api, worker e scripts).
 * Non importa "server-only" apposta: deve girare anche sotto tsx (worker/seed),
 * dove quel pacchetto lancerebbe un errore.
 *
 * Contesti non-Next (worker, scripts, seed) devono caricare prima il .env:
 *   import "dotenv/config";
 * Next carica automaticamente .env / .env.local.
 */

const nonEmpty = z.string().min(1);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ----- Obbligatorie -----
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  AUTH_SECRET: z.string().min(32, "almeno 32 caratteri (usa: openssl rand -base64 32)"),
  AUTH_URL: z.string().url(),
  APP_BASE_URL: z.string().url(),
  PUBLIC_BASE_URL: z.string().url(),

  DATA_ENCRYPTION_KEY: z.string().min(44, "base64 di 32 byte (openssl rand -base64 32)"),
  TOKEN_SIGNING_KEY: z.string().min(32),

  // ----- Storage locale -----
  UPLOADS_DIR: z.string().default("./data/uploads"),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),

  // ----- Storefront spacedomino.it (Milestone 7) -----
  SPACEDOMINO_BASE_URL: z.string().url().default("https://spacedomino.it"),
  /** connessione MySQL allo storefront per push catalogo / pull ordini (opzionale) */
  SPACEDOMINO_DATABASE_URL: z.string().optional(),
  /** origini ammesse per l'API pubblica (CSV). Default: lo storefront. */
  PUBLIC_CORS_ORIGINS: z.string().default("https://spacedomino.it"),

  // ----- Domini (usati soprattutto da Caddy; opzionali per l'app) -----
  APP_DOMAIN: z.string().optional(),
  PUBLIC_DOMAIN: z.string().optional(),
  N8N_DOMAIN: z.string().optional(),

  // ----- AI (Milestone 3) -----
  AI_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // ----- Stripe (Milestone 8) -----
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // ----- PEC (Milestone 9) -----
  PEC_SMTP_HOST: z.string().optional(),
  PEC_SMTP_PORT: z.coerce.number().int().positive().default(465),
  PEC_SMTP_USER: z.string().optional(),
  PEC_SMTP_PASS: z.string().optional(),
  PEC_IMAP_HOST: z.string().optional(),
  PEC_IMAP_PORT: z.coerce.number().int().positive().default(993),
  PEC_IMAP_USER: z.string().optional(),
  PEC_IMAP_PASS: z.string().optional(),
  PEC_FROM_ADDRESS: z.union([z.string().email(), z.literal("")]).optional(),
  /**
   * Password PEC in base64. Se valorizzata, ha precedenza su PEC_*_PASS.
   * Serve perché dotenv-expand (usato da @next/env) altera i valori con `$`
   * nel .env: `Pa$$w0rd` diventa `Pa$`. Il base64 non contiene `$` e viene
   * letto identico da tutti i loader (dotenv puro nel worker, @next/env nel web).
   */
  PEC_SMTP_PASS_B64: z.string().optional(),
  PEC_IMAP_PASS_B64: z.string().optional(),

  // ----- Backup / observability / n8n (Milestone 12) -----
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_REGION: z.string().optional(),
  BACKUP_S3_KEY: z.string().optional(),
  BACKUP_S3_SECRET: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  SENTRY_DSN: z.string().optional(),
  GLITCHTIP_DSN: z.string().optional(),
  N8N_WEBHOOK_URL: z.string().optional(),
  N8N_WEBHOOK_TOKEN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
  // fail-fast: meglio un crash chiaro all'avvio che un `undefined` in produzione
  throw new Error(
    `Configurazione ambiente non valida:\n${lines.join("\n")}\nControlla il tuo file .env (vedi .env.example).`,
  );
}

/** Decodifica un segreto base64 (ritorna undefined se assente/vuoto). */
function fromB64(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return Buffer.from(v, "base64").toString("utf8");
}

export const env = {
  ...parsed.data,
  PEC_SMTP_PASS: fromB64(parsed.data.PEC_SMTP_PASS_B64) ?? parsed.data.PEC_SMTP_PASS,
  PEC_IMAP_PASS: fromB64(parsed.data.PEC_IMAP_PASS_B64) ?? parsed.data.PEC_IMAP_PASS,
};

/** Flag di disponibilità dei servizi esterni, per rami condizionali puliti. */
export const features = {
  ai: Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY),
  stripe: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
  pec: Boolean(env.PEC_SMTP_HOST && env.PEC_SMTP_USER && env.PEC_SMTP_PASS),
  backup: Boolean(env.BACKUP_S3_ENDPOINT && env.BACKUP_S3_BUCKET),
  errorTracking: Boolean(env.SENTRY_DSN || env.GLITCHTIP_DSN),
  n8n: Boolean(env.N8N_WEBHOOK_URL),
  storefront: Boolean(env.SPACEDOMINO_DATABASE_URL),
} as const;

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
