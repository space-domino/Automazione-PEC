import { ValidationError } from "@/lib/api/errors";
import { handler } from "@/lib/api/handler";
import { createBatchFromUpload, listBatches } from "@/services/ingestion";

export const runtime = "nodejs";

export const GET = handler(
  async () => {
    return Response.json({ data: await listBatches() });
  },
  { auth: "admin" },
);

export const POST = handler(
  async ({ req }) => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError(undefined, "Campo 'file' mancante");
    }
    const looksCsv =
      /\.csv$/i.test(file.name) ||
      /csv|text\/plain|excel|spreadsheet/i.test(file.type || "") ||
      !file.type;
    if (!looksCsv) {
      throw new ValidationError(undefined, "Serve un file CSV");
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await createBatchFromUpload(file.name || "upload.csv", buf);
    return Response.json(result, { status: 201 });
  },
  {
    auth: "admin",
    rateLimit: { key: () => "import.upload", limit: 20, windowSec: 60 },
  },
);
