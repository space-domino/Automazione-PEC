import "dotenv/config";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { putObject, s3ConfigFromEnv } from "../lib/s3";

/**
 * Backup off-site del database (sezione 30 / M12).
 *   npm run backup
 *
 * Richiede `pg_dump` nel PATH (pacchetto `postgresql-client`, presente
 * nell'immagine `postgres`). Carica un dump gzip su bucket S3-compatibile
 * (`BACKUP_S3_*`). La retention si configura come lifecycle policy sul bucket.
 */

const log = logger.child({ proc: "backup" });

async function main() {
  const cfg = s3ConfigFromEnv();
  if (!cfg) {
    log.error("BACKUP_S3_* non configurate: niente da fare");
    process.exitCode = 1;
    return;
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const key = `pg/drp-${stamp}.sql.gz`;

  log.info("pg_dump in corso…");
  const dump = execFileSync(
    "pg_dump",
    [env.DATABASE_URL, "--no-owner", "--no-privileges", "--format=plain"],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  const gz = gzipSync(dump, { level: 9 });
  log.info({ rawBytes: dump.length, gzBytes: gz.length }, "dump pronto, carico su S3");

  const url = await putObject(cfg, { key, body: gz, contentType: "application/gzip" });
  log.info({ url }, "backup completato");
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : err }, "backup fallito");
  process.exit(1);
});
