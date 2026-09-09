import { handler } from "@/lib/api/handler";
import { systemHealth } from "@/services/monitoring/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(
  async () => {
    const h = await systemHealth();
    return Response.json(h, { status: h.status === "down" ? 503 : 200 });
  },
  { auth: "admin" },
);
