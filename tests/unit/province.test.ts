import { normalizeProvince } from "@/lib/geo/province";
import { describe, expect, it } from "vitest";

describe("normalizeProvince", () => {
  it("riconosce la sigla", () => {
    expect(normalizeProvince("MI")).toEqual({ code: "MI", name: "Milano" });
    expect(normalizeProvince(" rm ")).toEqual({ code: "RM", name: "Roma" });
  });

  it("riconosce la denominazione", () => {
    expect(normalizeProvince("Milano")?.code).toBe("MI");
    expect(normalizeProvince("MILANO")?.code).toBe("MI");
    expect(normalizeProvince("Reggio Emilia")?.code).toBe("RE");
  });

  it("gestisce accenti e denominazioni estese/storiche", () => {
    expect(normalizeProvince("Forlì-Cesena")?.code).toBe("FC");
    expect(normalizeProvince("Reggio nell'Emilia")?.code).toBe("RE");
    expect(normalizeProvince("Valle d'Aosta")?.code).toBe("AO");
    expect(normalizeProvince("Monza e della Brianza")?.code).toBe("MB");
    expect(normalizeProvince("Massa-Carrara")?.code).toBe("MS");
  });

  it("gestisce prefissi e suffissi comuni", () => {
    expect(normalizeProvince("Provincia di Milano")?.code).toBe("MI");
    expect(normalizeProvince("Milano (MI)")?.code).toBe("MI");
  });

  it("ritorna null se non riconosciuta", () => {
    expect(normalizeProvince("")).toBeNull();
    expect(normalizeProvince("XX")).toBeNull();
    expect(normalizeProvince("Estero")).toBeNull();
    expect(normalizeProvince(null)).toBeNull();
  });
});
