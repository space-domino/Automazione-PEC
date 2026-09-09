import { handler } from "@/lib/api/handler";
import { getTransfer } from "@/services/transfer";

export const runtime = "nodejs";

export const GET = handler<{ id: string }>(
  async ({ params }) => Response.json(await getTransfer(params.id)),
  { auth: "admin" },
);
