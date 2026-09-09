import { handler } from "@/lib/api/handler";
import { listTransfers } from "@/services/transfer";

export const runtime = "nodejs";

const STAGES = new Set(["to_start", "in_progress", "failed", "done"]);

export const GET = handler(
  async ({ req }) => {
    const u = new URL(req.url);
    const stageRaw = u.searchParams.get("stage") ?? undefined;
    return Response.json(
      await listTransfers({
        stage: stageRaw && STAGES.has(stageRaw) ? (stageRaw as "to_start") : undefined,
        q: u.searchParams.get("q") ?? undefined,
        page: Number.parseInt(u.searchParams.get("page") ?? "1", 10) || 1,
        pageSize: Number.parseInt(u.searchParams.get("pageSize") ?? "50", 10) || 50,
      }),
    );
  },
  { auth: "admin" },
);
