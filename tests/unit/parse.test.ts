import { readFileSync } from "node:fs";
import {
  decodeBuffer,
  detectDelimiter,
  detectEncoding,
  forEachRow,
  parsePreview,
} from "@/services/ingestion/parse";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(new URL("../fixtures/companies-messy.csv", import.meta.url));

describe("detectDelimiter", () => {
  it("sceglie il separatore più frequente nell'header", () => {
    expect(detectDelimiter("a;b;c;d")).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
  });
});

describe("detectEncoding / decodeBuffer", () => {
  it("tratta ASCII/UTF-8 come utf-8", () => {
    expect(detectEncoding(Buffer.from("Ragione Sociale;P.IVA\nAlfa;123"))).toBe("utf-8");
  });

  it("round-trip su windows-1252 con accenti", () => {
    const original = "Società Città d'Arte èìòù";
    const buf = iconv.encode(original, "win1252");
    expect(decodeBuffer(buf, "windows-1252")).toBe(original);
  });

  it("rimuove il BOM UTF-8", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Nome;Prov")]);
    expect(decodeBuffer(buf, detectEncoding(buf))).toBe("Nome;Prov");
  });
});

describe("parsePreview", () => {
  it("estrae header, delimitatore e conteggio righe dalla fixture", () => {
    const p = parsePreview(fixture);
    expect(p.delimiter).toBe(";");
    expect(p.headers).toEqual(["Denominazione", "P.IVA", "PEC", "Prov", "Sito"]);
    expect(p.totalDataRows).toBe(6);
    expect(p.rows[0]?.[0]).toBe("Alfa Costruzioni S.r.l.");
    expect(p.rows[4]?.[0]).toBe(""); // riga senza denominazione
  });
});

describe("forEachRow", () => {
  it("itera le sole righe dati con rowNumber 1-based e header", async () => {
    const seen: Array<{ n: number; first: string }> = [];
    const { headers, total } = await forEachRow(
      fixture,
      { encoding: "utf-8", delimiter: ";" },
      async (row, rowNumber, hdrs) => {
        expect(hdrs[0]).toBe("Denominazione");
        seen.push({ n: rowNumber, first: row[0] ?? "" });
      },
    );
    expect(headers).toEqual(["Denominazione", "P.IVA", "PEC", "Prov", "Sito"]);
    expect(total).toBe(6);
    expect(seen[0]).toEqual({ n: 1, first: "Alfa Costruzioni S.r.l." });
    expect(seen.at(-1)).toEqual({ n: 6, first: "Gamma Servizi S.n.c." });
  });
});
