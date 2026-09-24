import { detectProvider, resolveBestFreeModel, type RankedModel } from "./openrouter";
import ZAI from "z-ai-web-dev-sdk";

/**
 * AI layer — BYO key with an always-available built-in engine underneath.
 * OpenAI keys hit api.openai.com; OpenRouter keys automatically ride the best
 * available FREE model (with fallback chain); anything that fails (or no key
 * at all) falls back to the built-in KAI-SEC engine so the AI NEVER hangs dead.
 */

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiMeta = {
  provider: "openai" | "openrouter" | "builtin";
  model: string;
  modelLabel?: string;
  fallbackUsed?: boolean;
  /** why the built-in engine answered instead of the user's provider */
  fallbackReason?: string;
};

export type AiResult = { text: string; meta: AiMeta };

const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

type ChatArgs = {
  provider: "openai" | "openrouter" | "auto";
  apiKey: string;
  messages: ChatMessage[];
  /** explicit model override (used for OpenAI; ignored for OpenRouter auto mode) */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  forceJson?: boolean;
};

function endpointFor(provider: "openai" | "openrouter"): string {
  return provider === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";
}

function headersFor(provider: "openai" | "openrouter", apiKey: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (provider === "openrouter") {
    h["HTTP-Referer"] = "https://kali-ai-pentest-suite.local";
    h["X-Title"] = "Kali AI Pentest Suite";
  }
  return h;
}

async function callOnce(
  provider: "openai" | "openrouter",
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; forceJson?: boolean }
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.forceJson && provider === "openai") {
    body.response_format = { type: "json_object" };
  }
  if (opts.forceJson && provider === "openrouter") {
    // some free models ignore this; we still ask and parse defensively
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(endpointFor(provider), {
    method: "POST",
    headers: headersFor(provider, apiKey),
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error?.message ?? JSON.stringify(j).slice(0, 300);
    } catch {
      detail = await res.text().catch(() => "");
    }
    const err = new AiError(`HTTP ${res.status}: ${detail.slice(0, 400)}`);
    (err as AiError & { status?: number }).status = res.status;
    throw err;
  }

  const json = await res.json();
  const choice = json?.choices?.[0];
  const text: string =
    choice?.message?.content ??
    choice?.message?.reasoning ??
    (Array.isArray(choice?.message?.content)
      ? choice.message.content.map((c: { text?: string }) => c.text ?? "").join("")
      : "");
  if (!text) throw new AiError("Model returned an empty response.");
  return text;
}

/* --------------------------- built-in engine ------------------------------ */

export const BUILTIN_MODEL_LABEL = "KAI-SEC built-in";

type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>;
let zaiSingleton: ZaiClient | null = null;

async function getZai(): Promise<ZaiClient> {
  if (!zaiSingleton) {
    try {
      zaiSingleton = await ZAI.create();
    } catch {
      throw new AiError(
        "Built-in engine is not configured on this server: provide a .z-ai-config file (JSON with baseUrl + apiKey, see README) or add an OpenAI/OpenRouter key in the KEY VAULT."
      );
    }
  }
  return zaiSingleton;
}

async function callBuiltin(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const zai = await getZai();
  const work = zai.chat.completions.create({
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens,
    thinking: { type: "disabled" as const },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new AiError("Built-in engine timed out after 90s.")), 90_000);
  });
  try {
    const res = (await Promise.race([work, timeout])) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text: string = res?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new AiError("Built-in engine returned an empty response.");
    return text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Main entry — try the user's provider first (if a key is present), then fall
 * back to the built-in engine. Never leaves the operator hanging: bounded
 * timeouts, bounded retry chain, guaranteed last-resort engine.
 */
export async function runAiChat(args: ChatArgs): Promise<AiResult> {
  const key = args.apiKey.trim();

  type Attempt = { provider: "openai" | "openrouter"; apiKey: string; model?: string };
  const attempts: Attempt[] = [];
  if (key) {
    const detected =
      args.provider === "auto" ? detectProvider(key) : (args.provider as "openai" | "openrouter");
    if (detected === "openai")
      attempts.push({ provider: "openai", apiKey: key, model: args.model?.trim() || OPENAI_DEFAULT_MODEL });
    else if (detected === "openrouter") attempts.push({ provider: "openrouter", apiKey: key });
  }

  const deadline = Date.now() + 150_000;
  let lastErr: unknown = null;

  for (const a of attempts) {
    if (Date.now() > deadline) break;
    try {
      if (a.provider === "openai") {
        const model = a.model ?? OPENAI_DEFAULT_MODEL;
        try {
          const text = await callOnce("openai", a.apiKey, model, args.messages, {
            temperature: args.temperature,
            maxTokens: args.maxTokens,
            forceJson: args.forceJson,
          });
          return { text, meta: { provider: "openai", model } };
        } catch (e) {
          if (
            e instanceof AiError &&
            /404|does not exist|model_not_found/i.test(e.message) &&
            a.model &&
            a.model !== OPENAI_DEFAULT_MODEL
          ) {
            const text = await callOnce("openai", a.apiKey, OPENAI_DEFAULT_MODEL, args.messages, {
              temperature: args.temperature,
              maxTokens: args.maxTokens,
              forceJson: args.forceJson,
            });
            return { text, meta: { provider: "openai", model: OPENAI_DEFAULT_MODEL, fallbackUsed: true } };
          }
          throw e;
        }
      }

      // ---- OpenRouter: always best available FREE model ----
      const { best, candidates } = await resolveBestFreeModel(a.apiKey);
      const chain: RankedModel[] = [best, ...candidates.filter((c) => c.id !== best.id).slice(0, 2)];
      for (let i = 0; i < chain.length; i++) {
        if (Date.now() > deadline) break;
        const m = chain[i];
        try {
          const text = await callOnce("openrouter", a.apiKey, m.id, args.messages, {
            temperature: args.temperature,
            maxTokens: args.maxTokens,
            forceJson: args.forceJson,
          });
          return {
            text,
            meta: {
              provider: "openrouter",
              model: m.id,
              modelLabel: `${m.name} · ctx ${
                m.contextLength >= 1000 ? Math.round(m.contextLength / 1000) + "k" : m.contextLength
              } · tier ${m.tier}`,
              fallbackUsed: i > 0,
            },
          };
        } catch (e) {
          lastErr = e;
          const status = (e as { status?: number }).status;
          if (status === 401 || status === 403) break; // bad key — no point trying other models
          continue; // rate-limited / model error → next free model
        }
      }
    } catch (e) {
      lastErr = e;
    }
  }

  // ---- built-in engine: always available, never hangs dead ----
  const reason = !key
    ? "no API key in vault — built-in KAI-SEC engine answered"
    : `your engine failed (${lastErr instanceof Error ? lastErr.message.slice(0, 160) : "unknown error"}) — built-in KAI-SEC engine answered instead`;
  const text = await callBuiltin(args.messages, {
    temperature: args.temperature,
    maxTokens: args.maxTokens,
  });
  return {
    text,
    meta: {
      provider: "builtin",
      model: BUILTIN_MODEL_LABEL,
      fallbackUsed: attempts.length > 0,
      fallbackReason: reason,
    },
  };
}

/* ------------------------- vulnerability analyst -------------------------- */

export const ANALYST_SYSTEM_PROMPT = `You are KAI-SEC, an elite offensive-security analyst and penetration-testing copilot embedded in a Kali Linux environment. You receive reconnaissance output collected by automated tooling against a target the operator has declared they are authorized to test.

Your job: produce a rigorous, EVIDENCE-BASED vulnerability assessment. Rules:
1. Only report findings supported by evidence in the provided recon data. If you infer something, mark it "inference" and explain the reasoning.
2. Do NOT invent CVEs. Only cite a CVE id when the evidence (e.g. a version banner) makes the mapping well-established, and explain the mapping.
3. Rate severity: Critical / High / Medium / Low / Info using CVSS-style impact thinking.
4. Every finding must include: concrete evidence (quote the recon line), attacker-relevant impact, and a specific remediation (config snippet, header value, or action).
5. Suggest concrete next-step commands. The operator can run these IN-SUITE immediately: nmap (-sV -sC -O -p), sqlmap (-u <url> [--data "a=b"] --level), dirb/gobuster (content discovery), nikto, wpscan, searchsploit, scan (recon). Prefer ready-to-run invocations of these (e.g. "sqlmap -u https://target/item?id=3 --level=2", "dirb https://target -w common") — clearly framed as authorized-testing next steps.
6. If recon data is thin, say so and prioritize the highest-value enumeration steps.

Respond with STRICT JSON only, no markdown fences, matching exactly:
{
  "summary": "3-5 sentence executive summary",
  "riskScore": 0-10,
  "posture": "one-line overall security posture verdict",
  "findings": [
    {
      "id": "F-01",
      "title": "short finding title",
      "severity": "Critical|High|Medium|Low|Info",
      "category": "e.g. Transport Security | Headers | Exposure | Infrastructure | Email | Web App",
      "evidence": "quoted evidence from recon data (or 'inference: ...')",
      "description": "2-4 sentences on the weakness",
      "impact": "what an attacker could do",
      "remediation": "specific fix",
      "cve": "CVE-YYYY-NNNN or null"
    }
  ],
  "nextSteps": ["command or action 1", "command or action 2"]
}`;

/** Best-effort repair of JSON truncated mid-generation (token cap): close open strings/brackets. */
function repairTruncatedJson(s: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return out;
}

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* fallthrough */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch { /* fallthrough */ }
  }
  if (start !== -1) {
    // likely truncated by token cap — try bracket-balanced repair
    try {
      return JSON.parse(repairTruncatedJson(cleaned.slice(start)));
    } catch { /* fallthrough */ }
  }
  throw new AiError("Model did not return parseable JSON.");
}

export function extractFindings(parsed: unknown): {
  summary: string;
  riskScore: number;
  posture: string;
  findings: Array<{
    id: string; title: string; severity: string; category: string;
    evidence: string; description: string; impact: string; remediation: string; cve?: string | null;
  }>;
  nextSteps: string[];
} {
  const o = parsed as Record<string, unknown>;
  const sevRank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
  const rawFindings = Array.isArray(o.findings) ? (o.findings as Array<Record<string, unknown>>) : [];
  const findings = rawFindings
    .map((f, i) => ({
      id: typeof f.id === "string" ? f.id : `F-${String(i + 1).padStart(2, "0")}`,
      title: typeof f.title === "string" ? f.title : "Untitled finding",
      severity: sevRank[String(f.severity)] !== undefined ? String(f.severity) : "Info",
      category: typeof f.category === "string" ? f.category : "General",
      evidence: typeof f.evidence === "string" ? f.evidence : "—",
      description: typeof f.description === "string" ? f.description : "",
      impact: typeof f.impact === "string" ? f.impact : "",
      remediation: typeof f.remediation === "string" ? f.remediation : "",
      cve: typeof f.cve === "string" && f.cve !== "null" ? f.cve : null,
    }))
    .sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
  return {
    summary: typeof o.summary === "string" ? o.summary : "",
    riskScore: typeof o.riskScore === "number" ? Math.max(0, Math.min(10, o.riskScore)) : 5,
    posture: typeof o.posture === "string" ? o.posture : "",
    findings,
    nextSteps: Array.isArray(o.nextSteps) ? (o.nextSteps as unknown[]).map(String).slice(0, 10) : [],
  };
}
