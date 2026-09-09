import { handler } from "@/lib/api/handler";
import { markAllNotificationsRead } from "@/services/monitoring/alerts";

export const runtime = "nodejs";

export const POST = handler(
  async () => Response.json({ marked: await markAllNotificationsRead() }),
  { auth: "admin" },
);
