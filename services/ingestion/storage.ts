import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "@/lib/env";

const DIR = resolve(env.UPLOADS_DIR);

function safeName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_")
      .slice(-80) || "upload.csv"
  );
}

/** Salva il file originale intatto. Ritorna il path RELATIVO (salvato in ImportBatch.storagePath). */
export async function saveUpload(originalName: string, buf: Buffer): Promise<string> {
  await mkdir(DIR, { recursive: true });
  const rel = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName(originalName)}`;
  await writeFile(join(DIR, rel), buf);
  return rel;
}

export async function readUpload(rel: string): Promise<Buffer> {
  return readFile(join(DIR, rel));
}

export async function deleteUpload(rel: string): Promise<void> {
  try {
    await unlink(join(DIR, rel));
  } catch {
    // già assente: ok
  }
}
