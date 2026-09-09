import { handler } from "@/lib/api/handler";
import { markNotificationRead } from "@/services/monitoring/alerts";

export const runtime = "nodejs";

export const POST = handler<{ id: string }>(
  async ({ params }) => Response.json(await markNotificationRead(params.id)),
  { auth: "admin" },
);
