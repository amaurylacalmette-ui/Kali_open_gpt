"use client";

import { useEffect, useRef, useState } from "react";
import { useKaliStore } from "@/lib/kali-store";
import { runScanStream, reportMarkdown, download } from "@/lib/scan-client";
import type { ReconEvent, AiReport, AiMeta } from "@/lib/recon-types";
import { ShieldAlert, Play, Square, Sparkles, Download, FileJson, ChevronDown, Loader2, Lock, AlertTriangle } from "lucide-react";

const STATUS_ICON: Record<string, string> = { ok: "✔", warn: "⚠", fail: "✗", skip: "◌" };
const STATUS_COLOR: Record<string, string> = {
  ok: "text-emerald-400", warn: "text-amber-400", fail: "text-red-400", skip: "text-slate-500",
};

const SEV_STYLE: Record<string, string> = {
  Critical: "bg-red-500/15 text-red-400 border-red-500/40",
  High: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  Medium: "bg-yellow-500/15 text-yellow-300 border-yellow-500/40",
  Low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  Info: "bg-sky-500/15 text-sky-300 border-sky-500/40",
};

const STEPS = ["dns", "whois", "http", "tls", "headers", "tech", "robots", "ports", "paths"];

export function Scanner({ onNeedKey }: { onNeedKey: () => void }) {
  const [target, setTarget] = useState("");
  const [profile, setProfile] = useState<"quick" | "deep">("quick");
  const [authorized, setAuthorized] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [events, setEvents] = useState<ReconEvent[]>([]);
  const [scanDone, setScanDone] = useState<{ host: string; digest: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<AiReport | null>(null);
  const [meta, setMeta] = useState<AiMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const abortRef = useRef<{ current: AbortController | null }>({ current: null });
  const logRef = useRef<HTMLDivElement>(null);

  const apiKey = useKaliStore((s) => s.apiKey);
  const provider = useKaliStore((s) => s.provider);
  const openaiModel = useKaliStore((s) => s.openaiModel);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const startScan = async () => {
    if (!authorized || !target.trim() || scanning) return;
    setScanning(true);
    setEvents([]);
    setReport(null);
    setMeta(null);
    setScanDone(null);
    setError(null);
    try {
      const done = await runScanStream(target.trim(), profile, (e) => setEvents((prev) => [...prev, e]), abortRef.current);
      setScanDone({ host: done.target.host, digest: done.digest });
      // auto-run AI analysis (built-in engine works with or without a key)
      await analyze(done.digest);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "scan failed";
      if (!/abort/i.test(msg)) setError(msg);
    } finally {
      setScanning(false);
    }
  };

  const abort = () => {
    abortRef.current.current?.abort();
    setScanning(false);
  };

  const analyze = async (digestOverride?: string) => {
    const digest = digestOverride ?? scanDone?.digest;
    if (!digest) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey, provider,
          model: provider === "openai" ? openaiModel : undefined,
          target: scanDone?.host ?? target.trim(),
          digest,
        }),
      });
      const j = await res.json();
      if (!j.ok) setError(j.error ?? "AI analysis failed");
      else if (j.jsonParsed) { setReport(j.report as AiReport); setMeta(j.meta as AiMeta); }
      else { setError("Model returned non-JSON output — see raw in console."); console.warn(j.raw); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const exportMd = () => {
    if (!scanDone) return;
    download(`vuln-report-${scanDone.host}-${Date.now()}.md`, reportMarkdown(scanDone.host, profile, events, report, meta?.model), "text/markdown");
  };
  const exportJson = () => {
    if (!scanDone) return;
    download(`vuln-report-${scanDone.host}-${Date.now()}.json`, JSON.stringify({ target: scanDone.host, profile, scannedAt: new Date().toISOString(), model: meta?.model, recon: events, report }, null, 2), "application/json");
  };

  const riskColor = (r: number) => (r >= 7 ? "text-red-400" : r >= 4 ? "text-amber-400" : "text-emerald-400");

  return (
    <div className="kali-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">

        {/* control panel */}
        <section className="rounded-lg border border-[#232a35] bg-[#12151b] p-4 md:p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 text-[#5e9bff]" />
            <h2 className="font-semibold tracking-wide text-slate-200">AI Vulnerability Scanner</h2>
            <span className="rounded bg-[#367bf0]/15 px-2 py-0.5 text-[10px] font-medium text-[#5e9bff]">
              {apiKey ? (provider === "openrouter" || (provider === "auto" && apiKey.startsWith("sk-or-")) ? "OpenRouter · best-free autopilot" : provider === "openai" ? `OpenAI · ${openaiModel}` : "AI ready") : "built-in engine · no key needed"}
            </span>
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && authorized && !scanning) void startScan(); }}
              disabled={scanning}
              placeholder="target — e.g. scanme.nmap.org or https://yourapp.com"
              spellCheck={false}
              className="flex-1 rounded-md border border-[#2a323f] bg-[#0b0e13] px-3.5 py-2.5 font-mono text-[13px] text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-[#367bf0]"
              aria-label="scan target"
            />
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value as "quick" | "deep")}
              disabled={scanning}
              className="rounded-md border border-[#2a323f] bg-[#0b0e13] px-3 py-2.5 text-[13px] text-slate-300 outline-none focus:border-[#367bf0]"
              aria-label="scan profile"
            >
              <option value="quick">Quick (15 ports)</option>
              <option value="deep">Deep (26 ports + full checks)</option>
            </select>
            {scanning ? (
              <button onClick={abort} className="flex items-center justify-center gap-2 rounded-md bg-red-500/20 px-5 py-2.5 text-[13px] font-medium text-red-300 transition-colors hover:bg-red-500/30">
                <Square className="h-4 w-4" /> Abort
              </button>
            ) : (
              <button
                onClick={() => void startScan()}
                disabled={!authorized || !target.trim()}
                className="flex items-center justify-center gap-2 rounded-md bg-gradient-to-r from-[#367bf0] to-[#7d5bd6] px-5 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-[#367bf0]/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
              >
                <Play className="h-4 w-4" /> Launch Scan
              </button>
            )}
          </div>

          <label className="mt-3.5 flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-slate-400">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#367bf0]"
            />
            <span>
              <Lock className="mr-1 inline h-3 w-3 text-emerald-400" />
              I confirm I own this target or hold <strong className="text-slate-300">written authorization</strong> to test it. The operator is responsible for
              complying with all applicable laws. Private/loopback targets are blocked by the platform.
            </span>
          </label>
        </section>

        {error && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-[13px] text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* pipeline progress */}
        {(scanning || events.length > 0) && (
          <section className="rounded-lg border border-[#232a35] bg-[#12151b] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {STEPS.map((s) => {
                const ev = events.find((e) => e.id === s);
                return (
                  <span key={s} className={`rounded px-2 py-1 font-mono text-[10.5px] ${ev ? (ev.status === "ok" ? "bg-emerald-500/10 text-emerald-400" : ev.status === "warn" ? "bg-amber-500/10 text-amber-400" : ev.status === "fail" ? "bg-red-500/10 text-red-400" : "bg-white/5 text-slate-500") : "bg-white/5 text-slate-600"}`}>
                    {ev ? STATUS_ICON[ev.status] : "…"} {s}
                  </span>
                );
              })}
              {scanning && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#5e9bff]" />}
            </div>
            <div ref={logRef} className="kali-scroll max-h-72 overflow-y-auto rounded-md bg-[#0b0e13] p-3 font-mono text-[11.5px] leading-relaxed">
              {events.length === 0 && <div className="text-slate-600">waiting for recon stream…</div>}
              {events.map((e) => (
                <div key={e.id} className="mb-2.5">
                  <div className={STATUS_COLOR[e.status]}>
                    [{STATUS_ICON[e.status]}] {e.label} <span className="text-slate-600">— {e.status} · {e.ms}ms</span>
                  </div>
                  <pre className="mt-0.5 whitespace-pre-wrap text-slate-500">{e.output}</pre>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* AI analysis */}
        {scanDone && (
          <section className="rounded-lg border border-[#232a35] bg-[#12151b] p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-5 w-5 text-fuchsia-400" />
                <h3 className="font-semibold tracking-wide text-slate-200">AI Vulnerability Report</h3>
                {meta && (
                  <span className="rounded bg-fuchsia-500/10 px-2 py-0.5 font-mono text-[10px] text-fuchsia-300" title={meta.fallbackReason ?? ""}>
                    {meta.model}{meta.modelLabel ? ` · ${meta.modelLabel}` : ""}{meta.fallbackReason ? " · engine fallback" : meta.fallbackUsed ? " · fallback" : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!report && (
                  <button onClick={() => void analyze()} disabled={analyzing} className="flex items-center gap-2 rounded-md bg-gradient-to-r from-[#367bf0] to-[#7d5bd6] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
                    {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {analyzing ? "Analyzing…" : apiKey ? "Run AI Analysis" : "Run AI Analysis (built-in)"}
                  </button>
                )}
                {!apiKey && (
                  <button onClick={onNeedKey} className="rounded-md border border-[#367bf0]/50 bg-[#367bf0]/10 px-3.5 py-1.5 text-[12px] font-medium text-[#5e9bff] hover:bg-[#367bf0]/20">
                    Add your OpenAI/OpenRouter key
                  </button>
                )}
                <button onClick={exportMd} className="flex items-center gap-1.5 rounded-md border border-[#2a323f] px-3 py-1.5 text-[12px] text-slate-300 hover:bg-white/5">
                  <Download className="h-3.5 w-3.5" /> MD
                </button>
                <button onClick={exportJson} className="flex items-center gap-1.5 rounded-md border border-[#2a323f] px-3 py-1.5 text-[12px] text-slate-300 hover:bg-white/5">
                  <FileJson className="h-3.5 w-3.5" /> JSON
                </button>
              </div>
            </div>

            {analyzing && (
              <div className="flex items-center gap-3 rounded-md bg-[#0b0e13] p-4 text-[13px] text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-fuchsia-400" />
                KAI-SEC analyst is correlating recon evidence and drafting findings…
              </div>
            )}

            {report && (
              <div className="space-y-4">
                <div className="flex flex-col gap-4 rounded-md bg-[#0b0e13] p-4 md:flex-row md:items-center">
                  <div className="flex shrink-0 items-center gap-3">
                    <div className={`text-4xl font-bold ${riskColor(report.riskScore)}`}>{report.riskScore}<span className="text-lg text-slate-500">/10</span></div>
                    <div className="text-[11px] leading-tight text-slate-500">RISK<br />SCORE</div>
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 text-[12px] font-semibold text-slate-300">{report.posture}</div>
                    <p className="text-[13px] leading-relaxed text-slate-400">{report.summary}</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {report.findings.map((f) => {
                    const open = expanded === f.id;
                    return (
                      <div key={f.id} className="overflow-hidden rounded-md border border-[#232a35] bg-[#0b0e13]">
                        <button
                          onClick={() => setExpanded(open ? null : f.id)}
                          className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]"
                          aria-expanded={open}
                        >
                          <span className={`shrink-0 rounded border px-2 py-0.5 text-[10.5px] font-bold tracking-wide ${SEV_STYLE[f.severity] ?? SEV_STYLE.Info}`}>{f.severity.toUpperCase()}</span>
                          <span className="flex-1 text-[13px] font-medium text-slate-200">{f.title}</span>
                          {f.cve && <span className="hidden rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 sm:inline">{f.cve}</span>}
                          <span className="hidden rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-500 md:inline">{f.category}</span>
                          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-600 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                        {open && (
                          <div className="space-y-2.5 border-t border-[#232a35] px-3.5 py-3 text-[12.5px] leading-relaxed">
                            {f.evidence && <p><span className="font-semibold text-[#5e9bff]">Evidence · </span><span className="text-slate-400">{f.evidence}</span></p>}
                            {f.description && <p><span className="font-semibold text-[#5e9bff]">Description · </span><span className="text-slate-400">{f.description}</span></p>}
                            {f.impact && <p><span className="font-semibold text-orange-300">Impact · </span><span className="text-slate-400">{f.impact}</span></p>}
                            {f.remediation && <p><span className="font-semibold text-emerald-300">Remediation · </span><span className="text-slate-400">{f.remediation}</span></p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {report.nextSteps.length > 0 && (
                  <div className="rounded-md bg-[#0b0e13] p-4">
                    <div className="mb-2 text-[12px] font-semibold text-slate-300">Recommended next steps (authorized testing)</div>
                    <ul className="space-y-1.5 font-mono text-[12px] text-slate-400">
                      {report.nextSteps.map((s, i) => (
                        <li key={i} className="flex gap-2"><span className="text-[#5e9bff]">$</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
