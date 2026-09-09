import { handler } from "@/lib/api/handler";
import { listCommunications } from "@/services/pec";

export const runtime = "nodejs";

export const GET = handler(
  async ({ req }) => {
    const u = new URL(req.url);
    return Response.json(
      await listCommunications({
        status: u.searchParams.get("status") ?? undefined,
        companyId: u.searchParams.get("companyId") ?? undefined,
        offerId: u.searchParams.get("offerId") ?? undefined,
        q: u.searchParams.get("q") ?? undefined,
        page: Number.parseInt(u.searchParams.get("page") ?? "1", 10) || 1,
        pageSize: Number.parseInt(u.searchParams.get("pageSize") ?? "50", 10) || 50,
      }),
    );
  },
  { auth: "admin" },
);
