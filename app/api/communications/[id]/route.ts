import { NotFoundError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { getCommunication } from "@/services/pec";

export const runtime = "nodejs";

export const GET = handler<{ id: string }>(
  async ({ params }) => {
    const comm = await getCommunication(params.id);
    if (!comm) throw new NotFoundError("Comunicazione inesistente");
    return Response.json(comm);
  },
  { auth: "admin" },
);
