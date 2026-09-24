import { NextRequest, NextResponse } from "next/server";
import { runAiChat, extractJson, AiError } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  apiKey?: string;
  provider?: string;
  model?: string;
  target?: string;
  digest?: string;
};

const PLAN_SYSTEM_PROMPT = `You are KAI-SEC's attack planner. You receive a recon digest of a target the operator has declared authorized to test, plus the list of attack tools available in this suite.

Available in-suite tools (choose ONLY from these):
- scan <target> [--deep]                  — passive/light recon + AI report
- nmap <host> [-sV] [-sC] [-O] [-A] [-p <spec>] [--top-ports N] [-T0..T5]
- sqlmap -u <url> [--data "a=b"] [--level 1-5] [--dbms mysql|postgres|mssql|sqlite] [--technique EBTU] [-p param]
- dirb <url> [-w small|common|big] [-x php,bak] [-t N]   (or gobuster dir -u <url> -w <list>)
- nikto <url>                             — web server misconfig/exposure scan
- wpscan <url>                            — ONLY if WordPress detected
- searchsploit <terms>                    — offline exploit DB lookup (no traffic)

Rules:
1. Produce 3-6 ordered steps that form a sensible web pentest progression (enumerate → fingerprint → probe → verify).
2. Every command must be runnable as-is with the syntax above. Always use the recon-confirmed scheme (http/https) and the real target host in URLs.
3. nmap on public targets: prefer --top-ports 100 -sV -sC -T4. sqlmap: start at --level 2. dirb: default wordlist.
4. Do NOT include destructive payloads, DoS, credential brute-forcing (hydra) or anything beyond the listed tools.
5. Each step needs a short "why" referencing an actual observation from the digest (a port, a tech, a header).
6. Mark risk: "low" (enumeration), "medium" (active probing), "high" (injection testing).
7. If the digest shows nothing interesting, still produce the most valuable verification steps.

Respond with STRICT JSON only, no markdown fences:
{
  "steps": [
    { "n": 1, "tool": "nmap", "args": ["target-host", "-sV", "-sC", "--top-ports", "100", "-T4"], "why": "one sentence tied to digest evidence", "risk": "low|medium|high" }
  ]
}`;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const apiKey = (body.apiKey ?? "").trim();
  const target = (body.target ?? "").trim();
  const digest = (body.digest ?? "").slice(0, 60_000);

  if (!target || !digest) return NextResponse.json({ ok: false, error: "Missing target or digest." }, { status: 400 });

  try {
    const result = await runAiChat({
      provider: (body.provider as "openai" | "openrouter" | "auto") ?? "auto",
      apiKey,
      model: body.model,
      temperature: 0.3,
      maxTokens: 1400,
      messages: [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        { role: "user", content: `TARGET: ${target}\n\nRECON DIGEST:\n${digest}\n\nProduce the attack toolchain plan as strict JSON.` },
      ],
    });

    const parsed = extractJson(result.text) as { steps?: unknown } | null;
    const rawSteps = Array.isArray(parsed?.steps) ? (parsed!.steps as Array<Record<string, unknown>>) : [];
    const ALLOWED = new Set(["scan", "nmap", "sqlmap", "dirb", "gobuster", "nikto", "wpscan", "searchsploit"]);
    const steps = rawSteps
      .map((s, i) => ({
        n: typeof s.n === "number" ? s.n : i + 1,
        tool: ALLOWED.has(String(s.tool)) ? String(s.tool) : "scan",
        args: Array.isArray(s.args) ? (s.args as unknown[]).map(String).slice(0, 16) : [],
        why: typeof s.why === "string" ? s.why : "",
        risk: ["low", "medium", "high"].includes(String(s.risk)) ? String(s.risk) : "medium",
      }))
      .filter((s) => s.args.length > 0)
      .slice(0, 8)
      .map((s, i) => ({ ...s, n: i + 1 }));

    if (steps.length === 0) {
      return NextResponse.json({ ok: false, error: "AI returned no usable steps. Try again or use manual commands." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, plan: { steps }, meta: result.meta });
  } catch (e) {
    const msg = e instanceof AiError || e instanceof Error ? e.message : "plan failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
