import { NextRequest } from "next/server";
import { runRecon, buildDigest, type ReconProfile, type ReconEvent } from "@/lib/recon";
import { TargetError } from "@/lib/target-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = { target?: string; profile?: string };

/**
 * NDJSON streaming recon: one JSON line per completed step.
 * Line 0 is always the "meta" line; the final line is "done".
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ type: "error", message: "invalid JSON" }) + "\n", {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const target = (body.target ?? "").trim();
  const profile: ReconProfile = body.profile === "deep" ? "deep" : "quick";

  if (!target) {
    return new Response(JSON.stringify({ type: "error", message: "missing target" }) + "\n", {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      try {
        const { target: t, events, http } = await runRecon(target, profile, (e: ReconEvent) => {
          send({ type: "event", event: e });
        });
        send({
          type: "done",
          target: { host: t.host, addresses: t.addresses, scheme: t.scheme },
          digest: buildDigest(t, events, http),
          httpReachable: Boolean(http),
          eventsCount: events.length,
        });
      } catch (e) {
        const message = e instanceof TargetError || e instanceof Error ? e.message : "recon failed";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
