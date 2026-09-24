import { NextResponse } from "next/server";
import { toolAvailability } from "@/lib/exec-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tools = await toolAvailability();
    return NextResponse.json({ ok: true, tools });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
