import { NextRequest, NextResponse } from "next/server";
import { runAiChat, ANALYST_SYSTEM_PROMPT, extractJson, extractFindings, AiError } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  apiKey?: string;
  provider?: "auto" | "openai" | "openrouter";
  model?: string;
  target?: string;
  digest?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const apiKey = (body.apiKey ?? "").trim();
  const target = (body.target ?? "").trim();
  const digest = (body.digest ?? "").trim();

  if (!target) return NextResponse.json({ ok: false, error: "missing target" }, { status: 400 });
  if (!digest) return NextResponse.json({ ok: false, error: "missing recon digest — run a scan first" }, { status: 400 });

  try {
    const result = await runAiChat({
      provider: body.provider ?? "auto",
      apiKey,
      model: body.model,
      temperature: 0.15,
      maxTokens: 6500,
      forceJson: true,
      messages: [
        { role: "system", content: ANALYST_SYSTEM_PROMPT },
        {
          role: "user",
          content: `TARGET UNDER AUTHORIZED ASSESSMENT: ${target}\n\nRECON DIGEST (automated collection):\n${digest.slice(0, 60_000)}\n\nProduce the vulnerability assessment JSON now.`,
        },
      ],
    });

    let findings;
    try {
      findings = extractFindings(extractJson(result.text));
    } catch {
      // model ignored JSON instruction — return raw text so UI can still display it
      return NextResponse.json({ ok: true, raw: result.text.slice(0, 20_000), meta: result.meta, jsonParsed: false });
    }

    return NextResponse.json({ ok: true, report: findings, meta: result.meta, jsonParsed: true });
  } catch (e) {
    const msg = e instanceof AiError || e instanceof Error ? e.message : "AI analysis failed";
    const status = e instanceof AiError && /401|403|No API key/i.test(e.message) ? 401 : 502;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
