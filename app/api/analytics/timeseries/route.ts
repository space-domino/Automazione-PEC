import { handler } from "@/lib/api/handler";
import { getTimeseries } from "@/services/catalog/timeseries";

export const runtime = "nodejs";

export const GET = handler(
  async ({ req }) => {
    const days = Math.min(
      90,
      Math.max(7, Number.parseInt(new URL(req.url).searchParams.get("days") ?? "14", 10) || 14),
    );
    return Response.json({ data: await getTimeseries(days) });
  },
  { auth: "admin" },
);
