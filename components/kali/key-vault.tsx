"use client";

import { useCallback, useEffect, useState } from "react";
import { useKaliStore, type ProviderChoice } from "@/lib/kali-store";
import { KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Zap, ShieldCheck, Trash2 } from "lucide-react";

type RankedCandidate = { id: string; name: string; contextLength: number; tier: string; score: number };

export function KeyVault() {
  const apiKey = useKaliStore((s) => s.apiKey);
  const provider = useKaliStore((s) => s.provider);
  const openaiModel = useKaliStore((s) => s.openaiModel);
  const setApiKey = useKaliStore((s) => s.setApiKey);
  const setProvider = useKaliStore((s) => s.setProvider);
  const setOpenaiModel = useKaliStore((s) => s.setOpenaiModel);
  const clearKey = useKaliStore((s) => s.clearKey);

  const [draftKey, setDraftKey] = useState(apiKey);
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [models, setModels] = useState<RankedCandidate[] | null>(null);
  const [bestModel, setBestModel] = useState<RankedCandidate | null>(null);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => { setDraftKey(apiKey); }, [apiKey]);

  const isOR = (k: string) => k.trim().startsWith("sk-or-");
  const isOAI = (k: string) => k.trim().startsWith("sk-") && !isOR(k);
  const detected = isOR(draftKey) ? "openrouter" : isOAI(draftKey) ? "openai" : "unknown";

  const loadModels = useCallback(async (key?: string) => {
    setLoadingModels(true);
    setModelsErr(null);
    try {
      const url = key ? `/api/openrouter/models?all=1&key=${encodeURIComponent(key)}` : "/api/openrouter/models?all=1";
      const res = await fetch(url);
      const j = await res.json();
      if (!j.ok) setModelsErr(j.error ?? "failed to load models");
      else {
        setModels(j.candidates as RankedCandidate[]);
        setBestModel(j.best as RankedCandidate);
      }
    } catch {
      setModelsErr("network error");
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => { void loadModels(); }, [loadModels]);

  const testKey = async () => {
    const key = (draftKey || apiKey).trim();
    if (!key) { setTestResult({ ok: false, detail: "Paste a key first." }); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/ai/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key, provider }),
      });
      const j = await res.json();
      setTestResult({ ok: Boolean(j.ok), detail: j.ok ? String(j.detail) : String(j.error ?? "invalid") });
    } catch {
      setTestResult({ ok: false, detail: "network error" });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    const k = draftKey.trim();
    setApiKey(k);
    if (detected !== "unknown") setProvider(detected);
    setTestResult({ ok: true, detail: "Key saved to browser-local vault." });
    if (isOR(k)) void loadModels(k);
  };

  const providerOptions: Array<{ id: ProviderChoice; label: string; hint: string }> = [
    { id: "auto", label: "Auto-detect", hint: "route by key prefix" },
    { id: "openai", label: "OpenAI", hint: "sk-… · api.openai.com" },
    { id: "openrouter", label: "OpenRouter", hint: "sk-or-… · free-model autopilot" },
  ];

  return (
    <div className="kali-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">

        <section className="rounded-lg border border-[#232a35] bg-[#12151b] p-4 md:p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-[#5e9bff]" />
            <h2 className="font-semibold tracking-wide text-slate-200">API Key Vault</h2>
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
              <ShieldCheck className="mr-1 inline h-3 w-3" />browser-local only
            </span>
          </div>

          <div className="mb-4 rounded-md border border-[#2a323f] bg-[#0b0e13] px-3.5 py-2.5 text-[12px] leading-relaxed text-slate-400">
            <span className="font-semibold text-fuchsia-300">No key? No problem.</span> The suite ships with a built-in KAI-SEC engine — every AI feature works out of the box. Add your own key to route requests through OpenAI or OpenRouter (OpenRouter keys always auto-select the best <span className="text-slate-300">$0 free model</span> with live failover). If a provider is unreachable or rate-limited, the built-in engine silently takes over so requests never hang.
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2">
            {providerOptions.map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`rounded-md border px-3 py-2.5 text-left transition-colors ${provider === p.id ? "border-[#367bf0] bg-[#367bf0]/10" : "border-[#2a323f] bg-[#0b0e13] hover:border-[#3a4656]"}`}
                aria-pressed={provider === p.id}
              >
                <div className={`text-[13px] font-medium ${provider === p.id ? "text-[#5e9bff]" : "text-slate-300"}`}>{p.label}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">{p.hint}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <div className="relative flex-1">
              <input
                type={show ? "text" : "password"}
                value={draftKey}
                onChange={(e) => { setDraftKey(e.target.value); setTestResult(null); }}
                placeholder="sk-… (OpenAI) or sk-or-… (OpenRouter)"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border border-[#2a323f] bg-[#0b0e13] px-3.5 py-2.5 pr-10 font-mono text-[13px] text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-[#367bf0]"
                aria-label="API key"
              />
              <button
                onClick={() => setShow((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={show ? "hide key" : "show key"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button onClick={save} disabled={!draftKey.trim()} className="rounded-md bg-gradient-to-r from-[#367bf0] to-[#7d5bd6] px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40">
              Save to vault
            </button>
            <button onClick={() => void testKey()} disabled={testing} className="flex items-center gap-2 rounded-md border border-[#2a323f] px-4 py-2.5 text-[13px] text-slate-300 hover:bg-white/5 disabled:opacity-50">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Test
            </button>
            {apiKey && (
              <button onClick={() => { clearKey(); setDraftKey(""); setTestResult(null); }} className="rounded-md border border-red-500/30 px-3 py-2.5 text-red-400 hover:bg-red-500/10" aria-label="clear key">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            {draftKey.trim() && (
              <span className={`rounded px-2 py-0.5 font-mono text-[10.5px] ${detected === "openrouter" ? "bg-fuchsia-500/10 text-fuchsia-300" : detected === "openai" ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-slate-500"}`}>
                detected: {detected === "unknown" ? "unknown prefix" : detected}
              </span>
            )}
            {apiKey && !draftKey.trim() && (
              <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-[10.5px] text-slate-400">vault: {apiKey.slice(0, 8)}…{apiKey.slice(-4)}</span>
            )}
            {testResult && (
              <span className={`flex items-center gap-1.5 ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {testResult.detail}
              </span>
            )}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Your key is stored exclusively in this browser&apos;s localStorage and transmitted only with each analysis request to this app&apos;s backend — it is never persisted server-side, logged, or shared. Get keys at <span className="text-slate-400">platform.openai.com</span> or <span className="text-slate-400">openrouter.ai/keys</span>.
          </p>
        </section>

        {/* OpenRouter free-model autopilot */}
        {provider !== "openai" || detected === "openrouter" ? (
          <section className="rounded-lg border border-fuchsia-500/25 bg-[#12151b] p-4 md:p-5">
            <div className="mb-1.5 flex items-center gap-2.5">
              <Zap className="h-5 w-5 text-fuchsia-400" />
              <h3 className="font-semibold tracking-wide text-slate-200">OpenRouter — Best Free Model Autopilot</h3>
              {loadingModels && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            </div>
            <p className="mb-4 text-[12px] leading-relaxed text-slate-500">
              With an OpenRouter key, every analysis automatically runs on the strongest $0 model available right now — ranked live from OpenRouter&apos;s catalogue by capability tier-list (DeepSeek V3/R1, Qwen3, Llama 4, Gemini Flash…) with context-length bonuses. If a model is rate-limited or unavailable, the request falls back to the next candidate — no dead scans.
            </p>

            {bestModel && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-fuchsia-500/25 bg-fuchsia-500/5 px-3.5 py-2.5">
                <span className="text-[10px] font-bold tracking-widest text-fuchsia-400">ACTIVE ★</span>
                <span className="font-mono text-[13px] text-slate-200">{bestModel.id}</span>
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">ctx {bestModel.contextLength >= 1000 ? `${Math.round(bestModel.contextLength / 1000)}k` : bestModel.contextLength}</span>
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">tier {bestModel.tier}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-500">score {Math.round(bestModel.score * 10) / 10}</span>
              </div>
            )}

            {modelsErr && <div className="text-[12px] text-red-400">{modelsErr}</div>}

            {models && models.length > 0 && (
              <div className="kali-scroll max-h-64 overflow-y-auto rounded-md border border-[#232a35]">
                <table className="w-full text-left font-mono text-[11.5px]">
                  <thead className="sticky top-0 bg-[#171b22] text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Model</th>
                      <th className="px-3 py-2 hidden sm:table-cell">Context</th>
                      <th className="px-3 py-2">Tier</th>
                      <th className="px-3 py-2">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m, i) => (
                      <tr key={m.id} className={`border-t border-[#232a35] ${i === 0 ? "text-fuchsia-300" : "text-slate-400"}`}>
                        <td className="px-3 py-1.5">{i + 1}</td>
                        <td className="px-3 py-1.5">{m.id}</td>
                        <td className="hidden px-3 py-1.5 sm:table-cell">{m.contextLength >= 1000 ? `${Math.round(m.contextLength / 1000)}k` : m.contextLength}</td>
                        <td className="px-3 py-1.5">{m.tier}</td>
                        <td className="px-3 py-1.5">{Math.round(m.score * 10) / 10}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        {/* OpenAI model picker */}
        {provider === "openai" || detected === "openai" ? (
          <section className="rounded-lg border border-[#232a35] bg-[#12151b] p-4 md:p-5">
            <h3 className="mb-3 font-semibold tracking-wide text-slate-200">OpenAI Model</h3>
            <input
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              spellCheck={false}
              className="w-full rounded-md border border-[#2a323f] bg-[#0b0e13] px-3.5 py-2.5 font-mono text-[13px] text-slate-200 outline-none focus:border-[#367bf0]"
              aria-label="OpenAI model"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"].map((m) => (
                <button key={m} onClick={() => setOpenaiModel(m)} className="rounded bg-white/5 px-2 py-1 font-mono text-[10.5px] text-slate-400 hover:bg-white/10 hover:text-slate-200">
                  {m}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
