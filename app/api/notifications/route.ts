import { handler } from "@/lib/api/handler";
import { listNotifications } from "@/services/monitoring/alerts";

export const runtime = "nodejs";

export const GET = handler(
  async ({ req }) => {
    const u = new URL(req.url);
    return Response.json(
      await listNotifications({
        unreadOnly: u.searchParams.get("unread") === "1",
        page: Number.parseInt(u.searchParams.get("page") ?? "1", 10) || 1,
        pageSize: Number.parseInt(u.searchParams.get("pageSize") ?? "50", 10) || 50,
      }),
    );
  },
  { auth: "admin" },
);
