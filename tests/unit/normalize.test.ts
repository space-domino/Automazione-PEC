import {
  computeDedupeHash,
  isValidPartitaIva,
  normalizeCompany,
} from "@/services/company-registry/normalize";
import { describe, expect, it } from "vitest";

describe("isValidPartitaIva", () => {
  it("accetta P.IVA valide", () => {
    expect(isValidPartitaIva("00743110157")).toBe(true); // esempio classico (Esselunga)
    expect(isValidPartitaIva("IT 00743110157")).toBe(true);
  });
  it("rifiuta lunghezze e checksum errati", () => {
    expect(isValidPartitaIva("12345678901")).toBe(false);
    expect(isValidPartitaIva("0074311015")).toBe(false);
    expect(isValidPartitaIva("abcdefghijk")).toBe(false);
  });
});

describe("normalizeCompany — forma societaria", () => {
  const cases: Array<[string, string, string | null]> = [
    ["Alfa Costruzioni S.r.l.", "Alfa Costruzioni", "SRL"],
    ["ALFA COSTRUZIONI SRL", "Alfa Costruzioni", "SRL"],
    ["Beta Impianti S.R.L.", "Beta Impianti", "SRL"],
    ["Gamma Servizi s.r.l.s.", "Gamma Servizi", "SRLS"],
    ["DELTA SPA", "Delta", "SPA"],
    ["Epsilon S.p.A.", "Epsilon", "SPA"],
    ["Zeta & C. s.n.c.", "Zeta", "SNC"],
    ["Eta di Rossi Mario S.A.S.", "Eta di Rossi Mario", "SAS"],
    ["CoopService Società Cooperativa", "CoopService", "COOP"],
    ["Theta soc. coop. a r.l.", "Theta", "COOP"],
    ["Iota Società a Responsabilità Limitata", "Iota", "SRL"],
    ["Verdi Costruzioni", "Verdi Costruzioni", null],
  ];
  for (const [input, expectedName, expectedForm] of cases) {
    it(`"${input}" -> "${expectedName}" (${expectedForm})`, () => {
      const n = normalizeCompany({ legalName: input });
      expect(n.normalizedName).toBe(expectedName);
      expect(n.companyForm).toBe(expectedForm);
      expect(n.legalName).toBe(input.replace(/\s+/g, " ").trim()); // legalName conserva la forma
    });
  }
});

describe("normalizeCompany — accenti, apostrofi, encoding", () => {
  it("mantiene gli accenti, normalizza apostrofi tipografici e spazi", () => {
    const n = normalizeCompany({ legalName: "  Società  Città  d’Arte   S.r.l. " });
    expect(n.legalName).toBe("Società Città d'Arte S.r.l.");
    expect(n.normalizedName).toBe("Società Città d'Arte");
    expect(n.companyForm).toBe("SRL");
  });
});

describe("normalizeCompany — campi", () => {
  it("normalizza pec, sito, provincia; valida la P.IVA", () => {
    const n = normalizeCompany({
      legalName: "Alfa Costruzioni S.r.l.",
      pec: "  Alfa@PEC.IT ",
      website: "http://www.alfacostruzioni.it/chi-siamo",
      province: "Milano",
      vatNumber: "IT-00743110157",
      sector: "  Costruzioni  ",
    });
    expect(n.pec).toBe("alfa@pec.it");
    expect(n.website).toBe("https://alfacostruzioni.it");
    expect(n.province).toBe("MI");
    expect(n.provinceName).toBe("Milano");
    expect(n.vatNumber).toBe("00743110157");
    expect(n.vatNumberRaw).toBe("IT-00743110157");
    expect(n.sector).toBe("Costruzioni");
  });

  it("P.IVA non valida -> null ma vatNumberRaw conservato", () => {
    const n = normalizeCompany({ legalName: "X", vatNumber: "12345678901" });
    expect(n.vatNumber).toBeNull();
    expect(n.vatNumberRaw).toBe("12345678901");
  });

  it("pec / sito malformati -> null", () => {
    const n = normalizeCompany({ legalName: "X", pec: "non-una-pec", website: "n/d" });
    expect(n.pec).toBeNull();
    expect(n.website).toBeNull();
  });
});

describe("computeDedupeHash", () => {
  it("è stabile e indipendente dal case del nome", () => {
    const a = normalizeCompany({ legalName: "ALFA COSTRUZIONI SRL", province: "MI" });
    const b = normalizeCompany({ legalName: "Alfa Costruzioni S.r.l.", province: "Milano" });
    expect(a.dedupeHash).toBe(b.dedupeHash);
  });
  it("cambia se cambia la P.IVA", () => {
    const h1 = computeDedupeHash({
      normalizedName: "Alfa",
      province: "MI",
      pec: null,
      vatNumber: null,
    });
    const h2 = computeDedupeHash({
      normalizedName: "Alfa",
      province: "MI",
      pec: null,
      vatNumber: "00743110157",
    });
    expect(h1).not.toBe(h2);
  });
});
