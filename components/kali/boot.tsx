"use client";

import { useEffect, useState } from "react";
import { KaliDragon } from "./logo";

const BOOT_LINES = [
  "[    0.000000] Linux version 6.12.13-kali1-amd64 (devel@kali.org) #1 SMP PREEMPT_DYNAMIC",
  "[    0.184221] Command line: BOOT_IMAGE=/vmlinuz root=UUID=kali-ai ro quiet splash",
  "[    0.412337] kali-ai: loading offensive-recon modules ... OK",
  "[    0.598744] target-guard: SSRF protection enabled — private/loopback ranges blocked",
  "[    0.733812] systemd[1]: Starting Kali AI Pentest Suite...",
  "[    0.915280] exec-sandbox: whitelisted tools loaded (dig, host, nslookup, curl, traceroute)",
  "[    1.204551] recon-engine: dns·tls·headers·fingerprint·ports·paths modules online",
  "[    1.420003] key-vault: slot ready — OpenAI / OpenRouter detected by prefix",
  "[    1.588020] free-model-resolver: OpenRouter tier-list loaded, auto-fallback armed",
  "[    1.902444] ai-analyst: KAI-SEC vulnerability profile initialized",
  "[ OK ] Started Kali AI Pentest Suite.",
  "[ OK ] Reached target AI Offensive Environment.",
];

export function BootSequence({ onDone }: { onDone: () => void }) {
  const [lineCount, setLineCount] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (lineCount >= BOOT_LINES.length) {
      const t1 = setTimeout(() => setFading(true), 420);
      const t2 = setTimeout(onDone, 1000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    const t = setTimeout(() => setLineCount((c) => c + 1), lineCount === 0 ? 120 : 130);
    return () => clearTimeout(t);
  }, [lineCount, onDone]);

  return (
    <div
      className={`fixed inset-0 z-[100] bg-[#050608] flex flex-col justify-start pt-10 px-6 md:px-16 font-mono text-[12px] md:text-[13px] transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}
      onClick={onDone}
      role="presentation"
    >
      <div className="flex items-center gap-3 mb-6">
        <KaliDragon size={40} />
        <div>
          <div className="text-slate-100 font-bold tracking-widest">KALI GNU/Linux Rollin&apos; 2026.3</div>
          <div className="text-slate-500 text-[11px]">kali-ai-pentest-suite tty1</div>
        </div>
      </div>
      <div className="space-y-1">
        {BOOT_LINES.slice(0, lineCount).map((l, i) => (
          <div key={i} className="text-slate-400 whitespace-pre-wrap">
            {l.includes("[ OK ]") ? (
              <>
                <span className="text-slate-400">{l.split("[ OK ]")[0]}</span>
                <span className="text-emerald-400 font-bold">[ OK ]</span>
                <span className="text-slate-300">{l.split("[ OK ]")[1]}</span>
              </>
            ) : (
              l
            )}
          </div>
        ))}
        <span className="inline-block w-2.5 h-4 bg-slate-300 animate-pulse align-middle" />
      </div>
      <div className="mt-auto mb-8 text-slate-600 text-[11px]">click anywhere to skip…</div>
    </div>
  );
}
