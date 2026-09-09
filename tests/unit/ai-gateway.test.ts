import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: vi.fn() },
    aiUsage: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings";
import {
  AiBudgetExceededError,
  AiOutputInvalidError,
  generateDomainCandidates,
} from "@/services/ai-gateway";
import type { AiProvider } from "@/services/ai-gateway/providers";

// biome-ignore lint/suspicious/noExplicitAny: helper di test sui mock
const asMock = (fn: unknown) => fn as any;

const VALID = JSON.stringify({
  candidates: [{ sld: "alfa", extension: "it", score: 80, confidence: 70, reason: "match brand" }],
});

function mockProvider(raws: string[]): AiProvider & { complete: ReturnType<typeof vi.fn> } {
  let i = 0;
  const complete = vi.fn(async () => ({
    raw: raws[Math.min(i++, raws.length - 1)] ?? "",
    model: "mock-model",
    latencyMs: 5,
    usage: { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
  }));
  return { name: "mock", complete };
}

const INPUT = {
  legalName: "Alfa Costruzioni S.r.l.",
  normalizedName: "Alfa Costruzioni",
  companyForm: "SRL",
  province: "MI",
  provinceName: "Milano",
  sector: null,
  websiteHost: null,
  allowedExtensions: ["it", "com"],
  maxCandidates: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  clearSettingsCache();
  asMock(db.setting.findUnique).mockResolvedValue(null); // -> DEFAULTS
  asMock(db.aiUsage.aggregate).mockResolvedValue({ _sum: { costUsd: 0 } });
  asMock(db.aiUsage.create).mockResolvedValue({});
});

describe("generateDomainCandidates", () => {
  it("output valido -> ritorna i candidati e registra AiUsage (success)", async () => {
    const provider = mockProvider([VALID]);
    const out = await generateDomainCandidates(INPUT, { provider, companyId: "c1" });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]?.sld).toBe("alfa");
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(db.aiUsage.create).toHaveBeenCalledTimes(1);
    expect(asMock(db.aiUsage.create).mock.calls[0][0].data.success).toBe(true);
  });

  it("output invalido poi valido -> 1 retry, poi successo", async () => {
    const provider = mockProvider(["non json", VALID]);
    const out = await generateDomainCandidates(INPUT, { provider });
    expect(out.candidates).toHaveLength(1);
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(db.aiUsage.create).toHaveBeenCalledTimes(2); // 1 fail + 1 success
  });

  it("sempre invalido -> AiOutputInvalidError dopo 2 tentativi", async () => {
    const provider = mockProvider(["{ rotto", '{"candidates":[]}']);
    await expect(generateDomainCandidates(INPUT, { provider })).rejects.toBeInstanceOf(
      AiOutputInvalidError,
    );
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it("budget superato -> AiBudgetExceededError, provider non chiamato", async () => {
    asMock(db.aiUsage.aggregate).mockResolvedValue({ _sum: { costUsd: 999 } });
    const provider = mockProvider([VALID]);
    await expect(generateDomainCandidates(INPUT, { provider })).rejects.toBeInstanceOf(
      AiBudgetExceededError,
    );
    expect(provider.complete).not.toHaveBeenCalled();
  });
});
