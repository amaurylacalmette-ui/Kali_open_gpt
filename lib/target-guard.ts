import { promises as dnsPromises } from "node:dns";
import net from "node:net";

/**
 * Target Guard — validates scan targets and blocks requests aimed at
 * private / loopback / link-local infrastructure (SSRF protection) and
 * at hosts the operator cannot reasonably be authorized to test.
 */

export class TargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetError";
  }
}

const BLOCKED_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata.google.internal",
  "instance-data",
  "local",
  "internal",
  "broadcasthost",
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === "::" || addr === "::1") return true;
  if (addr.startsWith("fe80")) return true; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA
  if (addr.startsWith("ff")) return true; // multicast
  // IPv4-mapped ::ffff:10.0.0.1
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateIP(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
}

export type ParsedTarget = {
  /** normalized hostname (no scheme, no path, lowercase) */
  host: string;
  /** scheme for http probing */
  scheme: "http" | "https";
  /** original raw input */
  raw: string;
};

/** Parse user input into a hostname + scheme. Accepts domains, IPs, URLs. */
export function parseTarget(input: string): ParsedTarget {
  if (!input) throw new TargetError("Empty target.");
  let raw = input.trim().toLowerCase();
  if (raw.length > 253) throw new TargetError("Target too long.");

  let scheme: "http" | "https" = "https";
  if (/^https:\/\//.test(raw)) scheme = "https";
  else if (/^http:\/\//.test(raw)) scheme = "http";
  else if (/^[\w.-]+:\d+(\/|$)/.test(raw)) scheme = "http"; // host:port without scheme
  raw = raw.replace(/^https?:\/\//, "");
  raw = raw.split("/")[0].split("?")[0].split("#")[0];
  raw = raw.replace(/:\d+$/, ""); // strip explicit port for host validation
  raw = raw.replace(/\.$/, ""); // strip trailing FQDN dot

  if (!raw) throw new TargetError("Could not parse a hostname out of the target.");
  if (raw.includes("@")) throw new TargetError("UserInfo in target is not allowed.");
  if (!/^[\w.-]+$/.test(raw)) throw new TargetError("Target contains invalid characters.");

  const isIP = net.isIPv4(raw) || net.isIPv6(raw.replace(/^\[|\]$/g, ""));
  if (!isIP) {
    if (BLOCKED_NAMES.has(raw)) throw new TargetError(`Blocked target: ${raw}`);
    // must look like a domain: at least one dot OR be a single label the user owns (allow, DNS will fail)
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) {
      throw new TargetError(`"${raw}" does not look like a valid domain or IP.`);
    }
    if (/\.(local|internal|lan|home|arpa|onion)$/i.test(raw)) {
      throw new TargetError(`Refusing non-public TLD: ${raw}`);
    }
  }
  return { host: raw, scheme, raw: input.trim() };
}

export type ResolvedTarget = ParsedTarget & {
  /** resolved public IP addresses */
  addresses: string[];
};

const resolver = new dnsPromises.Resolver({ timeout: 5000, tries: 2 });

/** Parse + DNS-resolve the target and refuse private/loopback destinations. */
export async function resolveAndGuardTarget(input: string): Promise<ResolvedTarget> {
  const parsed = parseTarget(input);
  const hostForDns = parsed.host.replace(/^\[|\]$/g, "");

  if (net.isIPv4(hostForDns) || net.isIPv6(hostForDns)) {
    if (isPrivateIP(hostForDns)) {
      throw new TargetError(
        `Blocked: ${hostForDns} is a private / loopback / link-local address. Only public targets are allowed.`
      );
    }
    return { ...parsed, addresses: [hostForDns] };
  }

  let addresses: string[] = [];
  try {
    const [a, aaaa] = await Promise.all([
      dnsPromises.resolve4(hostForDns).catch(() => [] as string[]),
      dnsPromises.resolve6(hostForDns).catch(() => [] as string[]),
    ]);
    addresses = [...a, ...aaaa];
  } catch {
    throw new TargetError(`DNS resolution failed for "${hostForDns}". Is it a live, public domain?`);
  }

  if (addresses.length === 0) {
    throw new TargetError(`No DNS records found for "${hostForDns}".`);
  }

  const blocked = addresses.find((ip) => isPrivateIP(ip));
  if (blocked) {
    throw new TargetError(
      `Blocked: ${hostForDns} resolves to a private/loopback address (${blocked}). Only public targets are allowed.`
    );
  }

  return { ...parsed, addresses };
}

/** Lighter guard for tools that accept raw hosts (dig, host, whois…) */
export function guardHostArg(host: string): string {
  const parsed = parseTarget(host);
  if (net.isIPv4(parsed.host) && isPrivateIP(parsed.host)) {
    throw new TargetError(`Blocked: private/loopback IP ${parsed.host}.`);
  }
  if (net.isIPv6(parsed.host) && isPrivateIP(parsed.host)) {
    throw new TargetError(`Blocked: private/loopback IP ${parsed.host}.`);
  }
  if (BLOCKED_NAMES.has(parsed.host)) {
    throw new TargetError(`Blocked target: ${parsed.host}`);
  }
  return parsed.host;
}

/** Guard for http(s) URLs used by curl-like tools. */
export function guardUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new TargetError(`Invalid URL: ${rawUrl}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new TargetError("Only http:// and https:// URLs are allowed.");
  }
  if (u.username || u.password) throw new TargetError("UserInfo in URL is not allowed.");
  const host = guardHostArg(u.hostname);
  u.hostname = host;
  return u.toString();
}
