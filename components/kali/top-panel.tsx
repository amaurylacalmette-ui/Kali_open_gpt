"use client";

import { useEffect, useState } from "react";
import { KaliWordmark } from "./logo";
import { TerminalSquare, Shield, KeyRound, Wrench, BookOpen } from "lucide-react";

export type TabId = "terminal" | "scanner" | "vault" | "tools";

const MENUS: Array<{ label: string; icon: React.ReactNode; tab: TabId; hint: string }> = [
  { label: "Terminal", icon: <TerminalSquare className="h-4 w-4" />, tab: "terminal", hint: "Interactive shell — recon tools + ai commands" },
  { label: "AI Scanner", icon: <Shield className="h-4 w-4" />, tab: "scanner", hint: "Automated recon → AI vulnerability report" },
  { label: "Key Vault", icon: <KeyRound className="h-4 w-4" />, tab: "vault", hint: "OpenAI / OpenRouter API key slot" },
  { label: "Tools", icon: <Wrench className="h-4 w-4" />, tab: "tools", hint: "Tool availability & arsenal reference" },
];

export function TopPanel({ active, onNavigate }: { active: TabId; onNavigate: (t: TabId) => void }) {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <header className="relative z-40 flex h-11 items-center justify-between border-b border-[#232a35] bg-[#101319]/95 px-3 md:px-4 backdrop-blur">
      <div className="flex items-center gap-4 md:gap-6">
        <KaliWordmark />
        <div className="relative hidden sm:block">
          <button
            onClick={() => setOpen((o) => !o)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[13px] text-slate-300 hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#367bf0]"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Applications
            <span className="text-[9px] text-slate-500">▾</span>
          </button>
          {open && (
            <div role="menu" className="absolute left-0 top-full mt-1 w-72 rounded-md border border-[#232a35] bg-[#14181f] py-1.5 shadow-2xl shadow-black/60">
              {MENUS.map((m) => (
                <button
                  key={m.tab}
                  role="menuitem"
                  onClick={() => { onNavigate(m.tab); setOpen(false); }}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-[#367bf0]/15 ${active === m.tab ? "text-[#5e9bff]" : "text-slate-300"}`}
                >
                  <span className="text-[#5e9bff]">{m.icon}</span>
                  <span className="flex-1">
                    {m.label}
                    <span className="block text-[10px] text-slate-500">{m.hint}</span>
                  </span>
                </button>
              ))}
              <div className="mx-3 my-1.5 border-t border-[#232a35]" />
              <div className="px-3 py-1 text-[10px] leading-relaxed text-slate-500">
                Only scan targets you own or have written authorization to test.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[12px] text-slate-400">
        <span className="hidden md:inline text-slate-500">Unauthorized access is prosecuted · Authorized testing only</span>
        <span className="hidden whitespace-nowrap font-mono tabular-nums text-slate-300 sm:inline">{clock}</span>
        <span className="flex items-center gap-1.5 whitespace-nowrap rounded bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          root@kali
        </span>
      </div>
    </header>
  );
}
