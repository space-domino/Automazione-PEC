import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Token firmati HMAC-SHA256, senza stato (sezione G.11).
 * Usati per link pubblici non indovinabili: disiscrizione PEC (M9),
 * consegna/transfer (M11). Formato: `<base64url(payload)>.<base64url(sig)>`.
 *
 * NON è cifratura: il payload è leggibile. Non metterci segreti, solo id + scopo.
 */

const KEY = env.TOKEN_SIGNING_KEY;

type Payload = Record<string, unknown> & {
  /** scopo del token, es. "optout" — vincola l'uso */
  s: string;
  /** epoch seconds di scadenza (opzionale) */
  exp?: number;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", KEY).update(data).digest());
}

export interface SignOptions {
  /** durata di validità in secondi */
  ttlSec?: number;
}

export function signToken(
  scope: string,
  data: Record<string, unknown>,
  opts: SignOptions = {},
): string {
  const payload: Payload = { ...data, s: scope };
  if (opts.ttlSec) payload.exp = Math.floor(Date.now() / 1000) + opts.ttlSec;
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

export interface VerifyResult<T> {
  ok: boolean;
  reason?: "malformed" | "bad-signature" | "expired" | "wrong-scope";
  payload?: T;
}

export function verifyToken<T extends Record<string, unknown> = Record<string, unknown>>(
  token: string,
  scope: string,
): VerifyResult<T> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;

  const expected = fromB64url(sign(body));
  const got = fromB64url(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return { ok: false, reason: "bad-signature" };
  }

  let payload: Payload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as Payload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (payload.s !== scope) return { ok: false, reason: "wrong-scope" };
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload: payload as unknown as T };
}
