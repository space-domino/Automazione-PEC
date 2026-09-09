import { suggestMapping } from "@/services/ingestion/column-aliases";
import { describe, expect, it } from "vitest";

describe("suggestMapping", () => {
  it("riconosce intestazioni italiane comuni (anche con punteggiatura)", () => {
    const m = suggestMapping(["Denominazione", "P.IVA", "PEC", "Prov", "Sito"]);
    expect(m).toEqual({ legalName: 0, vatNumber: 1, pec: 2, province: 3, website: 4 });
  });

  it("riconosce varianti: 'Ragione Sociale', 'Partita IVA', 'Sito web', 'Provincia'", () => {
    const m = suggestMapping([
      "Ragione Sociale",
      "Partita IVA",
      "Indirizzo PEC",
      "Provincia sede legale",
      "Sito web",
      "Codice ATECO",
    ]);
    expect(m.legalName).toBe(0);
    expect(m.vatNumber).toBe(1);
    expect(m.pec).toBe(2);
    expect(m.province).toBe(3);
    expect(m.website).toBe(4);
    expect(m.sector).toBe(5);
  });

  it("riconosce intestazioni inglesi", () => {
    const m = suggestMapping(["Company Name", "VAT", "PEC", "Province", "Website"]);
    expect(m.legalName).toBe(0);
    expect(m.vatNumber).toBe(1);
  });

  it("non assegna la stessa colonna a due campi", () => {
    const m = suggestMapping(["nome", "note"]);
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });

  it("lascia non mappati i campi senza corrispondenza", () => {
    const m = suggestMapping(["colonna1", "colonna2"]);
    expect(m.legalName).toBeUndefined();
  });
});
