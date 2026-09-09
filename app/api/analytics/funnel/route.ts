import { handler } from "@/lib/api/handler";
import { getFunnelTimeseries } from "@/services/analytics";

export const runtime = "nodejs";

export const GET = handler(
  async ({ req }) => {
    const days = Math.min(
      90,
      Math.max(7, Number.parseInt(new URL(req.url).searchParams.get("days") ?? "30", 10) || 30),
    );
    return Response.json({ data: await getFunnelTimeseries(days) });
  },
  { auth: "admin" },
);
