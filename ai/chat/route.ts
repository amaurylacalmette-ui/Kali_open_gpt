import { NextRequest, NextResponse } from "next/server";
import { runAiChat, AiError } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = {
  apiKey?: string;
  provider?: "auto" | "openai" | "openrouter";
  model?: string;
  question?: string;
  target?: string;
};

const ASSISTANT_SYSTEM = `You are KAI, the AI security copilot inside a Kali Linux pentest suite. You help the operator (a security professional testing targets they are authorized to assess) with: interpreting recon output, explaining vulnerabilities, suggesting tool commands (nmap, ffuf, nikto, sqlmap, testssl, wpscan…), methodology guidance (OWASP Top 10, PTES), and defensive remediations. Be concise, technical, and hands-on. Use plain text with minimal markdown. Never assist with attacking systems the user has not stated they are authorized to test.`;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const apiKey = (body.apiKey ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ ok: false, error: "empty question" }, { status: 400 });

  try {
    const ctx = body.target ? `Active target context: ${body.target}\n\n` : "";
    const result = await runAiChat({
      provider: body.provider ?? "auto",
      apiKey,
      model: body.model,
      temperature: 0.4,
      maxTokens: 1600,
      messages: [
        { role: "system", content: ASSISTANT_SYSTEM },
        { role: "user", content: ctx + question },
      ],
    });
    return NextResponse.json({ ok: true, answer: result.text.slice(0, 12_000), meta: result.meta });
  } catch (e) {
    const msg = e instanceof AiError || e instanceof Error ? e.message : "AI request failed";
    const status = e instanceof AiError && /401|403|No API key/i.test(e.message) ? 401 : 502;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
