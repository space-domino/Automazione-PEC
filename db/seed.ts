import "dotenv/config";
import { hashPassword } from "../lib/auth/password";
import { db } from "../lib/db";

/**
 * Seed idempotente.
 *  - Setting di default (sezione F.8): create-only, NON sovrascrive valori che hai già cambiato.
 *  - Template base PEC + Landing (attivi).
 *  - Utente admin: solo se SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD sono in env,
 *    altrimenti usa:  npm run create-user -- --email you@example.com
 *
 * Esecuzione:  npm run db:seed
 */

async function seedTemplates() {
  const landing = await db.messageTemplate.upsert({
    where: { type_name_version: { type: "LANDING_PAGE", name: "default", version: 1 } },
    update: {},
    create: {
      type: "LANDING_PAGE",
      name: "default",
      version: 1,
      isActive: true,
      variables: ["company_name", "domain", "price", "offer_url", "headline", "seller_legal_name"],
      subject: null,
      bodyHtml: `<section class="offer">
  <p class="eyebrow">{{company_name}}</p>
  <h1>{{domain}}</h1>
  <p class="lede">{{headline}}</p>
  <p class="price">{{price}}</p>
  <a class="cta" href="{{offer_url}}">Acquista il dominio</a>
  <p class="seller">Venditore: {{seller_legal_name}}</p>
</section>`,
      bodyText: null,
    },
  });

  const pecSubject = await db.messageTemplate.upsert({
    where: { type_name_version: { type: "PEC_SUBJECT", name: "default", version: 1 } },
    update: {},
    create: {
      type: "PEC_SUBJECT",
      name: "default",
      version: 1,
      isActive: true,
      variables: ["company_name", "domain"],
      subject: null,
      bodyHtml: "Disponibilità del dominio {{domain}}",
      bodyText: null,
    },
  });

  const pecBody = await db.messageTemplate.upsert({
    where: { type_name_version: { type: "PEC_BODY", name: "default", version: 1 } },
    update: {},
    create: {
      type: "PEC_BODY",
      name: "default",
      version: 1,
      isActive: true,
      variables: [
        "company_name",
        "domain",
        "price",
        "offer_url",
        "seller_legal_name",
        "seller_contact",
        "optout_url",
      ],
      subject: null,
      bodyHtml: `<p>Spett.le {{company_name}},</p>
<p>il dominio <strong>{{domain}}</strong> è disponibile per l'acquisto.</p>
<p>Prezzo: <strong>{{price}}</strong></p>
<p><a href="{{offer_url}}">Visualizza l'offerta</a></p>
<p>Cordiali saluti,<br>{{seller_legal_name}} — {{seller_contact}}</p>
<hr>
<p style="font-size:12px;color:#666">
  Per non ricevere ulteriori comunicazioni: <a href="{{optout_url}}">disiscrizione</a>.
  Informativa privacy disponibile su richiesta.
</p>`,
      bodyText: null,
    },
  });

  return { landing, pecSubject, pecBody };
}

async function seedSettings(activeTemplates: { landingId: string; pecBodyId: string }) {
  const base = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

  const settings: Array<{
    key: string;
    value: unknown;
    description: string;
    category: string;
  }> = [
    {
      key: "domain.extensions",
      value: ["it", "com"],
      description: "Estensioni da analizzare",
      category: "ai",
    },
    {
      key: "discovery.max_candidates",
      value: 5,
      description: "Max candidati per azienda",
      category: "ai",
    },
    {
      key: "discovery.use_company_analysis",
      value: false,
      description: "Abilita company-analysis prima del discovery",
      category: "ai",
    },
    {
      key: "discovery.result_ttl_days",
      value: 30,
      description: "Giorni di validità del risultato discovery cache",
      category: "ai",
    },
    {
      key: "ai.confidence_threshold",
      value: 55,
      description: "Soglia sotto cui il dominio è 'bassa confidenza'",
      category: "ai",
    },
    {
      key: "ai.models",
      value: {
        DOMAIN_DISCOVERY: "claude-haiku-4-5",
        DOMAIN_RANKING: "claude-sonnet-5",
        COMPANY_ANALYSIS: "claude-haiku-4-5",
        PEC_GENERATION: "claude-sonnet-5",
        TEXT_IMPROVEMENT: "claude-sonnet-5",
      },
      description: "Modello per tipo di chiamata AI",
      category: "ai",
    },
    {
      key: "ai.prompt_versions",
      value: {
        "domain-discovery": "v1",
        "domain-ranking": "v1",
        "company-analysis": "v1",
        "pec-generation": "v1",
      },
      description: "Versione attiva di ogni prompt",
      category: "ai",
    },
    {
      key: "ai.daily_budget_usd",
      value: 20,
      description: "Budget AI giornaliero (pausa code al superamento)",
      category: "ai",
    },
    {
      key: "ranking.weights",
      value: {
        aiConfidence: 0.3,
        nameMatch: 0.25,
        availability: 0.2,
        brevity: 0.15,
        extension: 0.1,
      },
      description: "Pesi della formula rankScore (somma = 1)",
      category: "ranking",
    },
    {
      key: "ranking.tie_delta",
      value: 5,
      description: "Delta entro cui due candidati sono 'quasi pari' -> hook AI",
      category: "ranking",
    },
    {
      key: "availability.cache_ttl_hours",
      value: 24,
      description: "TTL cache RDAP",
      category: "availability",
    },
    {
      key: "availability.recheck_days",
      value: 14,
      description: "Ogni quanti giorni riverificare (0 = mai)",
      category: "availability",
    },
    {
      key: "price.default",
      value: 499,
      description: "Prezzo di vendita di default (EUR)",
      category: "pricing",
    },
    {
      key: "pec.max_per_hour",
      value: 20,
      description: "Limite invii PEC/ora (rispetta il contratto del gestore)",
      category: "pec",
    },
    { key: "pec.from_address", value: "", description: "Indirizzo PEC mittente", category: "pec" },
    {
      key: "pec.active_template",
      value: activeTemplates.pecBodyId,
      description: "MessageTemplate PEC_BODY attivo",
      category: "pec",
    },
    {
      key: "landing.active_template",
      value: activeTemplates.landingId,
      description: "MessageTemplate LANDING_PAGE attivo",
      category: "landing",
    },
    {
      key: "checkout.currency",
      value: "EUR",
      description: "Valuta del checkout",
      category: "checkout",
    },
    {
      key: "seller.base_url",
      value: base,
      description: "Base URL pubblica per landing/offerte",
      category: "seller",
    },
    {
      key: "seller.legal_name",
      value: "",
      description: "Ragione sociale del venditore",
      category: "seller",
    },
    { key: "seller.vat", value: "", description: "P.IVA del venditore", category: "seller" },
    {
      key: "seller.address",
      value: "",
      description: "Indirizzo del venditore",
      category: "seller",
    },
    {
      key: "seller.contact",
      value: "",
      description: "Contatto (email/telefono) del venditore",
      category: "seller",
    },
  ];

  for (const s of settings) {
    await db.setting.upsert({
      where: { key: s.key },
      update: {}, // idempotente: non tocca valori già modificati da te
      create: {
        key: s.key,
        value: s.value as object,
        description: s.description,
        category: s.category,
      },
    });
  }
  return settings.length;
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("• admin: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD non impostate — salto.");
    console.log("  Crea l'admin con:  npm run create-user -- --email you@example.com");
    return;
  }
  const passwordHash = await hashPassword(password);
  await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Admin", role: "ADMIN", passwordHash },
  });
  console.log(`• admin: ${email} pronto.`);
}

async function main() {
  console.log("Seed…");
  const t = await seedTemplates();
  console.log("• template: landing + PEC (subject/body) attivi.");
  const n = await seedSettings({ landingId: t.landing.id, pecBodyId: t.pecBody.id });
  console.log(`• setting: ${n} chiavi.`);
  await seedAdmin();
  console.log("Fatto.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
