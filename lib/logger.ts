import pino from "pino";
import { isProd } from "./env";

/**
 * Logger applicativo strutturato (sezione G.11).
 * JSON puro, nessun transport (i worker-thread di pino-pretty non convivono
 * bene col bundling di Next). In dev puoi abbellire con:  next dev | npx pino-pretty
 *
 * `redact` rimuove automaticamente segreti e PII dai log.
 */
export const logger = pino({
  level: isProd ? "info" : "debug",
  base: { service: "drp" },
  redact: {
    paths: [
      "password",
      "*.password",
      "pass",
      "*.pass",
      "passwordHash",
      "*.passwordHash",
      "authorization",
      "*.authorization",
      "req.headers.authorization",
      "headers.authorization",
      "cookie",
      "*.cookie",
      "req.headers.cookie",
      "headers.cookie",
      "token",
      "*.token",
      "secret",
      "*.secret",
      "apiKey",
      "*.apiKey",
      "authCode",
      "*.authCode",
      "transferAuthCode",
      "transferAuthCodeEnc",
      "*.transferAuthCodeEnc",
      "totpSecret",
      "*.totpSecret",
      "stripeSignature",
      "*.stripeSignature",
      "AUTH_SECRET",
      "DATA_ENCRYPTION_KEY",
      "TOKEN_SIGNING_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "PEC_SMTP_PASS",
      "PEC_IMAP_PASS",
      "PEC_SMTP_PASS_B64",
      "PEC_IMAP_PASS_B64",
      "SENDGRID_API_KEY",
    ],
    censor: "[redacted]",
  },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
