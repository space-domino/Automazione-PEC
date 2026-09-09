import "dotenv/config";
import { fetchCompletedSales, pingStorefront, pushOffer } from "../services/spacedomino";

async function main() {
  console.log("== 1) ping (connessione + lettura products) ==");
  console.log("  ", JSON.stringify(await pingStorefront()));

  console.log("== 2) lettura orders/order_items (grant SELECT) ==");
  const sales = await fetchCompletedSales({ sinceDays: 120, limit: 3 });
  console.log("  righe vendite ultime 120gg:", sales.length);
  if (sales[0]) console.log("  esempio:", JSON.stringify({ ...sales[0], paymentRef: "***" }));

  console.log("== 3) test SCRITTURA non distruttiva su un prodotto esistente (duralamp/.it) ==");
  const { createPool } = await import("mysql2/promise");
  const pool = createPool({
    uri: process.env.SPACEDOMINO_DATABASE_URL as string,
    connectionLimit: 2,
  });
  const [before] = await pool.query(
    "SELECT name,tld,price,premium,category FROM products WHERE name='duralamp' AND tld='.it'",
  );
  const b = (before as Record<string, unknown>[])[0];
  console.log("  PRIMA :", JSON.stringify(b));
  if (!b) {
    console.log("  (duralamp/.it non presente — salto il test di scrittura)");
  } else {
    const r = await pushOffer({
      sld: "duralamp",
      tld: "it",
      price: Number(b.price),
      premium: Number(b.premium) === 1,
      category: String(b.category),
    });
    console.log("  pushOffer ->", JSON.stringify(r));
    const [after] = await pool.query(
      "SELECT name,tld,price,premium,category FROM products WHERE name='duralamp' AND tld='.it'",
    );
    const a = (after as Record<string, unknown>[])[0];
    console.log("  DOPO  :", JSON.stringify(a));
    console.log("  identico (nessuna modifica visibile):", JSON.stringify(a) === JSON.stringify(b));
  }
  await pool.end();
  process.exit(0);
}
main().catch((e) => {
  console.error("ERRORE:", e?.code || "", e?.message || e);
  process.exit(1);
});
