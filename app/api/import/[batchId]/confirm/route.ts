import { handler } from "@/lib/api/handler";
import { confirmAndEnqueue } from "@/services/ingestion";

export const runtime = "nodejs";

export const POST = handler<{ batchId: string }>(
  async ({ params, req }) => {
    const body = (await req.json().catch(() => ({}))) as { mapping?: unknown };
    const res = await confirmAndEnqueue(params.batchId, body.mapping);
    return Response.json({ ...res, statusUrl: `/api/import/${params.batchId}` }, { status: 202 });
  },
  { auth: "admin" },
);
