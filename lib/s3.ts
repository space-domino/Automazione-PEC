import { createHash, createHmac } from "node:crypto";
import { env } from "./env";

/**
 * Client S3 minimale (solo PUT) con firma AWS SigV4, senza dipendenze.
 * Compatibile con AWS S3 e S3-compatible (MinIO, Backblaze B2, R2, Wasabi).
 * Path-style addressing: `<endpoint>/<bucket>/<key>`.
 *
 * Usato per il backup off-site del dump PostgreSQL (M12).
 */

const REGION = env.BACKUP_S3_REGION ?? "us-east-1";
const SERVICE = "s3";

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function signingKey(secret: string, date: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType?: string;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export function s3ConfigFromEnv(): S3Config | null {
  if (
    !env.BACKUP_S3_ENDPOINT ||
    !env.BACKUP_S3_BUCKET ||
    !env.BACKUP_S3_KEY ||
    !env.BACKUP_S3_SECRET
  ) {
    return null;
  }
  return {
    endpoint: env.BACKUP_S3_ENDPOINT.replace(/\/+$/, ""),
    bucket: env.BACKUP_S3_BUCKET,
    accessKey: env.BACKUP_S3_KEY,
    secretKey: env.BACKUP_S3_SECRET,
  };
}

/** Carica un oggetto. Lancia se la risposta non è 2xx. Ritorna l'URL finale. */
export async function putObject(cfg: S3Config, input: PutObjectInput): Promise<string> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${input.key.replace(/^\/+/, "")}`);
  const host = url.host;
  const canonicalUri = url.pathname
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);
  const contentType = input.contentType ?? "application/octet-stream";

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signature = hmac(signingKey(cfg.secretKey, dateStamp), stringToSign).toString("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method: "PUT",
    // biome-ignore lint/suspicious/noExplicitAny: BodyInit accetta Buffer a runtime
    body: input.body as any,
    headers: {
      "content-type": contentType,
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 PUT ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  return url.toString();
}

/** Espone le primitive per i test. */
export const _internals = { sha256Hex, hmac, signingKey };
