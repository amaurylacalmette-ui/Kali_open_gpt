import { execFile } from "node:child_process";
import { TargetError, guardHostArg, guardUrl } from "./target-guard";

/**
 * Whitelisted command executor for the Kali terminal.
 * - No shell is ever spawned (execFile, argv array).
 * - Every binary is whitelisted with strict per-tool argument validators.
 * - Hard timeouts + output caps.
 */

export class ExecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecError";
  }
}

export type ToolResult = {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
};

const MAX_BUF = 96 * 1024; // 96KB per stream

function run(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<ToolResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer: MAX_BUF, killSignal: "SIGKILL", windowsHide: true },
      (err, stdout, stderr) => {
        const timedOut = Boolean(err && (err as unknown as { killed?: boolean }).killed);
        const code = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : timedOut ? 124 : 0;
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          code: timedOut ? 124 : code,
          timedOut,
        });
      }
    );
  });
}

/* ------------------------------ arg helpers ------------------------------ */

const RE_DOMAIN = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+\.?$/;
const RE_IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const RE_IP6 = /^[0-9a-fA-F:]+$/;

function validHost(h: string): boolean {
  return RE_DOMAIN.test(h) || (RE_IPV4.test(h) && h.split(".").every((o) => +o <= 255)) || (h.includes(":") && RE_IP6.test(h) && h.length <= 45);
}

function expectHost(args: string[], what: string): string[] {
  if (args.length < 1) throw new ExecError(`usage: missing <${what}>`);
  const hosts = [...args];
  for (const h of hosts) {
    if (!validHost(h)) throw new ExecError(`invalid host: "${h}"`);
    guardHostArg(h); // throws on private/blocked
  }
  return hosts;
}

const SAFE_FLAG = /^-{1,2}[a-zA-Z0-9][a-zA-Z0-9-]*$/;

/* --------------------------- curl (hardened) ---------------------------- */

const CURL_ALLOWED_FLAGS = new Set([
  "-I", "--head", "-L", "--location", "-s", "--silent", "-S", "--show-error",
  "-i", "--include", "-k", "--insecure", "--compressed", "-4", "-ipv4", "-6",
  "-G", "--get", "-0", "--http1.1", "--http2", "-v", "--verbose", "-N", "--no-buffer",
]);
const CURL_VALUE_FLAGS = new Set(["--max-time", "-A", "--user-agent", "-H", "--header", "-X", "--request"]);

function buildCurl(args: string[]): string[] {
  const out: string[] = ["--max-time", "25", "-sS"];
  let url: string | null = null;
  let headerCount = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      if (CURL_ALLOWED_FLAGS.has(a)) {
        if (a === "-4" || a === "-6") out.push(a === "-4" ? "-4" : "-6");
        else out.push(a);
        continue;
      }
      if (a === "-o" || a === "-O" || a === "--output" || a === "-T" || a === "--upload-file" || a === "-K" || a === "--config" || a === "-x" || a === "--proxy" || a === "-e" || a === "--referer") {
        throw new ExecError(`curl: flag not allowed: ${a}`);
      }
      if (CURL_VALUE_FLAGS.has(a)) {
        const val = args[++i];
        if (val === undefined) throw new ExecError(`curl: flag ${a} needs a value`);
        if (a === "--max-time") {
          const t = Math.min(Math.max(parseInt(val, 10) || 10, 1), 60);
          out.push("--max-time", String(t));
        } else if (a === "-X" || a === "--request") {
          const m = val.toUpperCase();
          if (!["GET", "HEAD", "OPTIONS"].includes(m)) throw new ExecError("curl: only GET/HEAD/OPTIONS allowed");
          out.push("-X", m);
        } else if (a === "-A" || a === "--user-agent") {
          if (val.length > 200 || /[\r\n]/.test(val)) throw new ExecError("curl: bad user-agent");
          out.push("-A", val);
        } else if (a === "-H" || a === "--header") {
          if (++headerCount > 8) throw new ExecError("curl: too many headers");
          if (val.length > 400 || /[\r\n]/.test(val)) throw new ExecError("curl: bad header");
          out.push("-H", val);
        }
        continue;
      }
      throw new ExecError(`curl: flag not allowed: ${a}`);
    }
    if (url !== null) throw new ExecError("curl: exactly one URL allowed");
    url = a;
  }
  if (!url) throw new ExecError("curl: missing <url>");
  out.push(guardUrl(url));
  return out;
}

/* ------------------------------ tool table ------------------------------ */

export type ToolSpec = {
  bin: string;
  build: (args: string[]) => string[];
  timeout: number;
  desc: string;
};

export const TOOLS: Record<string, ToolSpec> = {
  dig: {
    bin: "dig",
    timeout: 15_000,
    desc: "DNS lookup utility",
    build: (args) => {
      const known = new Set(["+short", "+noall", "+answer", "+mx", "+ns", "+any", "+txt", "+cname", "+trace=false", "+nocomments", "+nostats"]);
      const rest: string[] = [];
      let hostSeen = false;
      for (const a of args) {
        if (a.startsWith("+")) {
          if (!known.has(a)) throw new ExecError(`dig: option not allowed: ${a}`);
          rest.push(a);
        } else if (/^(A|AAAA|MX|NS|TXT|CNAME|SOA|SRV|ANY)$/i.test(a) && !hostSeen) {
          rest.push(a.toUpperCase());
        } else if (!hostSeen) {
          rest.push(...expectHost([a], "host"));
          hostSeen = true;
        } else {
          throw new ExecError(`dig: unexpected arg: ${a}`);
        }
      }
      if (!hostSeen) throw new ExecError("dig: missing <host>");
      return ["+time=5", "+tries=2", ...rest];
    },
  },
  host: {
    bin: "host",
    timeout: 15_000,
    desc: "DNS lookup utility (simple)",
    build: (args) => expectHost(args, "host"),
  },
  nslookup: {
    bin: "nslookup",
    timeout: 15_000,
    desc: "Query Internet name servers",
    build: (args) => expectHost(args, "host"),
  },
  curl: {
    bin: "curl",
    timeout: 30_000,
    desc: "HTTP(S) request tool (hardened subset)",
    build: buildCurl,
  },
  traceroute: {
    bin: "traceroute",
    timeout: 45_000,
    desc: "Print the route packets trace to a host",
    build: (args) => {
      const flags: string[] = [];
      const rest = args.filter((a) => {
        if (a === "-n" || a === "-q1" || a === "-w1" || a === "-m15" || a === "--numeric") { flags.push(a === "-m15" ? "-m" : a === "-w1" ? "-w" : a); if (a === "-m15") flags.push("15"); if (a === "-w1") flags.push("1"); return false; }
        return true;
      });
      return [...flags, ...expectHost(rest, "host")];
    },
  },
  ping: {
    bin: "ping",
    timeout: 15_000,
    desc: "Send ICMP ECHO_REQUEST (may be blocked in sandboxes)",
    build: (args) => {
      const rest = args.filter((a) => a === "-c" || /^\d+$/.test(a) || !a.startsWith("-"));
      const hosts = rest.filter((a) => !/^\d+$/.test(a) && a !== "-c");
      const count = rest.find((a) => /^\d+$/.test(a)) ?? "4";
      return ["-c", Math.min(parseInt(count, 10) || 4, 10).toString(), ...expectHost(hosts, "host")];
    },
  },
  whoami: { bin: "whoami", timeout: 5_000, desc: "Print effective user", build: () => [] },
  uname: { bin: "uname", timeout: 5_000, desc: "Print system information", build: (args) => args.filter((a) => /^-[asrmnpo]$/.test(a)) },
  id: { bin: "id", timeout: 5_000, desc: "Print user identity", build: () => [] },
  date: { bin: "date", timeout: 5_000, desc: "Print system date/time", build: () => [] },
  hostname: { bin: "hostname", timeout: 5_000, desc: "Print hostname", build: () => [] },
  uptime: { bin: "uptime", timeout: 5_000, desc: "Tell how long the system has been running", build: () => [] },
};

export const TOOL_NAMES = Object.keys(TOOLS);

export type ExecOutcome = ToolResult & { tool: string };

/** Execute a whitelisted command line. Throws ExecError/TargetError on policy violation. */
export async function execCommandLine(cmd: string, args: string[]): Promise<ExecOutcome> {
  const spec = TOOLS[cmd];
  if (!spec) throw new ExecError(`tool not whitelisted: ${cmd}`);
  const argv = spec.build(args);
  const res = await run(spec.bin, argv, spec.timeout);
  return { ...res, tool: cmd };
}

/** Check which whitelisted tools exist on the host. */
export async function toolAvailability(): Promise<Record<string, { ok: boolean; version?: string; desc: string }>> {
  const out: Record<string, { ok: boolean; version?: string; desc: string }> = {};
  await Promise.all(
    Object.entries(TOOLS).map(async ([name, spec]) => {
      const r = await run("which", [spec.bin], 3000);
      const ok = r.code === 0 && r.stdout.trim().length > 0;
      let version: string | undefined;
      if (ok) {
        const v = await run(spec.bin, [name === "curl" ? "--version" : name === "uname" ? "-r" : "-V"], 4000).catch(() => null);
        version = v && v.code === 0 ? v.stdout.split("\n")[0].slice(0, 120) : undefined;
      }
      out[name] = { ok, version, desc: spec.desc };
    })
  );
  return out;
}
