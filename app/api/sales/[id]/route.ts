import { handler } from "@/lib/api/handler";
import { getOrder } from "@/services/sales";

export const runtime = "nodejs";

export const GET = handler<{ id: string }>(
  async ({ params }) => Response.json(await getOrder(params.id)),
  { auth: "admin" },
);
