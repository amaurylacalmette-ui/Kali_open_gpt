import { NextRequest, NextResponse } from "next/server";
import { detectProvider } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { apiKey?: string; provider?: "openai" | "openrouter" | "auto" };

/** Verifies a BYO key against the provider without spending chat tokens. */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const key = (body.apiKey ?? "").trim();
  if (!key) return NextResponse.json({ ok: false, error: "empty key" }, { status: 400 });

  const detected = detectProvider(key);
  const provider =
    body.provider && body.provider !== "auto" ? body.provider : detected === "unknown" ? null : detected;

  if (!provider) {
    return NextResponse.json(
      { ok: false, error: "Unrecognized key prefix. OpenAI keys start with sk-, OpenRouter keys with sk-or-." },
      { status: 400 }
    );
  }

  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        return NextResponse.json({ ok: true, provider, detail: "Key valid — OpenAI account reachable." });
      }
      const detail = res.status === 401 ? "Invalid key (401 Unauthorized)." : `OpenAI responded HTTP ${res.status}.`;
      return NextResponse.json({ ok: false, provider, error: detail }, { status: 200 });
    }

    // OpenRouter — /api/v1/auth/key returns rate-limit/usage info
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const j = await res.json().catch(() => null);
      const info = (j as { data?: Record<string, unknown> })?.data ?? {};
      const usage = typeof info.usage === "number" ? `$${(info.usage as number).toFixed(4)} used` : "usage n/a";
      const limit = info.limit === null || info.limit === undefined ? "no hard limit" : `$${info.limit} limit`;
      const freeTier = info.is_free_tier ? " · free tier" : "";
      return NextResponse.json({ ok: true, provider, detail: `Key valid — ${usage} · ${limit}${freeTier}` });
    }
    const detail = res.status === 401 ? "Invalid key (401 Unauthorized)." : `OpenRouter responded HTTP ${res.status}.`;
    return NextResponse.json({ ok: false, provider, error: detail }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "verification failed" }, { status: 200 });
  }
}
