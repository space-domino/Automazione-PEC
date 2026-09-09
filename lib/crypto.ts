import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Cifratura simmetrica a riposo (sezione G.12) per i dati sensibili:
 * codice di autorizzazione al trasferimento (EPP authcode), e in generale
 * segreti che devono poter essere riletti.
 *
 * AES-256-GCM. Chiave = `DATA_ENCRYPTION_KEY` (base64 di 32 byte).
 * Formato del token: `v1.<iv b64>.<tag b64>.<ciphertext b64>`.
 */

const KEY = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");
if (KEY.length !== 32) {
  throw new Error(
    `DATA_ENCRYPTION_KEY deve essere 32 byte in base64 (trovati ${KEY.length}). Genera con: openssl rand -base64 32`,
  );
}

const PREFIX = "v1";
const IV_LEN = 12;

/** Cifra una stringa UTF-8. Ritorna il token `v1.iv.tag.ct`. */
export function encryptString(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

/** Decifra un token prodotto da `encryptString`. Lancia se manomesso o malformato. */
export function decryptString(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("token cifrato malformato");
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** True se la stringa ha la forma di un token cifrato (non ne verifica la firma). */
export function isEncrypted(s: string | null | undefined): boolean {
  return typeof s === "string" && s.startsWith(`${PREFIX}.`) && s.split(".").length === 4;
}
