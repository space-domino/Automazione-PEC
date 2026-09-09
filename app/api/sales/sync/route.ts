import { handler } from "@/lib/api/handler";
import { syncExternalSales, syncSalesSchema } from "@/services/sales";

export const runtime = "nodejs";

/**
 * Trigger manuale del bridge vendite: legge subito gli ordini recenti dello
 * storefront e ne ingerisce quelli abbinati a un'offerta. Il worker esegue
 * comunque lo stesso job in modo periodico.
 */
export const POST = handler(
  async ({ req, session, requestId }) => {
    const input = syncSalesSchema.partial().parse(await req.json().catch(() => ({})));
    const result = await syncExternalSales(input, { userId: session?.user.id, requestId });
    return Response.json(result);
  },
  {
    auth: "admin",
    rateLimit: { key: () => "sales.sync", limit: 12, windowSec: 60 },
  },
);
