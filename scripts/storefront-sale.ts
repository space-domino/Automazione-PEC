import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPool } from "mysql2/promise";

/**
 * Promo di sito su spacedomino.it: porta il prezzo di TUTTI i prodotti a un
 * valore unico e permette di ripristinare i listini originali.
 *
 *   npx tsx scripts/storefront-sale.ts apply 49.99      # backup + set prezzo unico
 *   npx tsx scripts/storefront-sale.ts restore <file>   # rimette i prezzi dal backup
 *   npx tsx scripts/storefront-sale.ts status           # distribuzione prezzi attuale
 *
 * Richiede il tunnel verso il MySQL di spacedomino attivo (SPACEDOMINO_DATABASE_URL).
 */

const uri = process.env.SPACEDOMINO_DATABASE_URL;
if (!uri) {
  console.error("SPACEDOMINO_DATABASE_URL non impostata.");
  process.exit(1);
}

const [mode, arg] = process.argv.slice(2);
const pool = createPool({ uri, connectionLimit: 3 });
const BACKUP_DIR = join(process.cwd(), "scripts", "sale-backups");

type Row = { id: number; name: string; tld: string; price: string | number };

async function readAll(): Promise<Row[]> {
  const [rows] = await pool.query("SELECT id, name, tld, price FROM products ORDER BY id");
  return rows as Row[];
}

async function status() {
  const rows = await readAll();
  const byPrice = new Map<string, number>();
  for (const r of rows) {
    const k = String(r.price);
    byPrice.set(k, (byPrice.get(k) ?? 0) + 1);
  }
  console.log(`prodotti totali: ${rows.length}`);
  console.log("distribuzione prezzi:");
  for (const [p, n] of [...byPrice.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padStart(10)} € × ${n}`);
  }
}

async function apply(priceArg: string) {
  const price = Number(priceArg);
  if (!Number.isFinite(price) || price <= 0) {
    console.error(`prezzo non valido: ${priceArg}`);
    process.exit(1);
  }

  const rows = await readAll();
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(BACKUP_DIR, `prices-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { takenAt: new Date().toISOString(), count: rows.length, prices: rows },
      null,
      2,
    ),
  );
  console.log(`backup listini -> ${file}  (${rows.length} prodotti)`);

  const [res] = await pool.query("UPDATE products SET price = ?", [price]);
  const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
  console.log(`UPDATE products SET price = ${price}  ->  righe modificate: ${affected}`);

  const check = await readAll();
  const distinct = new Set(check.map((r) => String(r.price)));
  console.log("prezzi distinti ora:", [...distinct].join(", "));
  console.log(`\nPer ripristinare:\n  npx tsx scripts/storefront-sale.ts restore "${file}"`);
}

async function restore(file: string) {
  if (!file) {
    console.error("indica il file di backup: restore <path>");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(file, "utf8")) as { prices: Row[] };
  let done = 0;
  for (const r of data.prices) {
    await pool.query("UPDATE products SET price = ? WHERE id = ?", [r.price, r.id]);
    done++;
  }
  console.log(`ripristinati ${done} prezzi dal backup ${file}`);
  await status();
}

try {
  if (mode === "apply") await apply(arg ?? "");
  else if (mode === "restore") await restore(arg ?? "");
  else if (mode === "status") await status();
  else {
    console.log("uso: apply <prezzo> | restore <file> | status");
  }
} finally {
  await pool.end();
}
process.exit(0);
