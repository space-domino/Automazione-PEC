import { handler } from "@/lib/api/handler";
import { deleteBatch, getBatch } from "@/services/ingestion";

export const runtime = "nodejs";

export const GET = handler<{ batchId: string }>(
  async ({ params }) => Response.json(await getBatch(params.batchId)),
  { auth: "admin" },
);

export const DELETE = handler<{ batchId: string }>(
  async ({ params }) => {
    await deleteBatch(params.batchId);
    return Response.json({ ok: true });
  },
  { auth: "admin" },
);
