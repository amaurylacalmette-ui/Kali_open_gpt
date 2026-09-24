/** Shared client-side types mirroring server recon events (import-safe for client bundles). */

export type StepStatus = "ok" | "warn" | "fail" | "skip";

export type ReconEvent = {
  id: string;
  label: string;
  status: StepStatus;
  ms: number;
  output: string;
  data?: unknown;
};

export type AiReport = {
  summary: string;
  riskScore: number;
  posture: string;
  findings: Array<{
    id: string;
    title: string;
    severity: string;
    category: string;
    evidence: string;
    description: string;
    impact: string;
    remediation: string;
    cve?: string | null;
  }>;
  nextSteps: string[];
};

export type AiMeta = { provider: string; model: string; modelLabel?: string; fallbackUsed?: boolean; fallbackReason?: string };
