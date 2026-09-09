import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Transporter } from "nodemailer";
import { PecNotConfiguredError } from "./errors";

/**
 * Trasporto SMTP verso il gestore PEC (sezione H.7 / I).
 * Feature-flag `features.pec` (PEC_SMTP_HOST + USER + PASS). Il transporter è
 * creato pigramente: importare questo modulo non apre connessioni.
 */

const log = logger.child({ svc: "pec", part: "smtp" });

let transporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (!features.pec) throw new PecNotConfiguredError("SMTP PEC");
  if (!transporter) {
    const nodemailer = await import("nodemailer");
    transporter = nodemailer.createTransport({
      host: env.PEC_SMTP_HOST,
      port: env.PEC_SMTP_PORT,
      secure: env.PEC_SMTP_PORT === 465, // 465 implicit TLS; 587 STARTTLS
      auth: { user: env.PEC_SMTP_USER, pass: env.PEC_SMTP_PASS },
      requireTLS: env.PEC_SMTP_PORT !== 465,
    });
    log.info({ host: env.PEC_SMTP_HOST, port: env.PEC_SMTP_PORT }, "transporter SMTP PEC creato");
  }
  return transporter;
}

/** Mittente effettivo: PEC_FROM_ADDRESS se valorizzato, altrimenti l'utente SMTP. */
export function pecFromAddress(): string {
  return env.PEC_FROM_ADDRESS && env.PEC_FROM_ADDRESS.length > 0
    ? env.PEC_FROM_ADDRESS
    : (env.PEC_SMTP_USER ?? "");
}

export interface SendPecInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** header extra (es. tracciamento interno). NON impostare Message-ID: lo genera il transporter. */
  headers?: Record<string, string>;
}

export interface SendPecResult {
  /** Message-ID assegnato — da salvare in Communication.providerMessageId */
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
}

/** Invia una PEC. Non applica business rule (soppressione/stato): quello sta a monte. */
export async function sendPec(input: SendPecInput): Promise<SendPecResult> {
  const tx = await getTransporter();
  const from = pecFromAddress();
  if (!from) throw new PecNotConfiguredError("mittente PEC");

  const info = await tx.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: input.headers,
  });

  const messageId = String(info.messageId ?? "").replace(/^<|>$/g, "");
  log.info({ to: input.to, messageId }, "PEC inviata");
  return {
    messageId,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
    response: info.response ?? "",
  };
}

export interface TransportHealth {
  configured: boolean;
  ok: boolean;
  error?: string;
}

/** Verifica login/handshake SMTP senza inviare nulla. */
export async function verifyTransport(): Promise<TransportHealth> {
  if (!features.pec) return { configured: false, ok: false, error: "pec-disabled" };
  try {
    const tx = await getTransporter();
    await tx.verify();
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Chiude il pool SMTP (test / shutdown worker). */
export function closeTransport(): void {
  transporter?.close();
  transporter = null;
}
