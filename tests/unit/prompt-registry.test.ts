import { loadPrompt } from "@/services/ai-gateway/prompt-registry";
import { describe, expect, it } from "vitest";

describe("loadPrompt", () => {
  it("carica domain-discovery-v1 (prompt.md + meta.json)", () => {
    const p = loadPrompt("domain-discovery", "v1");
    expect(p.system.length).toBeGreaterThan(200);
    expect(p.system.toLowerCase()).toContain("dominio");
    expect(p.meta.callType).toBe("DOMAIN_DISCOVERY");
    expect(p.meta.defaultModel).toBe("claude-haiku-4-5");
    expect(p.meta.maxTokens).toBeGreaterThan(0);
  });

  it("mette in cache (stesso riferimento alla seconda chiamata)", () => {
    expect(loadPrompt("domain-discovery", "v1")).toBe(loadPrompt("domain-discovery", "v1"));
  });

  it("versione inesistente -> errore", () => {
    expect(() => loadPrompt("domain-discovery", "v99")).toThrow();
  });
});
