/**
 * OpenRouter helper — resolves the BEST AVAILABLE FREE MODEL.
 * Strategy: pull the live model catalogue, keep only $0/$0 text→text models,
 * rank by a curated capability tier-list + context-length bonus, cache 10 min.
 */

export type RankedModel = {
  id: string;
  name: string;
  contextLength: number;
  score: number;
  tier: string;
};

type ORModel = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[]; modality?: string };
};

/** Curated tier-list for security-analysis workloads (reasoning + long context + code). */
const TIER_LIST: Array<{ match: string; weight: number; tier: string }> = [
  { match: "deepseek/deepseek-chat", weight: 100, tier: "flagship" },      // DeepSeek V3.x — strongest free generalist
  { match: "deepseek/deepseek-v3", weight: 99, tier: "flagship" },         // V3.1 / V3 update ids
  { match: "deepseek/deepseek-r1", weight: 97, tier: "reasoning" },        // R1 — deep reasoning (slower)
  { match: "qwen/qwen3-235b", weight: 95, tier: "flagship" },              // Qwen3 235B A22B free
  { match: "qwen/qwen3-coder", weight: 93, tier: "code" },
  { match: "google/gemini-2.5-flash", weight: 88, tier: "fast" },
  { match: "google/gemini-2.0-flash-exp:free", weight: 86, tier: "fast" },
  { match: "meta-llama/llama-4-maverick", weight: 90, tier: "flagship" },
  { match: "meta-llama/llama-4-scout", weight: 84, tier: "strong" },
  { match: "meta-llama/llama-3.3-70b", weight: 82, tier: "strong" },
  { match: "qwen/qwen-2.5-72b-instruct:free", weight: 78, tier: "strong" },
  { match: "mistralai/mistral-small", weight: 74, tier: "solid" },
  { match: "mistralai/mistral-nemo", weight: 70, tier: "solid" },
  { match: "qwen/qwen3-30b", weight: 72, tier: "solid" },
  { match: "gemma-3-27b", weight: 60, tier: "light" },
];

/** Generic capability heuristics so ANY free-model catalogue ranks sensibly,
 *  even when it contains families outside the curated tier-list. */
function sizeScore(hay: string): number {
  const m = hay.match(/(\d+(?:\.\d+)?)\s*b\b/i);
  if (!m) return 0;
  const b = parseFloat(m[1]);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return Math.min(62, Math.log2(b) * 7.5); // 4b≈15 · 8b≈22.5 · 27b≈35 · 70b≈46 · 235b≈59 · 550b→cap
}

function keywordAdjust(hay: string): { delta: number; tier: string } {
  if (/embed|rerank|whisper|tts|voice|image|video|veo|sora|vision-only/i.test(hay)) return { delta: -999, tier: "excluded" };
  let delta = 0;
  let tier = "generic";
  if (/ultra|largest|big\b|max\b|pro\b/.test(hay)) { delta += 7; tier = "flagship"; }
  if (/coder|code\b|reason|thinking|r1|thinking-\b/.test(hay)) { delta += 5; tier = "reasoning"; }
  if (/large|instruct|base-\b|novice|scholar/.test(hay)) delta += 2;
  if (/lite|mini|nano|tiny|small|micro|preview|experimental|exp\b|beta|test|dev\b|draft/.test(hay)) { delta -= 14; tier = "light"; }
  if (/preview/.test(hay)) delta -= 3; // extra penalty: may disappear
  return { delta, tier };
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; models: RankedModel[] } | null = null;

function scoreModel(m: ORModel): { score: number; tier: string } {
  const id = m.id.toLowerCase();
  const name = (m.name ?? "").toLowerCase();
  const hay = `${id} ${name}`;

  // modality sanity: must output text
  const outMods = m.architecture?.output_modalities ?? ["text"];
  if (!outMods.includes("text")) return { score: -1, tier: "excluded" };
  if (/embed|rerank|whisper|tts|image-gen|veo|sora/i.test(id)) return { score: -1, tier: "excluded" };

  const ctx = m.context_length ?? 8192;
  const ctxBonus = Math.min(ctx / 65_000, 8); // up to +8 for 512k+ ctx
  const freeSuffix = id.endsWith(":free") ? 2 : 0;

  // 1) curated family match wins outright
  for (const t of TIER_LIST) {
    if (id.includes(t.match)) {
      return { score: t.weight + ctxBonus + freeSuffix, tier: t.tier };
    }
  }

  // 2) generic heuristic ranking for unknown families
  const kw = keywordAdjust(hay);
  if (kw.delta <= -999) return { score: -1, tier: "excluded" };
  const sz = sizeScore(hay);
  const base = 20 + sz + kw.delta + ctxBonus + freeSuffix;
  return { score: base, tier: kw.tier };
}

export async function fetchRankedFreeModels(apiKey?: string): Promise<RankedModel[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OpenRouter catalogue unavailable (HTTP ${res.status})`);
  const json = (await res.json()) as { data?: ORModel[] };
  const all = json.data ?? [];

  const free = all.filter((m) => {
    const p = m.pricing;
    if (!p) return false;
    const prompt = parseFloat(p.prompt ?? "1");
    const completion = parseFloat(p.completion ?? "1");
    return prompt === 0 && completion === 0;
  });

  const ranked: RankedModel[] = free
    .map((m) => {
      const { score, tier } = scoreModel(m);
      return {
        id: m.id,
        name: m.name ?? m.id,
        contextLength: m.context_length ?? 0,
        score,
        tier,
      } satisfies RankedModel;
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.contextLength - a.contextLength);

  if (ranked.length === 0) throw new Error("No free models currently listed on OpenRouter.");
  cache = { at: Date.now(), models: ranked };
  return ranked;
}

export async function resolveBestFreeModel(apiKey?: string): Promise<{ best: RankedModel; candidates: RankedModel[] }> {
  const models = await fetchRankedFreeModels(apiKey);
  return { best: models[0], candidates: models.slice(0, 8) };
}

/** Detect provider from key prefix. */
export function detectProvider(key: string): "openai" | "openrouter" | "unknown" {
  const k = key.trim();
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("sk-")) return "openai";
  return "unknown";
}
