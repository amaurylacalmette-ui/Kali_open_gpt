"use client";

import { useEffect, useState } from "react";
import { TerminalSquare, ShieldAlert, Radar, Wrench, Crosshair, FlaskConical, CheckCircle2 } from "lucide-react";

type ToolInfo = { ok: boolean; version?: string; desc: string };

const ARSENAL: Array<{ cat: string; items: Array<{ name: string; desc: string; live?: boolean }> }> = [
  {
    cat: "Information Gathering",
    items: [
      { name: "dig / host / nslookup", desc: "DNS enumeration — live in this suite", live: true },
      { name: "nmap", desc: "TCP connect scan · -sV service detect · -sC scripts · -O guess", live: true },
      { name: "theHarvester", desc: "OSINT emails, subdomains, hosts" },
      { name: "recon-ng", desc: "Modular web reconnaissance framework" },
    ],
  },
  {
    cat: "Vulnerability Analysis",
    items: [
      { name: "nikto", desc: "Server misconfigs, listings, TRACE, exposures", live: true },
      { name: "wpscan", desc: "WordPress version/users/xmlrpc/plugin checks", live: true },
      { name: "searchsploit", desc: "Offline exploit-DB search mapped to your findings", live: true },
      { name: "KAI-SEC analyst", desc: "AI correlation of all tool evidence — built in", live: true },
    ],
  },
  {
    cat: "Web Application Analysis",
    items: [
      { name: "sqlmap", desc: "Error / boolean / time-based / UNION SQLi detection", live: true },
      { name: "dirb / gobuster", desc: "Content discovery with built-in wordlists", live: true },
      { name: "Burp Suite", desc: "Interactive web proxy & scanner" },
      { name: "whatweb", desc: "Technology fingerprinting (covered by recon engine)" },
    ],
  },
  {
    cat: "Exploitation (reference)",
    items: [
      { name: "hydra / john / hashcat", desc: "Credential attack suites — intentionally not included" },
      { name: "Metasploit Framework", desc: "Exploit development & execution" },
      { name: "searchsploit", desc: "Public exploit references are mapped read-only", live: true },
      { name: "VULNSHOP range", desc: "Built-in vulnerable target for safe practice", live: true },
    ],
  },
];

const RANGE_RECIPES = [
  { cmd: "sqlmap -u \"range://shop?search=a\"", desc: "detects error + boolean + UNION injection with DBMS fingerprint & table dump" },
  { cmd: "sqlmap -u \"range://item?id=2\" --technique=U", desc: "numeric-context UNION extraction" },
  { cmd: "sqlmap -u \"range://login\" --data=\"user=a&pass=b\"", desc: "POST parameter testing → auth bypass" },
  { cmd: "nmap range --range", desc: "port/service scan of the local range service" },
  { cmd: "dirb range://shop -w common", desc: "finds .env, .git, phpinfo, backups…" },
  { cmd: "nikto range://home", desc: "misconfigs: TRACE, listings, outdated PHP/Apache" },
];

export function ToolsGrid() {
  const [tools, setTools] = useState<Record<string, ToolInfo> | null>(null);

  useEffect(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then((j) => { if (j.ok) setTools(j.tools as Record<string, ToolInfo>); })
      .catch(() => setTools({}));
  }, []);

  const online = tools ? Object.values(tools).filter((t) => t.ok).length : 0;

  return (
    <div className="kali-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">

        <section className="rounded-lg border border-[#232a35] bg-[#12151b] p-4 md:p-5">
          <div className="mb-1 flex items-center gap-2.5">
            <Crosshair className="h-5 w-5 text-[#5e9bff]" />
            <h2 className="font-semibold tracking-wide text-slate-200">Attack Engines — LIVE</h2>
            <span className="ml-auto font-mono text-[11px] text-slate-500">7 engines · pure-node</span>
          </div>
          <p className="mb-3.5 text-[12px] leading-relaxed text-slate-500">
            These run natively inside the suite (no host binaries needed) — every one streams real requests and returns real evidence:
            <span className="ml-1 font-mono text-[11.5px] text-slate-400">nmap · sqlmap · dirb · gobuster · nikto · wpscan · searchsploit</span>.
            Run them from the Terminal tab. Active use against public hosts requires the <code className="rounded bg-white/5 px-1 font-mono text-[11px] text-amber-300">--auth</code> flag.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["nmap", "port scan · service/version · NSE-style scripts · OS guess"],
              ["sqlmap", "param discovery · error/boolean/time/UNION · DBMS fingerprint"],
              ["dirb / gobuster", "500+ wordlist entries · extensions · status filters"],
              ["nikto", "40+ exposure checks · methods · listings · outdated stacks"],
              ["wpscan", "REST user enum · xmlrpc · debug.log · notorious plugins"],
              ["searchsploit", "60+ curated public exploits · maps to your findings"],
            ].map(([name, desc]) => (
              <div key={name} className="flex items-center gap-3 rounded-md border border-[#232a35] bg-[#0b0e13] px-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12.5px] text-slate-300">{name}</div>
                  <div className="truncate text-[10.5px] text-slate-500">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-4 md:p-5">
          <div className="mb-1 flex items-center gap-2.5">
            <FlaskConical className="h-5 w-5 text-emerald-400" />
            <h2 className="font-semibold tracking-wide text-slate-200">VULNSHOP — Practice Range</h2>
            <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-300">pre-authorized · local</span>
          </div>
          <p className="mb-3.5 text-[12px] leading-relaxed text-slate-500">
            A deliberately vulnerable 2000s-style PHP/MySQL shop running inside this app. It has SQL injection in three places
            (string search, numeric id, login form), directory listing, exposed <code className="font-mono">.env</code>/<code className="font-mono">.git</code>,
            outdated PHP/Apache banners and more. Point the attack engines at it with the <code className="font-mono">range://</code> pseudo-target — no auth flag needed.
          </p>
          <div className="space-y-2">
            {RANGE_RECIPES.map((r) => (
              <div key={r.cmd} className="rounded-md border border-[#232a35] bg-[#0b0e13] px-3 py-2">
                <div className="font-mono text-[12px] text-emerald-300">$ {r.cmd}</div>
                <div className="text-[10.5px] text-slate-500">{r.desc}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-600">Type <code className="font-mono text-slate-400">range</code> in the Terminal for the full target map, or browse <code className="font-mono text-slate-400">/api/range/home</code> in a new tab.</p>
        </section>

        <section className="rounded-lg border border-[#232a35] bg-[#12151b] p-4 md:p-5">
          <div className="mb-1 flex items-center gap-2.5">
            <TerminalSquare className="h-5 w-5 text-[#5e9bff]" />
            <h2 className="font-semibold tracking-wide text-slate-200">Host Tool Status</h2>
            <span className="ml-auto font-mono text-[11px] text-slate-500">{tools ? `${online} binaries online` : "probing…"}</span>
          </div>
          <p className="mb-3.5 text-[12px] leading-relaxed text-slate-500">
            Classic binaries present on this host. The suite&apos;s own engines do not depend on them — everything above runs natively.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {tools === null
              ? Array.from({ length: 11 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-md bg-white/[0.03]" />)
              : Object.entries(tools).map(([name, t]) => (
                  <div key={name} className="flex items-center gap-3 rounded-md border border-[#232a35] bg-[#0b0e13] px-3 py-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${t.ok ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/50" : "bg-slate-600"}`} />
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[12.5px] text-slate-300">{name}{t.ok && t.version ? <span className="ml-2 text-[10px] text-slate-600">{t.version.split(",")[0]}</span> : null}</div>
                      <div className="truncate text-[10.5px] text-slate-500">{t.desc}</div>
                    </div>
                  </div>
                ))}
          </div>
        </section>

        <section className="rounded-lg border border-[#232a35] bg-[#12151b] p-4 md:p-5">
          <div className="mb-1 flex items-center gap-2.5">
            <Radar className="h-5 w-5 text-[#5e9bff]" />
            <h2 className="font-semibold tracking-wide text-slate-200">Kali Arsenal Reference</h2>
          </div>
          <p className="mb-4 text-[12px] text-slate-500">The classic tooling categories — <span className="text-slate-400">LIVE</span> badges mark what runs inside this suite right now.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {ARSENAL.map((group) => (
              <div key={group.cat}>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#5e9bff]">
                  <Wrench className="h-3.5 w-3.5" /> {group.cat}
                </div>
                <ul className="space-y-1.5">
                  {group.items.map((it) => (
                    <li key={it.name} className="rounded-md bg-[#0b0e13] px-3 py-2">
                      <div className="font-mono text-[12px] text-slate-300">
                        {it.name}
                        {it.live && <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-px text-[9px] font-sans font-semibold text-emerald-300">LIVE</span>}
                      </div>
                      <div className="text-[10.5px] text-slate-500">{it.desc}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-4">
          <div className="flex items-start gap-2.5 text-[12px] leading-relaxed text-amber-300/90">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Legal &amp; ethical use.</strong> This suite is designed for authorized security assessments: your own systems, bug-bounty scope, or engagements with written permission. The platform enforces public-target-only scanning (no private/loopback ranges, SSRF guard on every request) and active tools require the <code className="font-mono">--auth</code> acknowledgement. The only local target is the built-in practice range. No credential brute-forcing or destructive payloads are implemented by design.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
