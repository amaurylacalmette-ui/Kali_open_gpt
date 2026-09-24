import { NextRequest, NextResponse } from "next/server";
import { execCommandLine, ExecError } from "@/lib/exec-tools";
import { TargetError } from "@/lib/target-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { cmd?: string; args?: string[] };

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const cmd = (body.cmd ?? "").trim();
  const args = Array.isArray(body.args) ? body.args.map(String).slice(0, 32) : [];

  if (!cmd) return NextResponse.json({ ok: false, error: "missing command" }, { status: 400 });

  try {
    const res = await execCommandLine(cmd, args);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    const msg = e instanceof ExecError || e instanceof TargetError ? e.message : e instanceof Error ? e.message : "execution failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
