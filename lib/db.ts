import { PrismaClient } from "@prisma/client";
import { isProd } from "./env";

/**
 * Singleton di PrismaClient.
 * In dev il globalThis evita di esaurire le connessioni ad ogni hot-reload.
 *
 * NB: modulo server-only per convenzione (usato da app/api, worker e scripts).
 * Non importa "server-only" apposta: deve funzionare anche sotto tsx.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ["warn", "error"] : ["warn", "error"],
  });

if (!isProd) globalForPrisma.prisma = db;

/** Ping usato da /api/health. */
export async function checkDb(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
