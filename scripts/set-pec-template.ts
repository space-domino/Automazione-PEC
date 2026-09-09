import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../lib/db";

/**
 * Carica il template PEC "univoco" di Space Domino nel DB e lo rende attivo.
 *
 *   npm run set-pec-template
 *   npm run set-pec-template -- --subject "In attesa di check-out" --name spacedomino-promemoria
 *
 * Il corpo HTML è in db/templates/pec-body.html (versionabile, modificabile a mano).
 * Placeholder supportati dal compose: {{domain}} {{offer_url}} {{seller_legal_name}}
 * {{seller_contact}} {{optout_url}} {{company_name}} {{price}}
 */

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : def;
}

async function main() {
  const name = arg("name", "spacedomino-promemoria");
  const subject = arg("subject", "In attesa di check-out");
  const bodyHtml = readFileSync(join(process.cwd(), "db/templates/pec-body.html"), "utf8");

  // disattiva gli altri PEC_BODY / PEC_SUBJECT
  await db.messageTemplate.updateMany({
    where: { type: { in: ["PEC_BODY", "PEC_SUBJECT"] } },
    data: { isActive: false },
  });

  const body = await db.messageTemplate.upsert({
    where: { type_name_version: { type: "PEC_BODY", name, version: 1 } },
    update: { bodyHtml, isActive: true },
    create: {
      type: "PEC_BODY",
      name,
      version: 1,
      isActive: true,
      bodyHtml,
      variables: ["domain", "offer_url", "seller_legal_name", "seller_contact", "optout_url"],
    },
  });

  await db.messageTemplate.upsert({
    where: { type_name_version: { type: "PEC_SUBJECT", name, version: 1 } },
    update: { bodyHtml: subject, isActive: true },
    create: {
      type: "PEC_SUBJECT",
      name,
      version: 1,
      isActive: true,
      bodyHtml: subject,
      variables: ["domain"],
    },
  });

  await db.setting.upsert({
    where: { key: "pec.active_template" },
    update: { value: body.id },
    create: { key: "pec.active_template", value: body.id },
  });

  console.log(`Template PEC attivo: "${name}" (id ${body.id})`);
  console.log(`Oggetto: "${subject}"`);
  console.log(`Corpo: ${bodyHtml.length} byte da db/templates/pec-body.html`);
  await db.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
