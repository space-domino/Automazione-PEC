import { handler } from "@/lib/api/handler";
import { listOrders, manualSaleSchema, recordManualSale } from "@/services/sales";

export const runtime = "nodejs";

export const GET = handler(
  async ({ req }) => {
    const u = new URL(req.url);
    return Response.json(
      await listOrders({
        orderStatus: u.searchParams.get("orderStatus") ?? undefined,
        source: u.searchParams.get("source") ?? undefined,
        q: u.searchParams.get("q") ?? undefined,
        page: Number.parseInt(u.searchParams.get("page") ?? "1", 10) || 1,
        pageSize: Number.parseInt(u.searchParams.get("pageSize") ?? "50", 10) || 50,
      }),
    );
  },
  { auth: "admin" },
);

export const POST = handler(
  async ({ req, session, requestId }) => {
    const input = manualSaleSchema.parse(await req.json().catch(() => ({})));
    return Response.json(await recordManualSale(input, { userId: session?.user.id, requestId }), {
      status: 201,
    });
  },
  { auth: "admin" },
);
