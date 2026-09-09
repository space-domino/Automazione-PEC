import { handler } from "@/lib/api/handler";
import { listJobs } from "@/services/catalog/jobs";

export const runtime = "nodejs";

export const GET = handler(
  async ({ req }) => {
    const u = new URL(req.url);
    return Response.json(
      await listJobs({
        queue: u.searchParams.get("queue") ?? undefined,
        status: u.searchParams.get("status") ?? undefined,
        page: Number.parseInt(u.searchParams.get("page") ?? "1", 10) || 1,
      }),
    );
  },
  { auth: "admin" },
);
