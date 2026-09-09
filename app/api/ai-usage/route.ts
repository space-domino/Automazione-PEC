import { handler } from "@/lib/api/handler";
import { aiCostSummary } from "@/services/ai-gateway";

export const runtime = "nodejs";

export const GET = handler(async () => Response.json(await aiCostSummary()), { auth: "admin" });
