import type { DiscoveryCandidate } from "@/prompts/domain-discovery-v1/schema";
import { postProcessCandidates } from "@/services/domain-discovery/post-process";
import { describe, expect, it } from "vitest";

const c = (over: Partial<DiscoveryCandidate>): DiscoveryCandidate => ({
  sld: "alfacostruzioni",
  extension: "it",
  score: 80,
  confidence: 70,
  reason: "match brand",
  ...over,
});

describe("postProcessCandidates", () => {
  it("tiene l'estensione se ammessa, costruisce l'fqdn", () => {
    const out = postProcessCandidates([c({ extension: "it" })], ["it", "com"], 5);
    expect(out).toHaveLength(1);
    expect(out[0]?.fqdn).toBe("alfacostruzioni.it");
    expect(out[0]?.sld).toBe("alfacostruzioni");
  });

  it("scarta l'estensione NON ammessa", () => {
    const out = postProcessCandidates([c({ sld: "alfa", extension: "eu" })], ["it", "com"], 5);
    expect(out).toHaveLength(0);
  });

  it("estensione vuota -> espansione su tutte le ammesse", () => {
    const out = postProcessCandidates([c({ sld: "alfa", extension: "" })], ["it", "com"], 5);
    expect(out.map((x) => x.fqdn).sort()).toEqual(["alfa.com", "alfa.it"]);
  });

  it("estensione dentro l'sld ('alfa.it') viene separata", () => {
    const out = postProcessCandidates([c({ sld: "alfa.it", extension: "" })], ["it", "com"], 5);
    expect(out.some((x) => x.fqdn === "alfa.it")).toBe(true);
  });

  it("punycode per SLD con accenti", () => {
    const out = postProcessCandidates([c({ sld: "caffè", extension: "it" })], ["it"], 5);
    expect(out[0]?.fqdn).toBe("xn--caff-8oa.it");
  });

  it("dedup per fqdn, tiene lo score più alto", () => {
    const out = postProcessCandidates(
      [
        c({ sld: "alfa", extension: "it", score: 40 }),
        c({ sld: "alfa", extension: "it", score: 90 }),
      ],
      ["it"],
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.score).toBe(90);
  });

  it("SLD non valido -> scartato; spazi rimossi", () => {
    const bad = postProcessCandidates([c({ sld: "-alfa-", extension: "it" })], ["it"], 5);
    expect(bad).toHaveLength(0);
    const spaced = postProcessCandidates(
      [c({ sld: "alfa costruzioni", extension: "it" })],
      ["it"],
      5,
    );
    expect(spaced[0]?.fqdn).toBe("alfacostruzioni.it");
  });

  it("ordina per score desc e taglia a maxCandidates", () => {
    const input = [
      c({ sld: "a", score: 10 }),
      c({ sld: "b", score: 90 }),
      c({ sld: "cc", score: 50 }),
    ];
    const out = postProcessCandidates(input, ["it"], 2);
    expect(out.map((x) => x.sld)).toEqual(["b", "cc"]);
  });

  it("score/confidence fuori range -> clamp 0..100", () => {
    const out = postProcessCandidates([c({ score: 250, confidence: -5 })], ["it"], 5);
    expect(out[0]?.score).toBe(100);
    expect(out[0]?.confidence).toBe(0);
  });
});
