import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Registro prompt versionati (sezione 27 / H.3).
 * Ogni prompt vive in /prompts/<name>-<version>/ con prompt.md + meta.json.
 * Nessun prompt importante hardcodato altrove.
 */
const PROMPTS_DIR = join(process.cwd(), "prompts");

export interface PromptMeta {
  name: string;
  version: string;
  callType: string;
  defaultModel: string;
  maxTokens: number;
  thinking?: "off" | "adaptive-low";
  changelog?: string[];
}

export interface LoadedPrompt {
  name: string;
  version: string;
  /** contenuto di prompt.md — è il system prompt (stabile => cacheabile) */
  system: string;
  meta: PromptMeta;
}

const cache = new Map<string, LoadedPrompt>();

export function loadPrompt(name: string, version: string): LoadedPrompt {
  const key = `${name}@${version}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const dir = join(PROMPTS_DIR, `${name}-${version}`);
  const system = readFileSync(join(dir, "prompt.md"), "utf8").trim();
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as PromptMeta;

  const loaded: LoadedPrompt = { name, version, system, meta };
  cache.set(key, loaded);
  return loaded;
}
