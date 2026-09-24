"use client";

import { useEffect, useState } from "react";
import { BootSequence } from "@/components/kali/boot";
import { TopPanel, type TabId } from "@/components/kali/top-panel";
import { Terminal } from "@/components/kali/terminal";
import { Scanner } from "@/components/kali/scanner";
import { KeyVault } from "@/components/kali/key-vault";
import { ToolsGrid } from "@/components/kali/tools-grid";
import { KaliDragon } from "@/components/kali/logo";
import { useKaliStore } from "@/lib/kali-store";
import { TerminalSquare, Shield, KeyRound, Wrench } from "lucide-react";

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "terminal", label: "Terminal", icon: <TerminalSquare className="h-3.5 w-3.5" /> },
  { id: "scanner", label: "AI Scanner", icon: <Shield className="h-3.5 w-3.5" /> },
  { id: "vault", label: "Key Vault", icon: <KeyRound className="h-3.5 w-3.5" /> },
  { id: "tools", label: "Tools", icon: <Wrench className="h-3.5 w-3.5" /> },
];

export default function KaliDesktop() {
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<TabId>("terminal");
  const hydrate = useKaliStore((s) => s.hydrate);
  const apiKey = useKaliStore((s) => s.apiKey);
  const provider = useKaliStore((s) => s.provider);

  useEffect(() => { hydrate(); }, [hydrate]);

  const aiLabel = !apiKey
    ? "AI: no key — recon only"
    : provider === "openrouter" || (provider === "auto" && apiKey.startsWith("sk-or-"))
      ? "AI: OpenRouter · best-free autopilot"
      : provider === "openai"
        ? `AI: OpenAI`
        : `AI: auto (${apiKey.startsWith("sk-or-") ? "OpenRouter free autopilot" : "OpenAI"})`;

  return (
    <div className="kali-desktop flex min-h-screen flex-col">
      {!booted && <BootSequence onDone={() => setBooted(true)} />}

      <TopPanel active={tab} onNavigate={setTab} />

      <div className="flex flex-1 overflow-hidden">
        {/* dock */}
        <nav className="hidden flex-col items-center gap-2 border-r border-[#232a35] bg-[#0d1016] py-3 sm:flex sm:w-14" aria-label="Suite navigation">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.label}
              aria-label={t.label}
              aria-current={tab === t.id ? "page" : undefined}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all ${tab === t.id ? "bg-gradient-to-br from-[#367bf0]/25 to-[#7d5bd6]/25 text-[#5e9bff] shadow-inner" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"}`}
            >
              {t.icon}
              {tab === t.id && <span className="absolute -left-[9px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-[#367bf0] to-[#7d5bd6]" />}
            </button>
          ))}
          <div className="mt-auto flex flex-col items-center gap-2">
            <div className="h-px w-8 bg-[#232a35]" />
            <KaliDragon size={22} className="opacity-70" />
          </div>
        </nav>

        {/* main window */}
        <main className="flex min-w-0 flex-1 flex-col bg-[#0b0e13]">
          {/* window titlebar */}
          <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[#232a35] bg-[#101319] px-3">
            <div className="flex gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
            </div>
            <div className="hidden gap-1 md:flex">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1 text-[12px] transition-colors ${tab === t.id ? "border-[#367bf0] bg-white/[0.04] text-slate-100" : "border-transparent text-slate-500 hover:text-slate-300"}`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            <span className="ml-1 select-none font-mono text-[11px] text-slate-600 md:ml-auto">
              {tab === "terminal" && "root@kali: ~ — zsh"}
              {tab === "scanner" && "kali-ai · vulnerability scanner"}
              {tab === "vault" && "kali-ai · api key vault"}
              {tab === "tools" && "kali-ai · arsenal"}
            </span>
          </div>

          {/* tab content */}
          <div className="min-h-0 flex-1">
            {tab === "terminal" && <Terminal />}
            {tab === "scanner" && <Scanner onNeedKey={() => setTab("vault")} />}
            {tab === "vault" && <KeyVault />}
            {tab === "tools" && <ToolsGrid />}
          </div>
        </main>
      </div>

      {/* status bar */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[#232a35] bg-[#101319] px-3 font-mono text-[10.5px] text-slate-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />kali-ai online</span>
          <span className="hidden sm:inline">target-guard: public-only</span>
          <span className="hidden md:inline">attack-engines: 7 live · range: vulnshop</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline">authorized testing only</span>
          <span className={apiKey ? "text-[#5e9bff]" : "text-amber-500"}>{aiLabel}</span>
        </div>
      </footer>

      {/* mobile tab bar */}
      <nav className="flex border-t border-[#232a35] bg-[#101319] sm:hidden" aria-label="Suite navigation mobile">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${tab === t.id ? "text-[#5e9bff]" : "text-slate-500"}`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
