"use client";

import type { ReconEvent } from "./recon-types";

/**
 * Client-side scan orchestration — consumes the NDJSON recon stream and
 * optionally triggers AI analysis on the resulting digest.
 */

export type ScanDonePayload = {
  type: "done";
  target: { host: string; addresses: string[]; scheme: string };
  digest: string;
  httpReachable: boolean;
  eventsCount: number;
};

export async function runScanStream(
  target: string,
  profile: "quick" | "deep",
  onEvent: (e: ReconEvent) => void,
  abortRef?: { current: AbortController | null }
): Promise<ScanDonePayload> {
  const ac = new AbortController();
  if (abortRef) abortRef.current = ac;

  const res = await fetch("/api/recon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, profile }),
    signal: ac.signal,
  });

  if (!res.ok || !res.body) {
    let msg = `recon stream failed (HTTP ${res.status})`;
    try {
      const j = await res.json();
      if (j?.message) msg = j.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === "event") {
        onEvent(msg.event as ReconEvent);
      } else if (msg.type === "error") {
        throw new Error(String(msg.message ?? "recon failed"));
      } else if (msg.type === "done") {
        return msg as unknown as ScanDonePayload;
      }
    }
  }
  throw new Error("Recon stream ended before completion.");
}

export type PentestDonePayload = {
  type: "done";
  result: Record<string, unknown>;
};

/** Stream an attack-tool run (nmap / sqlmap / dirb / gobuster / nikto / wpscan / searchsploit). */
export async function runPentestStream(
  tool: string,
  args: string[],
  onLine: (line: { text: string; cls: string }) => void,
  abortRef?: { current: AbortController | null }
): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  if (abortRef) abortRef.current = ac;

  const res = await fetch("/api/pentest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
    signal: ac.signal,
  });

  if (!res.ok || !res.body) {
    let msg = `tool stream failed (HTTP ${res.status})`;
    try {
      const j = await res.json();
      if (j?.message) msg = j.message;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === "line") {
        onLine({ text: String(msg.text ?? ""), cls: String(msg.cls ?? "out") });
      } else if (msg.type === "error") {
        throw new Error(String(msg.message ?? "tool failed"));
      } else if (msg.type === "done") {
        return (msg.result as Record<string, unknown>) ?? {};
      }
    }
  }
  throw new Error("Tool stream ended before completion.");
}

export function reportMarkdown(
  target: string,
  profile: string,
  events: ReconEvent[],
  report: {
    summary: string; riskScore: number; posture: string;
    findings: Array<{ id: string; title: string; severity: string; category: string; evidence: string; description: string; impact: string; remediation: string; cve?: string | null }>;
    nextSteps: string[];
  } | null,
  modelUsed?: string
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# Kali AI Pentest Suite — Vulnerability Assessment`);
  lines.push(``);
  lines.push(`- **Target:** ${target}`);
  lines.push(`- **Profile:** ${profile}`);
  lines.push(`- **Date:** ${now}`);
  if (modelUsed) lines.push(`- **AI Analyst model:** ${modelUsed}`);
  lines.push(``);
  lines.push(`## Recon Log`);
  for (const e of events) {
    lines.push(`\n### ${e.label} — ${e.status.toUpperCase()} (${e.ms}ms)\n\n\`\`\`\n${e.output}\n\`\`\``);
  }
  if (report) {
    lines.push(``);
    lines.push(`## Executive Summary`);
    lines.push(report.summary);
    lines.push(``);
    lines.push(`**Risk score:** ${report.riskScore}/10 — ${report.posture}`);
    lines.push(``);
    lines.push(`## Findings (${report.findings.length})`);
    for (const f of report.findings) {
      lines.push(``);
      lines.push(`### [${f.severity}] ${f.title} (${f.id})`);
      lines.push(`- **Category:** ${f.category}`);
      if (f.cve) lines.push(`- **CVE:** ${f.cve}`);
      lines.push(`- **Evidence:** ${f.evidence}`);
      lines.push(`- **Description:** ${f.description}`);
      lines.push(`- **Impact:** ${f.impact}`);
      lines.push(`- **Remediation:** ${f.remediation}`);
    }
    if (report.nextSteps.length) {
      lines.push(``);
      lines.push(`## Recommended Next Steps`);
      for (const s of report.nextSteps) lines.push(`- ${s}`);
    }
  }
  return lines.join("\n");
}

export function download(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
