"use client";

import { create } from "zustand";

export type ProviderChoice = "auto" | "openai" | "openrouter";

export type KaliConfig = {
  apiKey: string;
  provider: ProviderChoice;
  openaiModel: string;
  hydrated: boolean;
};

export type KaliActions = {
  setApiKey: (k: string) => void;
  setProvider: (p: ProviderChoice) => void;
  setOpenaiModel: (m: string) => void;
  hydrate: () => void;
  clearKey: () => void;
};

const STORAGE_KEY = "kali-ai-config-v1";

function persist(state: Partial<KaliConfig>) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const prev = raw ? JSON.parse(raw) : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...state }));
  } catch { /* storage unavailable */ }
}

export const useKaliStore = create<KaliConfig & KaliActions>((set, get) => ({
  apiKey: "",
  provider: "auto",
  openaiModel: "gpt-4o-mini",
  hydrated: false,
  setApiKey: (k) => {
    set({ apiKey: k });
    persist({ apiKey: k });
  },
  setProvider: (p) => {
    set({ provider: p });
    persist({ provider: p });
  },
  setOpenaiModel: (m) => {
    set({ openaiModel: m });
    persist({ openaiModel: m });
  },
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cfg = JSON.parse(raw) as Partial<KaliConfig>;
        set({
          apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
          provider: cfg.provider === "openai" || cfg.provider === "openrouter" ? cfg.provider : "auto",
          openaiModel: typeof cfg.openaiModel === "string" && cfg.openaiModel ? cfg.openaiModel : "gpt-4o-mini",
        });
      }
    } catch { /* ignore */ }
    set({ hydrated: true });
  },
  clearKey: () => {
    set({ apiKey: "" });
    persist({ apiKey: "" });
  },
}));

/** Effective provider used for backend calls. */
export function effectiveProvider(apiKey: string, choice: ProviderChoice): "auto" | "openai" | "openrouter" {
  return choice;
}
