import { env, features } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Pool } from "mysql2/promise";

/**
 * Connettore verso il database MySQL dello storefront spacedomino.it.
 *
 * REGOLA D'ORO: non modifichiamo il codice di spacedomino. Qui scriviamo SOLO
 * sulla tabella `products` (il catalogo in vendita del sito) e, in futuro,
 * leggeremo `order_items` / `orders`. Nessuna migrazione, nessun trigger.
 *
 * Feature-flag: se `SPACEDOMINO_DATABASE_URL` non è impostata (`features.storefront`
 * === false) ogni operazione è un no-op tracciato a log. La piattaforma resta
 * pienamente funzionante anche senza storefront collegato.
 *
 * Mappatura piattaforma -> spacedomino.products:
 *   Offer.slug / Domain.fqdn  ->  (name = SLD, tld = ".it" | ".com" | ...)
 *   Offer.price               ->  price
 *   euristica                 ->  premium (tinyint), category (stringa)
 */

const log = logger.child({ svc: "spacedomino" });

/** Colonne che tocchiamo su INSERT. Adegua qui se lo schema `products` differisce. */
const PRODUCT_INSERT_COLS = ["name", "tld", "price", "premium", "category"] as const;

export interface OfferPushInput {
  /** SLD, minuscolo, senza estensione: "eternaholding" */
  sld: string;
  /** estensione senza punto iniziale: "it", "com", ... */
  tld: string;
  /** prezzo di vendita in EUR */
  price: number;
  /** override euristica premium */
  premium?: boolean;
  /** override categoria ("Domini Premium" | "Italia" | "Internazionale") */
  category?: string;
}

let pool: Pool | null = null;

/** Pool MySQL creato pigramente (solo se lo storefront è configurato). */
async function getPool(): Promise<Pool> {
  if (!env.SPACEDOMINO_DATABASE_URL) {
    throw new Error("SPACEDOMINO_DATABASE_URL non configurata: storefront non collegato");
  }
  if (!pool) {
    const { createPool } = await import("mysql2/promise");
    pool = createPool({
      uri: env.SPACEDOMINO_DATABASE_URL,
      connectionLimit: 4,
      waitForConnections: true,
      // il connettore scrive solo su `products`: nessun bisogno di transazioni lunghe
      enableKeepAlive: true,
    });
    log.info("pool MySQL storefront creato");
  }
  return pool;
}

/** Chiude il pool (usato dai test / shutdown worker). */
export async function closeStorefront(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

function withLeadingDot(tld: string): string {
  const t = tld.replace(/^\.+/, "").toLowerCase();
  return `.${t}`;
}

/** Euristica categoria/premium quando l'offerta non le specifica. */
function classify(input: OfferPushInput): { premium: 0 | 1; category: string } {
  const premium = input.premium ?? input.price >= 499;
  const tld = input.tld.replace(/^\.+/, "").toLowerCase();
  const category =
    input.category ?? (premium ? "Domini Premium" : tld === "it" ? "Italia" : "Internazionale");
  return { premium: premium ? 1 : 0, category };
}

export interface StorefrontResult {
  applied: boolean;
  reason?: string;
}

/**
 * Inserisce/aggiorna il dominio nel catalogo dello storefront.
 * Idempotente: UPSERT su UNIQUE(name, tld).
 */
export async function pushOffer(input: OfferPushInput): Promise<StorefrontResult> {
  if (!features.storefront) {
    log.info({ sld: input.sld, tld: input.tld }, "pushOffer: storefront non collegato, no-op");
    return { applied: false, reason: "storefront-disabled" };
  }

  const name = input.sld.trim().toLowerCase();
  const tld = withLeadingDot(input.tld);
  const { premium, category } = classify(input);
  const price = Number(input.price.toFixed(2));

  const cols = PRODUCT_INSERT_COLS.join(", ");
  const placeholders = PRODUCT_INSERT_COLS.map(() => "?").join(", ");
  const onDup =
    "ON DUPLICATE KEY UPDATE price = VALUES(price), premium = VALUES(premium), category = VALUES(category)";
  const sql = `INSERT INTO products (${cols}) VALUES (${placeholders}) ${onDup}`;

  const db = await getPool();
  await db.execute(sql, [name, tld, price, premium, category]);
  log.info({ name, tld, price, premium, category }, "pushOffer: catalogo storefront aggiornato");
  return { applied: true };
}

/** Rimuove il dominio dal catalogo dello storefront (ritiro / pausa offerta). */
export async function removeOffer(sld: string, tld: string): Promise<StorefrontResult> {
  if (!features.storefront) {
    log.info({ sld, tld }, "removeOffer: storefront non collegato, no-op");
    return { applied: false, reason: "storefront-disabled" };
  }
  const name = sld.trim().toLowerCase();
  const dotTld = withLeadingDot(tld);
  const db = await getPool();
  const [res] = await db.execute("DELETE FROM products WHERE name = ? AND tld = ?", [name, dotTld]);
  const affected = (res as { affectedRows?: number }).affectedRows ?? 0;
  log.info({ name, tld: dotTld, affected }, "removeOffer: catalogo storefront aggiornato");
  return { applied: true };
}

export interface StorefrontPing {
  ok: boolean;
  products?: number;
  error?: string;
}

/** Verifica connettività + accesso in lettura alla tabella `products`. */
export async function pingStorefront(): Promise<StorefrontPing> {
  if (!features.storefront) return { ok: false, error: "storefront-disabled" };
  try {
    const db = await getPool();
    const [rows] = await db.query("SELECT COUNT(*) AS n FROM products");
    const n = Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
    return { ok: true, products: n };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
//  Lettura vendite (M8) — bridge ordini spacedomino -> piattaforma
// ---------------------------------------------------------------------------

/** Una riga d'ordine pagata sullo storefront (join orders + order_items). */
export interface SpacedominoSaleRow {
  orderNumber: string;
  orderStatus: string; // "paid" | "completed" | ...
  itemStatus: string; // "pending" | "registered" | "failed" | "transferred"
  email: string;
  customerName: string | null;
  paymentRef: string | null;
  paidAt: Date | null;
  completedAt: Date | null;
  /** SLD (order_items.domain) */
  sld: string;
  /** estensione CON punto iniziale (order_items.tld), es. ".it" */
  tld: string;
  price: number;
  years: number | null;
}

/**
 * SELECT delle righe d'ordine pagate/completate degli ultimi `sinceDays` giorni.
 * Sola lettura. Nessun filtro sui domini "nostri": il match avviene lato piattaforma.
 *
 * NB: nomi tabelle/colonne dallo schema Drizzle rilevato (`docs/integration-spacedomino.md`).
 * Se differiscono, adegua qui — è l'unico punto che tocca `orders`/`order_items`.
 */
export async function fetchCompletedSales(opts: {
  sinceDays?: number;
  limit?: number;
}): Promise<SpacedominoSaleRow[]> {
  if (!features.storefront) return [];
  const sinceDays = Math.min(365, Math.max(1, opts.sinceDays ?? 90));
  const limit = Math.min(1000, Math.max(1, opts.limit ?? 500));

  const sql = `
    SELECT
      o.orderNumber  AS orderNumber,
      o.status       AS orderStatus,
      oi.status      AS itemStatus,
      o.email        AS email,
      o.customerName AS customerName,
      o.paymentRef   AS paymentRef,
      o.paidAt       AS paidAt,
      o.completedAt  AS completedAt,
      oi.domain      AS sld,
      oi.tld         AS tld,
      oi.price       AS price,
      oi.years       AS years
    FROM order_items oi
    JOIN orders o ON o.id = oi.orderId
    WHERE o.status IN ('paid', 'completed')
      AND oi.status <> 'failed'
      AND COALESCE(o.paidAt, o.completedAt) >= (NOW() - INTERVAL ? DAY)
    ORDER BY COALESCE(o.paidAt, o.completedAt) DESC
    LIMIT ?`;

  const db = await getPool();
  const [rows] = await db.query(sql, [sinceDays, limit]);
  return (rows as Record<string, unknown>[]).map((r) => ({
    orderNumber: String(r.orderNumber),
    orderStatus: String(r.orderStatus ?? ""),
    itemStatus: String(r.itemStatus ?? ""),
    email: String(r.email ?? ""),
    customerName: r.customerName ? String(r.customerName) : null,
    paymentRef: r.paymentRef ? String(r.paymentRef) : null,
    paidAt: r.paidAt ? new Date(r.paidAt as string) : null,
    completedAt: r.completedAt ? new Date(r.completedAt as string) : null,
    sld: String(r.sld ?? "")
      .trim()
      .toLowerCase(),
    tld: String(r.tld ?? "")
      .trim()
      .toLowerCase(),
    price: Number(r.price ?? 0),
    years: r.years == null ? null : Number(r.years),
  }));
}
