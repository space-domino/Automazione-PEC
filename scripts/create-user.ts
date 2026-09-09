import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { hashPassword } from "../lib/auth/password";
import { db } from "../lib/db";

/**
 * Crea o aggiorna un utente della dashboard.
 *
 *   npm run create-user -- --email you@example.com
 *   npm run create-user -- --email you@example.com --password 's3cret' --name "Mario" --role ADMIN
 *
 * Se --password non è passata, viene chiesta a schermo (input visibile — usala
 * in un terminale privato) oppure letta da CREATE_USER_PASSWORD.
 */

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
  },
});

const ROLES = ["ADMIN", "OPERATOR", "VIEWER"] as const;
type Role = (typeof ROLES)[number];

async function main() {
  const email = values.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("Errore: --email obbligatoria e valida.");
    process.exit(1);
  }

  const role = (values.role ?? "ADMIN").toUpperCase();
  if (!ROLES.includes(role as Role)) {
    console.error(`Errore: --role deve essere uno tra ${ROLES.join(", ")}.`);
    process.exit(1);
  }

  let password = values.password ?? process.env.CREATE_USER_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question("Password (input visibile): ");
    rl.close();
  }
  if (!password || password.length < 10) {
    console.error("Errore: la password deve avere almeno 10 caratteri.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const user = await db.user.upsert({
    where: { email },
    update: { passwordHash, isActive: true, role: role as Role, name: values.name ?? undefined },
    create: { email, passwordHash, role: role as Role, name: values.name ?? "Admin" },
  });

  console.log(`OK: utente ${user.email} (${user.role}) pronto.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
