"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useKaliStore } from "@/lib/kali-store";
import { runScanStream, runPentestStream } from "@/lib/scan-client";
import type { ReconEvent, AiReport } from "@/lib/recon-types";

type Line = { kind: "in" | "out" | "err" | "ok" | "warn" | "sys" | "ai"; text: string };

const COMMANDS = [
  "dig", "host", "nslookup", "curl", "traceroute", "ping", "whoami", "uname", "id",
  "date", "hostname", "uptime", "scan", "ai", "setkey", "key", "tools", "banner",
  "about", "help", "clear", "history",
  "nmap", "sqlmap", "dirb", "gobuster", "nikto", "wpscan", "searchsploit", "range", "run",
];

const HELP_LINES = `Kali AI Pentest Suite — shell
────────────────────────────────────────────────────────────────
  RECON (passive/light)
    scan <target> [--deep]      Full recon + AI vulnerability report
    dig / host / nslookup / curl / traceroute / ping

  ATTACK (active — add --auth for public targets)
    nmap <host> [-sV -sC -O -A] [-p 80,443,1-1000] [--top-ports N] [-T0..5]
    sqlmap -u <url> [--data "a=b"] [--level N] [--dbms mysql] [--technique EBTU]
    dirb <url> [-w small|common|big] [-x php,bak] [-t N]     content discovery
    gobuster dir -u <url> -w <wordlist>                       same engine, gobuster style
    nikto <url>             web server misconfig + exposure scan
    wpscan <url>            WordPress enumeration & vuln surface
    searchsploit <terms>    offline exploit database lookup

  PRACTICE RANGE (local, pre-authorized)
    range                   show the built-in vulnerable target & recipes
    e.g.  sqlmap -u range://shop?search=a     nmap range --range

  AI COPILOT (your OpenAI/OpenRouter key, or the built-in KAI-SEC engine — no key needed)
    ai ask <question>       Ask the AI security copilot
    ai plan <target>        Recon + AI-generated attack toolchain, run with: run <n>
    ai model / ai models    Show active model / top free models
    ai key <openai|openrouter> <key>   Store API key in vault

  key · tools · whoami · uname · id · date · hostname · uptime
  clear · history · banner
────────────────────────────────────────────────────────────────
Targets must be public (private/loopback ranges are blocked).
Active tools on public targets require --auth: only test systems
you own or are authorized to assess. The local range is pre-approved.`;

const BANNER = `  ╔═══════════════════════════════════════════════╗
  ║   KALI AI PENTEST SUITE · v2.0                 ║
  ║   nmap · sqlmap · dirb · nikto · wpscan · AI   ║
  ╚═══════════════════════════════════════════════╝`;

const RANGE_INFO = `  ┌─( VULNSHOP — built-in practice range )────────────────────┐
  │  A deliberately vulnerable 2000s-style PHP/MySQL shop.    │
  │  Runs locally, pre-authorized, read-only emulation.       │
  └───────────────────────────────────────────────────────────┘

  Target map (also browsable in a new tab):
    range://home          landing page + search box
    range://shop?search=a vulnerable LIKE search  (error/bool/time/UNION SQLi)
    range://item?id=2     numeric injection       (UNION / ORDER BY oracle)
    range://login         POST login form         (SQLi auth bypass)
    range://admin         admin portal · range://uploads  dir listing
    hidden goodies: /.env · /.git/HEAD · /phpinfo.php · /backup.zip · /db.sql

  Ready-made recipes:
    nmap range --range
    sqlmap -u "range://shop?search=a"
    sqlmap -u "range://item?id=2" --technique=U
    sqlmap -u "range://login" --data="username=a&password=b"
    dirb range://shop -w common
    nikto range://home
    searchsploit apache 2.4

  Public targets still need --auth on active tools.`;

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ""; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

type PlanStep = { n: number; tool: string; args: string[]; why: string; risk: string };

export function Terminal() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: BANNER },
    { kind: "sys", text: "Kali AI Pentest Suite v2.0 — type 'help' for commands · 'range' for a legal practice target · 'scan example.com' to test." },
    { kind: "out", text: "" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("executing…");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<string[]>([]);
  const planRef = useRef<PlanStep[]>([]);

  const apiKey = useKaliStore((s) => s.apiKey);
  const provider = useKaliStore((s) => s.provider);
  const openaiModel = useKaliStore((s) => s.openaiModel);
  const setApiKeyStore = useKaliStore((s) => s.setApiKey);

  const keyRef = useRef(apiKey);
  const providerRef = useRef(provider);
  const modelRef = useRef(openaiModel);
  useEffect(() => { keyRef.current = apiKey; }, [apiKey]);
  useEffect(() => { providerRef.current = provider; }, [provider]);
  useEffect(() => { modelRef.current = openaiModel; }, [openaiModel]);

  const print = useCallback((text: string, kind: Line["kind"] = "out") => {
    setLines((ls) => {
      const next = [...ls];
      for (const chunk of text.split("\n")) next.push({ kind, text: chunk });
      return next.length > 1400 ? next.slice(next.length - 1400) : next;
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  /* ------------------------------ AI helpers ----------------------------- */

  /** fetch with live feedback + Ctrl+C abort; returns parsed json or null */
  const aiFetch = useCallback(async (url: string, body: Record<string, unknown>): Promise<{ ok: boolean; payload?: Record<string, unknown>; err?: string } | null> => {
    const ac = new AbortController();
    abortRef.current = ac;
    const t0 = Date.now();
    setBusyLabel(`KAI is thinking… 0s (Ctrl+C to abort)`);
    const tick = setInterval(() => setBusyLabel(`KAI is thinking… ${Math.round((Date.now() - t0) / 1000)}s (Ctrl+C to abort)`), 1000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      return { ok: res.ok, payload: (await res.json()) as Record<string, unknown> };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      return { ok: false, err: e instanceof Error ? e.message : "ai request failed" };
    } finally {
      clearInterval(tick);
      abortRef.current = null;
    }
  }, []);

  const printMeta = useCallback((meta: Record<string, unknown> | undefined) => {
    const m = meta as { fallbackReason?: string } | undefined;
    if (m?.fallbackReason) print(`⚠ ${m.fallbackReason}`, "warn");
  }, [print]);

  const aiAsk = useCallback(async (question: string) => {
    print(`┌─(kai-sec)─[copilot]`, "ai");
    const r = await aiFetch("/api/ai/chat", { apiKey: keyRef.current, provider: providerRef.current, model: providerRef.current === "openai" ? modelRef.current : undefined, question });
    if (!r) { print("✗ interrupted", "err"); return; }
    const j = r.payload;
    if (!r.ok || !j?.ok) { print(`✗ ${(j?.error as string) ?? r.err ?? "ai request failed"}`, "err"); return; }
    printMeta(j.meta as Record<string, unknown>);
    print(j.answer as string, "ai");
    print(`└─[${(j.meta as { model?: string })?.model ?? "ai"}]`, "ai");
  }, [print, aiFetch, printMeta]);

  const aiAnalyzeDigest = useCallback(async (target: string, digest: string): Promise<AiReport | null> => {
    print("─( ai analyst: correlating findings )─────────────────────────", "sys");
    const r = await aiFetch("/api/ai/analyze", { apiKey: keyRef.current, provider: providerRef.current, model: providerRef.current === "openai" ? modelRef.current : undefined, target, digest });
    if (!r) { print("✗ interrupted", "err"); return null; }
    const j = r.payload as Record<string, unknown>;
    if (!r.ok || !j?.ok) { print(`✗ AI analysis failed: ${(j?.error as string) ?? r.err ?? "error"}`, "err"); return null; }
    printMeta(j.meta as Record<string, unknown>);
    if (j.jsonParsed) {
      const r = j.report as AiReport;
      const meta = j.meta as { model?: string; modelLabel?: string } | undefined;
      print(`Model: ${meta?.model ?? "ai"}${meta?.modelLabel ? ` (${meta.modelLabel})` : ""}`, "sys");
      print(`RISK SCORE ${r.riskScore}/10 — ${r.posture}`, r.riskScore >= 7 ? "err" : r.riskScore >= 4 ? "warn" : "ok");
      print(r.summary, "ai");
      print(`Findings: ${r.findings.length}`, "sys");
      for (const f of r.findings) {
        const icon = f.severity === "Critical" ? "☠" : f.severity === "High" ? "▲" : f.severity === "Medium" ? "◆" : "·";
        print(`${icon} [${f.severity.padEnd(8)}] ${f.title}${f.cve ? ` (${f.cve})` : ""}`, f.severity === "Critical" || f.severity === "High" ? "err" : f.severity === "Medium" ? "warn" : "out");
        if (f.remediation) print(`    ↳ fix: ${f.remediation.slice(0, 160)}`, "out");
      }
      if (r.nextSteps.length) {
        print("Recommended next steps:", "sys");
        for (const s of r.nextSteps.slice(0, 6)) print(`  $ ${s}`, "out");
      }
      print("Tip: open the AI SCANNER tab for the full formatted report + export.", "sys");
      return r;
    } else {
      print(j.raw as string, "ai");
      return null;
    }
  }, [print, aiFetch, printMeta]);

  /* ----------------------------- scan command ---------------------------- */

  const runScan = useCallback(async (target: string, profile: "quick" | "deep") => {
    print(`─( launching ${profile} recon against ${target} )──────────────`, "sys");
    let digest = "";
    try {
      const done = await runScanStream(target, profile, (e: ReconEvent) => {
        const icon = e.status === "ok" ? "✔" : e.status === "warn" ? "⚠" : e.status === "fail" ? "✗" : "◌";
        print(`[${icon}] ${e.label} — ${e.status} (${e.ms}ms)`);
        const out = e.output.split("\n").slice(1).join("\n").trim();
        if (out) print(out.slice(0, 2200), e.status === "warn" ? "warn" : "out");
      }, abortRef);
      print(`✔ recon complete — ${done.eventsCount} steps · target ${done.target.host} (${done.target.addresses.join(", ")})`, "ok");
      digest = done.digest;
    } catch (e) {
      print(`✗ scan failed: ${e instanceof Error ? e.message : "error"}`, "err");
      return;
    }
    if (!keyRef.current) {
      print("◌ No API key in vault — AI analysis will use the built-in KAI-SEC engine.", "warn");
    }
    await aiAnalyzeDigest(target, digest);
  }, [print, aiAnalyzeDigest]);

  /* ------------------------ attack tool runner --------------------------- */

  const runAttackTool = useCallback(async (tool: string, args: string[]) => {
    print(`─( ${tool} ${args.join(" ")} )─────────────────────────────`, "sys");
    try {
      const result = await runPentestStream(tool, args, (l) => {
        const cls = (l.cls === "sys" || l.cls === "ok" || l.cls === "warn" || l.cls === "err") ? l.cls : "out";
        print(l.text, cls);
      }, abortRef);
      if (tool === "sqlmap") {
        const inj = result.injectable as number;
        print(inj > 0 ? `✔ sqlmap done — ${inj} injectable parameter(s) found` : `✔ sqlmap done — no injection points found`, inj > 0 ? "err" : "ok");
      } else if (tool === "nmap") {
        const open = (result.openPorts as Array<{ port: number }>)?.length ?? 0;
        print(`✔ nmap done — ${open} open port(s) on ${result.host} (${result.ip})`, "ok");
      } else if (tool === "dirb" || tool === "gobuster") {
        const hits = (result as { hits?: unknown[] }).hits?.length ?? 0;
        print(`✔ ${tool} done — ${hits} positive response(s)`, "ok");
      } else if (tool === "nikto" || tool === "wpscan") {
        const f = (result as { findings?: unknown[] }).findings?.length ?? 0;
        print(`✔ ${tool} done — ${f} item(s) reported`, "ok");
      }
    } catch (e) {
      print(`✗ ${tool}: ${e instanceof Error ? e.message : "failed"}`, "err");
    }
  }, [print]);

  /* ----------------------------- AI plan --------------------------------- */

  const aiPlan = useCallback(async (target: string) => {
    if (!target) { print("usage: ai plan <target>", "err"); return; }
    print(`─( ai plan · recon pass against ${target} )─────────────────`, "sys");
    let digest = "";
    try {
      const done = await runScanStream(target, "quick", (e: ReconEvent) => {
        const icon = e.status === "ok" ? "✔" : e.status === "warn" ? "⚠" : e.status === "fail" ? "✗" : "◌";
        print(`[${icon}] ${e.label} — ${e.status} (${e.ms}ms)`);
      }, abortRef);
      print(`✔ recon complete — ${done.eventsCount} steps`, "ok");
      digest = done.digest;
    } catch (e) {
      print(`✗ recon failed: ${e instanceof Error ? e.message : "error"}`, "err");
      return;
    }
    print("─( ai plan · composing attack toolchain )──────────────────", "sys");
    try {
      const r = await aiFetch("/api/ai/plan", { apiKey: keyRef.current, provider: providerRef.current, model: providerRef.current === "openai" ? modelRef.current : undefined, target, digest });
      if (!r) { print("✗ interrupted", "err"); return; }
      const j = r.payload as Record<string, unknown>;
      if (!r.ok || !j?.ok) { print(`✗ ${(j?.error as string) ?? r.err ?? "ai plan failed"}`, "err"); return; }
      printMeta(j.meta as Record<string, unknown>);
      const steps = (j.plan as { steps?: PlanStep[] })?.steps ?? [];
      planRef.current = steps;
      const pmeta = j.meta as { model?: string; modelLabel?: string } | undefined;
      print(`Model: ${pmeta?.model ?? "ai"}${pmeta?.modelLabel ? ` (${pmeta.modelLabel})` : ""}`, "sys");
      print(`AI attack plan — ${steps.length} step(s):`, "sys");
      for (const s of steps) {
        print(`  ${s.n}. $ ${s.tool} ${s.args.join(" ")}`, "ok");
        print(`     ↳ ${s.why}${s.risk ? ` · risk: ${s.risk}` : ""}`, "out");
      }
      print("Execute a step with: run <n>   (e.g. run 1)", "sys");
    } catch (e) {
      print(`✗ ai plan failed: ${e instanceof Error ? e.message : "error"}`, "err");
    }
  }, [print]);

  const runStep = useCallback(async (nStr: string) => {
    const n = parseInt(nStr, 10);
    const step = planRef.current.find((s) => s.n === n);
    if (!step) {
      print(`no step ${nStr} — generate a plan first with: ai plan <target>`, "err");
      return;
    }
    const args = [...step.args];
    const isRange = args.some((a) => /range:\/\//.test(a) || /\b(range|localhost|127\.0\.0\.1)\b/i.test(a));
    if (!isRange && !args.includes("--auth")) {
      args.push("--auth");
      print(`(auto-added --auth — executing the AI plan you approved)`, "warn");
    }
    print(`$ ${step.tool} ${args.join(" ")}`, "in");
    if (step.tool === "scan") {
      await runScan(args[0] ?? "", (args[1] ?? "").includes("deep") ? "deep" : "quick");
      return;
    }
    await runAttackTool(step.tool, args);
  }, [print, runAttackTool, runScan]);

  /* --------------------------- dispatch logic ---------------------------- */

  const exec = useCallback(async (raw: string) => {
    const cmdline = raw.trim();
    if (!cmdline) return;
    const args = splitArgs(cmdline);
    const cmd = args[0].toLowerCase();
    const rest = args.slice(1);

    switch (cmd) {
      case "help":
        print(HELP_LINES, "sys");
        return;
      case "clear":
        setLines([]);
        return;
      case "banner":
        print(BANNER, "sys");
        return;
      case "about":
        print("Kali AI Pentest Suite — web-hosted Kali-style environment: live recon tooling + BYO-key AI vulnerability analysis (OpenAI / OpenRouter free-model autopilot).", "sys");
        return;
      case "history":
        print(historyRef.current.map((h, i) => `  ${String(i + 1).padStart(3)}  ${h}`).join("\n") || "  (empty)", "out");
        return;
      case "tools": {
        const res = await fetch("/api/tools");
        const j = await res.json();
        if (!j.ok) { print("✗ tool probe failed", "err"); return; }
        const rows = Object.entries(j.tools as Record<string, { ok: boolean; desc: string }>);
        print("Host tool availability:", "sys");
        for (const [name, t] of rows) print(`  ${t.ok ? "✔" : "✗"} ${name.padEnd(12)} ${t.ok ? "available" : "not installed (recon engine covers this natively)"} — ${t.desc}`, t.ok ? "ok" : "out");
        return;
      }
      case "key": {
        const k = keyRef.current;
        if (!k) print("No key configured. Use: ai key <openai|openrouter> <key>", "warn");
        else {
          const masked = k.slice(0, 8) + "…" + k.slice(-4);
          print(`Vault: ${masked} · provider: ${providerRef.current === "auto" ? "auto-detect" : providerRef.current}${providerRef.current === "openai" ? ` · model ${modelRef.current}` : " · best-free autopilot"}`, "ok");
        }
        return;
      }
      case "setkey":
      case "ai": {
        // ai key <provider> <key> | setkey <provider> <key> | ai ask ... | ai model(s)
        if (cmd === "setkey" || (rest[0] === "key")) {
          const p = cmd === "setkey" ? rest[0] : rest[1];
          const k = cmd === "setkey" ? rest[1] : rest[2];
          if (!p || !k || !["openai", "openrouter"].includes(p.toLowerCase())) {
            print("usage: ai key <openai|openrouter> <key>", "err");
            return;
          }
          setApiKeyStore(k);
          providerRef.current = p.toLowerCase() as "openai" | "openrouter";
          print(`✔ key stored in vault (browser-local only): ${k.slice(0, 8)}…${k.slice(-4)} · provider ${p.toLowerCase()}`, "ok");
          return;
        }
        if (rest[0] === "model") {
          if (!keyRef.current) { print("No key in vault — running the built-in KAI-SEC engine (add a key for OpenAI/OpenRouter).", "warn"); return; }
          const isOR = providerRef.current === "openrouter" || (providerRef.current === "auto" && keyRef.current.startsWith("sk-or-"));
          if (isOR) {
            const res = await fetch("/api/openrouter/models");
            const j = await res.json();
            if (!j.ok) { print(`✗ ${j.error}`, "err"); return; }
            print(`Best free model on OpenRouter right now:`, "sys");
            print(`  ★ ${j.best.id} — ${j.best.name} (ctx ${j.best.contextLength}, tier ${j.best.tier})`, "ok");
          } else {
            print(`OpenAI model: ${modelRef.current} (change in KEY VAULT tab)`, "ok");
          }
          return;
        }
        if (rest[0] === "models") {
          const res = await fetch("/api/openrouter/models?all=1");
          const j = await res.json();
          if (!j.ok) { print(`✗ ${j.error}`, "err"); return; }
          print("Top free OpenRouter models (live ranking):", "sys");
          for (const m of (j.candidates as Array<{ id: string; contextLength: number; tier: string; score: number }>).slice(0, 10)) {
            print(`  ${String(m.score).padStart(5)}  ${m.id}  (ctx ${m.contextLength}, ${m.tier})`, "out");
          }
          return;
        }
        if (rest[0] === "plan") {
          const target = rest.slice(1).join(" ").trim();
          await aiPlan(target);
          return;
        }
        if (rest[0] === "ask") {
          const q = raw.trim().slice(raw.toLowerCase().indexOf("ask") + 3).trim();
          if (!q) { print("usage: ai ask <question>", "err"); return; }
          await aiAsk(q);
          return;
        }
        print("usage: ai ask <question> | ai plan <target> | ai key <provider> <key> | ai model | ai models", "err");
        return;
      }
      case "scan": {
        const target = rest.find((a) => !a.startsWith("--"));
        if (!target) { print("usage: scan <target> [--deep]", "err"); return; }
        const profile = rest.includes("--deep") ? "deep" : "quick";
        await runScan(target, profile);
        return;
      }
      case "range": {
        print(RANGE_INFO, "sys");
        return;
      }
      case "run": {
        await runStep(rest[0] ?? "");
        return;
      }
      case "nmap":
      case "sqlmap":
      case "dirb":
      case "gobuster":
      case "nikto":
      case "wpscan":
      case "searchsploit": {
        await runAttackTool(cmd, rest);
        return;
      }
      default: {
        // whitelisted host tools → /api/exec
        const known = ["dig", "host", "nslookup", "curl", "traceroute", "ping", "whoami", "uname", "id", "date", "hostname", "uptime"];
        if (known.includes(cmd)) {
          const res = await fetch("/api/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cmd, args: rest }),
          });
          const j = await res.json();
          if (!j.ok) { print(`✗ ${cmd}: ${j.error}`, "err"); return; }
          if (j.stdout?.trim()) print(j.stdout.trimEnd(), "out");
          if (j.stderr?.trim()) print(j.stderr.trimEnd(), "err");
          if (!j.stdout?.trim() && !j.stderr?.trim()) print(`(${cmd} exited with code ${j.code})`, "out");
          return;
        }
        print(`zsh: command not found: ${cmd} — try 'help'`, "err");
      }
    }
  }, [print, aiAsk, aiPlan, runScan, runAttackTool, runStep, setApiKeyStore]);

  const runLine = useCallback(async (raw: string) => {
    print(`┌──(root㉿kali)-[~]`, "in");
    print(`└─# ${raw}`, "in");
    historyRef.current = [raw, ...historyRef.current].slice(0, 100);
    setHistory(historyRef.current);
    setHistIdx(-1);
    busyRef.current = true;
    setBusy(true);
    try {
      await exec(raw);
    } catch (e) {
      print(`✗ ${e instanceof Error ? e.message : "command failed"}`, "err");
    } finally {
      busyRef.current = false;
      setBusy(false);
      abortRef.current = null;
      print("", "out");
    }
  }, [exec, print]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "c" && e.ctrlKey) {
      if (busyRef.current) {
        abortRef.current?.abort();
        print("^C — interrupted", "warn");
      } else {
        print("^C", "out");
      }
      setInput("");
      return;
    }
    if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
      return;
    }
    if (busyRef.current) {
      if (e.key === "Enter") e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      const v = input;
      setInput("");
      void runLine(v);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(histIdx + 1, history.length - 1);
      if (idx >= 0 && history[idx]) { setHistIdx(idx); setInput(history[idx]); }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = histIdx - 1;
      if (idx < 0) { setHistIdx(-1); setInput(""); }
      else { setHistIdx(idx); setInput(history[idx]); }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const parts = input.split(" ");
      if (parts.length <= 1) {
        const match = COMMANDS.find((c) => c.startsWith(parts[0].toLowerCase()) && parts[0]);
        if (match) setInput(match + " ");
      }
    }
  };

  return (
    <div
      className="flex h-full flex-col bg-[#0b0e13]"
      onClick={() => inputRef.current?.focus()}
      role="log"
      aria-label="Kali terminal"
    >
      <div ref={scrollRef} className="kali-scroll flex-1 overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.5]">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "in" ? "whitespace-pre-wrap text-slate-300"
                : l.kind === "err" ? "whitespace-pre-wrap text-red-400"
                  : l.kind === "ok" ? "whitespace-pre-wrap text-emerald-400"
                    : l.kind === "warn" ? "whitespace-pre-wrap text-amber-400"
                      : l.kind === "sys" ? "whitespace-pre-wrap text-[#5e9bff]"
                        : l.kind === "ai" ? "whitespace-pre-wrap text-fuchsia-300/90"
                          : "whitespace-pre-wrap text-slate-400"
            }
          >
            {l.text || "\u00A0"}
          </div>
        ))}
        <div className="flex items-baseline font-mono text-[12.5px]">
          <span className="whitespace-pre text-[#5e9bff]">{"┌──("}</span>
          <span className="font-bold text-[#5e9bff]">root</span>
          <span className="text-[#5e9bff]">㉿</span>
          <span className="font-bold text-[#5e9bff]">kali</span>
          <span className="text-[#5e9bff]">)-[</span>
          <span className="text-[#e5c07b]">~</span>
          <span className="text-[#5e9bff]">{"]"}</span>
        </div>
        <div className="flex items-baseline">
          <span className="mr-2 font-mono font-bold text-red-500">└─#</span>
          <div className="relative flex-1">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-label="terminal input"
              className="w-full bg-transparent font-mono text-[12.5px] text-slate-200 caret-transparent outline-none placeholder:text-slate-600"
              placeholder={busy ? "working… (Ctrl+C to abort)" : ""}
            />
            <span
              className="pointer-events-none absolute top-0 h-[1.2em] w-[7px] bg-slate-300/85 kal-cursor"
              style={{ left: `${input.length}ch` }}
            />
          </div>
        </div>
        {busy && <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-fuchsia-300/80"><span className="kal-cursor inline-block h-[10px] w-[6px] bg-fuchsia-400/80" />{busyLabel}</div>}
      </div>
    </div>
  );
}
