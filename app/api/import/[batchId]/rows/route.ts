import { handler } from "@/lib/api/handler";
import { listRows } from "@/services/ingestion";
import type { ImportRowStatus } from "@prisma/client";

export const runtime = "nodejs";

const VALID: ImportRowStatus[] = ["IMPORTED", "DUPLICATE", "SKIPPED", "ERROR"];

export const GET = handler<{ batchId: string }>(
  async ({ params, req }) => {
    const url = new URL(req.url);
    const raw = url.searchParams.get("status");
    const status =
      raw && VALID.includes(raw as ImportRowStatus) ? (raw as ImportRowStatus) : undefined;
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
    return Response.json(await listRows(params.batchId, { status, page }));
  },
  { auth: "admin" },
);
