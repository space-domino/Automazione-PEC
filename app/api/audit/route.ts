import { handler } from "@/lib/api/handler";
import { listActivity } from "@/services/catalog/activity";

export const runtime = "nodejs";

export const GET = handler(
  async ({ req }) => {
    const u = new URL(req.url);
    return Response.json(
      await listActivity({
        entityType: u.searchParams.get("entityType") ?? undefined,
        entityId: u.searchParams.get("entityId") ?? undefined,
        page: Number.parseInt(u.searchParams.get("page") ?? "1", 10) || 1,
      }),
    );
  },
  { auth: "admin" },
);
