import { NextRequest, NextResponse } from "next/server";
import { resolveBestFreeModel, fetchRankedFreeModels } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/openrouter/models          → best free model + top candidates
 * GET /api/openrouter/models?all=1    → full ranked free list
 * Optional ?key=sk-or-… to validate against the user's account scope.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? undefined;
  const all = req.nextUrl.searchParams.get("all") === "1";
  try {
    const { best, candidates } = await resolveBestFreeModel(key);
    const list = all ? await fetchRankedFreeModels(key) : candidates;
    return NextResponse.json({
      ok: true,
      best,
      candidates: list.slice(0, all ? 25 : 8).map((m) => ({
        id: m.id,
        name: m.name,
        contextLength: m.contextLength,
        tier: m.tier,
        score: Math.round(m.score * 10) / 10,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "failed to resolve free models" },
      { status: 502 }
    );
  }
}
