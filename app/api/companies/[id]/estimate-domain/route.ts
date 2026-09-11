import { handler } from "@/lib/api/handler";
import { estimateBestDomain } from "@/services/domain-discovery";

export const runtime = "nodejs";

/**
 * Stima IL dominio migliore per l'azienda: dati azienda + ricerca web su
 * attività simili -> un candidato -> verifica WHOIS/RDAP reale. Sincrona:
 * l'utente vede subito o il dominio (se libero) o che è già preso.
 */
export const POST = handler<{ id: string }>(
  async ({ params, session }) =>
    Response.json(await estimateBestDomain(params.id, { userId: session?.user.id })),
  { auth: "admin", rateLimit: { key: () => "companies.estimate", limit: 20, windowSec: 60 } },
);
