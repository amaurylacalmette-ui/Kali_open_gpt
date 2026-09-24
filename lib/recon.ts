import { promises as dnsPromises } from "node:dns";
import net from "node:net";
import tls from "node:tls";
import { resolveAndGuardTarget, type ResolvedTarget } from "./target-guard";

/**
 * Recon engine — pure Node implementation so it works even when classic
 * Kali binaries (nmap, whois, whatweb…) are not installed on the host.
 * Every step returns a structured event; the API route streams them as NDJSON.
 */

export type StepStatus = "ok" | "warn" | "fail" | "skip";

export type ReconEvent = {
  id: string;
  label: string;
  status: StepStatus;
  ms: number;
  output: string;
  data?: unknown;
};

export type ReconProfile = "quick" | "deep";

const UA = "Mozilla/5.0 (X11; Linux x86_64; Kali-AI-Pentest-Suite/1.0) AppleWebKit/537.36";

function header(s: string): string {
  const line = "─".repeat(46);
  return `${line}\n  ${s}\n${line}`;
}

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await p(ac.signal);
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------- steps ---------------------------------- */

async function stepDns(t: ResolvedTarget): Promise<ReconEvent> {
  const start = Date.now();
  const r = dnsPromises;
  const [a, aaaa, mx, ns, txt, cname, soa] = await Promise.all([
    r.resolve4(t.host).catch(() => []),
    r.resolve6(t.host).catch(() => []),
    r.resolveMx(t.host).catch(() => []),
    r.resolveNs(t.host).catch(() => []),
    r.resolveTxt(t.host).catch(() => []),
    r.resolveCname(t.host).catch(() => []),
    r.resolveSoa(t.host).catch(() => null),
  ]);
  const lines: string[] = [header(`DNS RECON — ${t.host}`)];
  const data: Record<string, unknown> = { host: t.host };

  lines.push(`A      ${a.length ? a.join(", ") : "—"}`);
  if (aaaa.length) lines.push(`AAAA   ${aaaa.join(", ")}`);
  if (cname.length) lines.push(`CNAME  ${cname.join(", ")}`);
  data.a = a; data.aaaa = aaaa; data.cname = cname;

  if (mx.length) {
    lines.push(`MX     ${mx.map((m) => `${m.priority} ${m.exchange}`).join(", ")}`);
    data.mx = mx;
  }
  if (ns.length) { lines.push(`NS     ${ns.join(", ")}`); data.ns = ns; }
  if (soa) { lines.push(`SOA    ${soa.nsname} (serial ${soa.serial})`); data.soa = soa; }
  if (txt.length) {
    const flat = txt.map((chunks) => chunks.join(""));
    lines.push(`TXT    ${flat.length} record(s)`);
    for (const rec of flat.slice(0, 12)) {
      const spf = rec.startsWith("v=spf1") ? " [SPF]" : rec.startsWith("v=DMARC1") ? " [DMARC]" : rec.startsWith("_acct") || rec.includes("apple-domain") ? " [verification]" : "";
      lines.push(`  · ${rec.slice(0, 180)}${rec.length > 180 ? "…" : ""}${spf}`);
    }
    data.txt = flat;
    const hasDmarc = flat.some((x) => x.startsWith("v=DMARC1"));
    if (!hasDmarc) lines.push("  ⚠ No DMARC policy detected (email spoofing risk)");
  }
  const status: StepStatus = a.length === 0 && aaaa.length === 0 ? "fail" : "ok";
  return { id: "dns", label: "DNS enumeration", status, ms: Date.now() - start, output: lines.join("\n"), data };
}

async function stepWhois(t: ResolvedTarget): Promise<ReconEvent> {
  const start = Date.now();
  try {
    const { execFile } = await import("node:child_process");
    const res = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      execFile("whois", [t.host], { timeout: 12_000, maxBuffer: 128 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 0;
        resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", code });
      });
    });
    if (res.code !== 0 || !res.stdout.trim()) {
      return { id: "whois", label: "WHOIS lookup", status: "skip", ms: Date.now() - start, output: "whois binary unavailable on this host — skipped." };
    }
    const interesting: string[] = [];
    for (const line of res.stdout.split("\n")) {
      if (/registrar:|creation date:|registry expiry|updated date:|name server:|domain status:|registrant (org|country)|abuse/i.test(line) && line.trim()) {
        interesting.push(line.trim().slice(0, 140));
      }
    }
    const out = [header(`WHOIS — ${t.host}`), ...interesting.slice(0, 24)].join("\n");
    return { id: "whois", label: "WHOIS lookup", status: "ok", ms: Date.now() - start, output: out, data: { records: interesting } };
  } catch {
    return { id: "whois", label: "WHOIS lookup", status: "skip", ms: Date.now() - start, output: "whois unavailable in this environment — skipped." };
  }
}

type HttpProbeData = {
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  redirectChain: string[];
  body: string;
  title?: string;
};

async function stepHttpProbe(t: ResolvedTarget): Promise<{ event: ReconEvent; data: HttpProbeData | null }> {
  const start = Date.now();
  const redirects: string[] = [];
  let url = `${t.scheme}://${t.host}/`;
  let current: Response | null = null;
  let headers: Record<string, string> = {};

  for (let hop = 0; hop < 6; hop++) {
    try {
      const res = await withTimeout(
        (signal) =>
          fetch(url, {
            signal,
            redirect: "manual",
            headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
          }),
        15_000
      );
      current = res;
      headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, url).toString();
        redirects.push(`${res.status} → ${next}`);
        url = next;
        continue;
      }
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (t.scheme === "https" && hop === 0) {
        // retry plain HTTP once before failing
        try {
          const res2 = await withTimeout(
            (signal) => fetch(`http://${t.host}/`, { signal, redirect: "manual", headers: { "User-Agent": UA } }),
            12_000
          );
          current = res2;
          headers = Object.fromEntries([...res2.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
          url = `http://${t.host}/`;
          if (res2.status >= 300 && res2.status < 400 && res2.headers.get("location")) {
            const next = new URL(res2.headers.get("location")!, url).toString();
            redirects.push(`${res2.status} → ${next}`);
            url = next;
            continue;
          }
          break;
        } catch {
          return {
            event: { id: "http", label: "HTTP probe", status: "fail", ms: Date.now() - start, output: `${header("HTTP PROBE")}\n✗ Unreachable: ${msg}` },
            data: null,
          };
        }
      }
      return {
        event: { id: "http", label: "HTTP probe", status: "fail", ms: Date.now() - start, output: `${header("HTTP PROBE")}\n✗ Unreachable: ${msg}` },
        data: null,
      };
    }
  }

  if (!current) {
    return {
      event: { id: "http", label: "HTTP probe", status: "fail", ms: Date.now() - start, output: `${header("HTTP PROBE")}\n✗ No response` },
      data: null,
    };
  }

  let body = "";
  try {
    const text = await current.text();
    body = text.slice(0, 300_000);
  } catch { /* body optional */ }

  const titleMatch = body.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, " ") : undefined;

  const lines = [
    header(`HTTP PROBE — ${url}`),
    `Status      ${current.status} ${current.statusText}`,
    `Server      ${headers["server"] ?? "not disclosed"}`,
    `Powered-By  ${headers["x-powered-by"] ?? "—"}${headers["x-generator"] ? ` | ${headers["x-generator"]}` : ""}`,
    `Content-Type ${headers["content-type"] ?? "—"}`,
    title ? `Title       ${title}` : "Title       —",
  ];
  if (redirects.length) lines.push(`Redirects   ${redirects.join("  ⤳  ") || "none"}`);
  const cookies = headers["set-cookie"];
  if (cookies) lines.push(`Cookies     present (see header audit)`);

  const data: HttpProbeData = {
    finalUrl: url,
    status: current.status,
    statusText: current.statusText,
    headers,
    redirectChain: redirects,
    body,
    title,
  };
  return { event: { id: "http", label: "HTTP probe", status: "ok", ms: Date.now() - start, output: lines.join("\n"), data: { ...data, body: undefined } }, data };
}

async function stepTls(t: ResolvedTarget): Promise<ReconEvent> {
  const start = Date.now();
  if (t.scheme !== "https") {
    return { id: "tls", label: "TLS / certificate audit", status: "warn", ms: Date.now() - start, output: `${header("TLS AUDIT")}\n⚠ Target not on HTTPS — all traffic is cleartext.` };
  }
  return await new Promise<ReconEvent>((resolve) => {
    let settled = false;
    const finish = (fn: () => ReconEvent) => {
      if (!settled) { settled = true; try { socket.destroy(); } catch { /* noop */ } resolve(fn()); }
    };
    const socket = tls.connect(
      { host: t.host, port: 443, servername: t.host, rejectUnauthorized: false, timeout: 10_000 },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          const cipher = socket.getCipher();
          const proto = socket.getProtocol();
          const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
          const validFrom = cert?.valid_from ? new Date(cert.valid_from) : null;
          const daysLeft = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : null;
          const san = cert?.subjectaltname ? cert.subjectaltname.split(",").map((s) => s.trim()).slice(0, 10) : [];
          const selfSigned = cert?.issuer?.CN && cert?.subject?.CN ? cert.issuer.CN === cert.subject.CN && san.length === 0 : false;
          const lines = [
            header(`TLS AUDIT — ${t.host}:443`),
            `Protocol    ${proto ?? "?"}   Cipher: ${cipher?.name ?? "?"} (${cipher?.version ?? "?"})`,
            `Subject     CN=${cert?.subject?.CN ?? "?"}  O=${cert?.subject?.O ?? "?"}`,
            `Issuer      CN=${cert?.issuer?.CN ?? "?"}  O=${cert?.issuer?.O ?? "?"}`,
            `Validity    ${validFrom?.toISOString().slice(0, 10) ?? "?"} → ${validTo?.toISOString().slice(0, 10) ?? "?"}  (${daysLeft} days left)`,
            `SAN         ${san.slice(0, 6).join(", ") || "—"}`,
            `Self-signed ${selfSigned ? "YES ⚠" : "no"}`,
            daysLeft !== null && daysLeft < 14 ? "⚠ Certificate expires in < 14 days" : "",
            proto && ["TLSv1", "TLSv1.1"].includes(proto) ? `⚠ Legacy TLS protocol negotiated (${proto}) — upgrade to TLS 1.2+` : "",
          ].filter(Boolean);
          const status: StepStatus = selfSigned || (daysLeft !== null && daysLeft < 14) ? "warn" : "ok";
          finish(() => ({
            id: "tls",
            label: "TLS / certificate audit",
            status,
            ms: Date.now() - start,
            output: lines.join("\n"),
            data: { protocol: proto, cipher: cipher?.name, issuer: cert?.issuer?.CN, subject: cert?.subject?.CN, daysLeft, selfSigned, san },
          }));
        } catch (e) {
          finish(() => ({ id: "tls", label: "TLS / certificate audit", status: "warn", ms: Date.now() - start, output: `${header("TLS AUDIT")}\nCertificate parse error: ${e instanceof Error ? e.message : e}` }));
        }
      }
    );
    socket.on("error", (e) => finish(() => ({ id: "tls", label: "TLS / certificate audit", status: "warn", ms: Date.now() - start, output: `${header("TLS AUDIT")}\nNo TLS service on :443 — ${e.message}` })));
    socket.on("timeout", () => finish(() => ({ id: "tls", label: "TLS / certificate audit", status: "warn", ms: Date.now() - start, output: `${header("TLS AUDIT")}\nTLS handshake timeout on :443` })));
  });
}

const SECURITY_HEADERS: Array<{ name: string; label: string; weight: "high" | "medium" | "low" }> = [
  { name: "strict-transport-security", label: "Strict-Transport-Security (HSTS)", weight: "high" },
  { name: "content-security-policy", label: "Content-Security-Policy (CSP)", weight: "high" },
  { name: "x-frame-options", label: "X-Frame-Options (clickjacking)", weight: "medium" },
  { name: "x-content-type-options", label: "X-Content-Type-Options", weight: "medium" },
  { name: "referrer-policy", label: "Referrer-Policy", weight: "low" },
  { name: "permissions-policy", label: "Permissions-Policy", weight: "low" },
  { name: "cross-origin-opener-policy", label: "Cross-Origin-Opener-Policy", weight: "low" },
  { name: "cross-origin-resource-policy", label: "Cross-Origin-Resource-Policy", weight: "low" },
];

async function stepHeaders(data: HttpProbeData | null): Promise<ReconEvent> {
  const start = Date.now();
  if (!data) return { id: "headers", label: "Security header audit", status: "skip", ms: Date.now() - start, output: "Skipped — HTTP probe failed." };
  const lines = [header("SECURITY HEADER AUDIT")];
  const findings: Array<{ header: string; present: boolean; weight: string; value?: string }> = [];
  for (const h of SECURITY_HEADERS) {
    const v = data.headers[h.name];
    lines.push(`${v ? "✔" : "✗"} ${h.label}${v ? `  →  ${v.slice(0, 110)}` : "  →  MISSING"}`);
    findings.push({ header: h.label, present: Boolean(v), weight: h.weight, value: v?.slice(0, 200) });
  }
  const cookie = data.headers["set-cookie"];
  if (cookie) {
    const flags = {
      secure: /secure/i.test(cookie),
      httpOnly: /httponly/i.test(cookie),
      sameSite: /samesite/i.test(cookie),
    };
    lines.push(`Cookie flags  Secure:${flags.secure ? "✔" : "✗"}  HttpOnly:${flags.httpOnly ? "✔" : "✗"}  SameSite:${flags.sameSite ? "✔" : "✗"}`);
    findings.push({ header: "Cookie hardening (Secure/HttpOnly/SameSite)", present: flags.secure && flags.httpOnly && flags.sameSite, weight: "medium", value: JSON.stringify(flags) });
  } else {
    lines.push("Cookie flags  no cookies observed");
  }
  const missing = findings.filter((f) => !f.present);
  const status: StepStatus = missing.some((m) => m.weight === "high") ? "warn" : missing.length > 3 ? "warn" : "ok";
  return { id: "headers", label: "Security header audit", status, ms: Date.now() - start, output: lines.join("\n"), data: { findings, missing: missing.map((m) => m.header) } };
}

const FINGERPRINTS: Array<{ name: string; version?: RegExp; test: RegExp; where: "body" | "header" }> = [
  { name: "WordPress", test: /wp-content|wp-includes|wp-json/i, where: "body" },
  { name: "Drupal", test: /drupal|sites\/default\/files/i, where: "body" },
  { name: "Joomla", test: /joomla|\/media\/system\/js\//i, where: "body" },
  { name: "Next.js", test: /__NEXT_DATA__|\/_next\//i, where: "body" },
  { name: "Nuxt", test: /__NUXT__|\/_nuxt\//i, where: "body" },
  { name: "React", test: /data-reactroot|react(-dom)?[.@]|_reactListening/i, where: "body" },
  { name: "Vue.js", test: /data-v-[0-9a-f]{8}|vue(\.runtime)?[.@]/i, where: "body" },
  { name: "Angular", test: /ng-version|angular[.@]/i, where: "body" },
  { name: "Laravel", test: /laravel|XSRF-TOKEN/i, where: "body" },
  { name: "Django", test: /csrfmiddlewaretoken|__admin_media_prefix__/i, where: "body" },
  { name: "Shopify", test: /cdn\.shopify\.com|shopify\.theme/i, where: "body" },
  { name: "Squarespace", test: /squarespace/i, where: "body" },
  { name: "Wix", test: /wix(static|site)/i, where: "body" },
  { name: "jQuery", version: /jquery[.-](\d+\.\d+(\.\d+)?)/i, test: /jquery/i, where: "body" },
  { name: "Bootstrap", version: /bootstrap[.-](\d+\.\d+)/i, test: /bootstrap/i, where: "body" },
  { name: "Google Analytics / Tag", test: /googletagmanager|google-analytics|gtag\(/i, where: "body" },
  { name: "Cloudflare", test: /^cloudflare$/i, where: "header" },
  { name: "PHP", version: /PHP\/([\d.]+)/i, test: /php/i, where: "header" },
  { name: "Express", test: /^express$/i, where: "header" },
  { name: "ASP.NET", test: /asp\.net|x-aspnet/i, where: "header" },
];

async function stepTech(data: HttpProbeData | null, t: ResolvedTarget): Promise<ReconEvent> {
  const start = Date.now();
  if (!data) return { id: "tech", label: "Technology fingerprinting", status: "skip", ms: Date.now() - start, output: "Skipped — HTTP probe failed." };
  const found: Array<{ name: string; version?: string; source: string }> = [];
  const generator = data.body.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1];
  if (generator) found.push({ name: generator, source: "meta generator" });
  for (const fp of FINGERPRINTS) {
    const hay = fp.where === "body" ? data.body : Object.values(data.headers).join(" | ") + " " + (data.headers["server"] ?? "");
    if (fp.test.test(hay)) {
      let version: string | undefined;
      if (fp.version) version = hay.match(fp.version)?.[1];
      if (!found.some((f) => f.name.toLowerCase().includes(fp.name.toLowerCase()))) {
        found.push({ name: fp.name + (version ? ` ${version}` : ""), source: fp.where });
      }
    }
  }
  const server = data.headers["server"];
  if (server && !found.some((f) => server.toLowerCase().includes(f.name.toLowerCase()))) {
    found.unshift({ name: server, source: "Server header" });
  }
  const lines = [header("TECHNOLOGY FINGERPRINT")];
  if (found.length === 0) lines.push("No confident fingerprints from passive analysis.");
  for (const f of found.slice(0, 14)) lines.push(`• ${f.name}   (${f.source})`);
  const outdated = found.find((f) => /jquery (\d)/i.test(f.name));
  if (outdated) {
    const major = parseInt(outdated.name.match(/jquery (\d)/i)?.[1] ?? "3", 10);
    if (major < 3) lines.push(`  ⚠ Legacy jQuery major version detected — known XSS vectors in < 3.5`);
  }
  return { id: "tech", label: "Technology fingerprinting", status: "ok", ms: Date.now() - start, output: lines.join("\n"), data: { technologies: found } };
}

async function stepRobots(data: HttpProbeData | null, t: ResolvedTarget): Promise<ReconEvent> {
  const start = Date.now();
  if (!data) return { id: "robots", label: "robots.txt / sitemap analysis", status: "skip", ms: Date.now() - start, output: "Skipped — HTTP probe failed." };
  const origin = new URL(data.finalUrl).origin;
  const lines = [header("ROBOTS.TXT / SITEMAP")];
  const out: Record<string, unknown> = {};
  try {
    const res = await withTimeout((signal) => fetch(`${origin}/robots.txt`, { signal, headers: { "User-Agent": UA } }), 10_000);
    if (res.ok) {
      const txt = (await res.text()).slice(0, 20_000);
      const disallows = [...txt.matchAll(/^\s*disallow:\s*(\S+)/gim)].map((m) => m[1]).filter((d) => d !== "/");
      const interesting = disallows.filter((d) => /admin|privat|secret|backup|config|api|internal|test|dev|panel|login|\.env|\.git/i.test(d)).slice(0, 12);
      lines.push(`robots.txt  200 OK — ${disallows.length} Disallow rule(s)`);
      if (interesting.length) {
        lines.push("Interesting directives:");
        for (const d of interesting) lines.push(`  · Disallow: ${d}`);
      }
      out.robotsDisallows = disallows.slice(0, 50);
      const sitemaps = [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
      if (sitemaps.length) lines.push(`Sitemap     ${sitemaps.slice(0, 3).join(", ")}`);
      out.sitemaps = sitemaps;
    } else {
      lines.push(`robots.txt  ${res.status} — ${res.status === 404 ? "not present" : "error"}`);
    }
  } catch {
    lines.push("robots.txt  fetch failed");
  }
  try {
    const res = await withTimeout((signal) => fetch(`${origin}/sitemap.xml`, { signal, headers: { "User-Agent": UA } }), 10_000);
    if (res.ok) {
      const txt = (await res.text()).slice(0, 4_000);
      const urls = (txt.match(/<loc>/g) ?? []).length;
      lines.push(`sitemap.xml 200 OK — ~${urls} <loc> entries visible`);
      out.sitemapUrls = urls;
    } else {
      lines.push(`sitemap.xml ${res.status}`);
    }
  } catch {
    lines.push("sitemap.xml fetch failed");
  }
  return { id: "robots", label: "robots.txt / sitemap analysis", status: "ok", ms: Date.now() - start, output: lines.join("\n"), data: out };
}

const TOP_PORTS: Array<{ port: number; service: string }> = [
  { port: 21, service: "ftp" }, { port: 22, service: "ssh" }, { port: 23, service: "telnet" },
  { port: 25, service: "smtp" }, { port: 53, service: "dns" }, { port: 80, service: "http" },
  { port: 110, service: "pop3" }, { port: 143, service: "imap" }, { port: 443, service: "https" },
  { port: 445, service: "smb" }, { port: 993, service: "imaps" }, { port: 995, service: "pop3s" },
  { port: 1433, service: "mssql" }, { port: 1723, service: "pptp" }, { port: 3000, service: "node-dev" },
  { port: 3306, service: "mysql" }, { port: 3389, service: "rdp" }, { port: 5432, service: "postgres" },
  { port: 5900, service: "vnc" }, { port: 6379, service: "redis" }, { port: 8000, service: "http-alt" },
  { port: 8080, service: "http-proxy" }, { port: 8443, service: "https-alt" }, { port: 8888, service: "http-alt2" },
  { port: 9200, service: "elasticsearch" }, { port: 27017, service: "mongodb" },
];

async function scanPort(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (open: boolean) => {
      if (!done) { done = true; s.destroy(); resolve(open); }
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => fin(true));
    s.once("timeout", () => fin(false));
    s.once("error", () => fin(false));
    try { s.connect(port, ip); } catch { fin(false); }
  });
}

async function stepPorts(t: ResolvedTarget, profile: ReconProfile): Promise<ReconEvent> {
  const start = Date.now();
  const ip = t.addresses[0];
  const ports = profile === "deep" ? TOP_PORTS : TOP_PORTS.filter((p) => [21, 22, 25, 53, 80, 110, 143, 443, 445, 993, 995, 3306, 3389, 8080, 8443].includes(p.port));
  const open: Array<{ port: number; service: string }> = [];
  const CONC = 12;
  for (let i = 0; i < ports.length; i += CONC) {
    const batch = ports.slice(i, i + CONC);
    const results = await Promise.all(batch.map((p) => scanPort(ip, p.port, 1600)));
    batch.forEach((p, idx) => { if (results[idx]) open.push(p); });
  }
  const lines = [
    header(`PORT SCAN — ${t.host} (${ip})`),
    `Scanned ${ports.length} common ports (pure-TCP connect, timeout 1.6s)`,
    open.length ? `Open: ${open.map((o) => `${o.port}/${o.service}`).join("  ")}` : "No open ports among the scanned common set.",
  ];
  for (const o of open) {
    if ([21, 23, 445, 3306, 6379, 9200, 27017, 5900, 1433].includes(o.port)) {
      lines.push(`  ⚠ ${o.port}/${o.service} exposed to the internet — verify it is intended & firewalled`);
    }
  }
  const status: StepStatus = open.some((o) => [21, 23, 445, 6379, 9200, 27017].includes(o.port)) ? "warn" : "ok";
  return { id: "ports", label: "TCP port scan", status, ms: Date.now() - start, output: lines.join("\n"), data: { scanned: ports.length, open } };
}

const SENSITIVE_PATHS: Array<{ path: string; why: string }> = [
  { path: "/.git/HEAD", why: "exposed git repository (source disclosure)" },
  { path: "/.env", why: "environment file (secrets/credentials)" },
  { path: "/.htaccess", why: "apache config disclosure" },
  { path: "/phpinfo.php", why: "phpinfo page" },
  { path: "/server-status", why: "apache server-status" },
  { path: "/actuator/health", why: "spring boot actuator" },
  { path: "/debug/vars", why: "go pprof/debug vars" },
  { path: "/metrics", why: "prometheus metrics endpoint" },
  { path: "/wp-login.php", why: "wordpress login" },
  { path: "/wp-admin/", why: "wordpress admin" },
  { path: "/administrator/", why: "joomla admin" },
  { path: "/admin", why: "generic admin panel" },
  { path: "/api", why: "API surface" },
  { path: "/graphql", why: "graphql endpoint (introspection risk)" },
  { path: "/.well-known/security.txt", why: "security contact policy" },
  { path: "/backup.zip", why: "backup archive" },
  { path: "/composer.json", why: "dependency manifest" },
  { path: "/package.json", why: "dependency manifest" },
];

async function stepPaths(data: HttpProbeData | null, t: ResolvedTarget): Promise<ReconEvent> {
  const start = Date.now();
  if (!data) return { id: "paths", label: "Sensitive path exposure check", status: "skip", ms: Date.now() - start, output: "Skipped — HTTP probe failed." };
  const origin = new URL(data.finalUrl).origin;
  const lines = [header("SENSITIVE PATH EXPOSURE CHECK")];
  const hits: Array<{ path: string; status: number; why: string; bytes?: number }> = [];
  const CONC = 6;
  for (let i = 0; i < SENSITIVE_PATHS.length; i += CONC) {
    const batch = SENSITIVE_PATHS.slice(i, i + CONC);
    await Promise.all(
      batch.map(async (p) => {
        try {
          const res = await withTimeout((signal) => fetch(`${origin}${p.path}`, { signal, headers: { "User-Agent": UA }, redirect: "manual" }), 8_000);
          if (res.status === 200) {
            let bytes: number | undefined;
            const cl = res.headers.get("content-length");
            if (cl) bytes = parseInt(cl, 10);
            hits.push({ path: p.path, status: 200, why: p.why, bytes });
          }
          try { await res.body?.cancel(); } catch { /* noop */ }
        } catch { /* unreachable path — ignore */ }
      })
    );
  }
  if (hits.length === 0) lines.push("No sensitive paths returned 200 among the checked set. ✔");
  for (const h of hits) lines.push(`⚠ ${h.path}  →  200 (${h.bytes ?? "?"} bytes)  — ${h.why}`);
  const bad = hits.filter((h) => !h.path.includes("security.txt") && h.why.includes("exposed") || ["/.env", "/.git/HEAD", "/phpinfo.php", "/backup.zip"].includes(h.path));
  return { id: "paths", label: "Sensitive path exposure check", status: bad.length ? "warn" : "ok", ms: Date.now() - start, output: lines.join("\n"), data: { hits } };
}

/* ------------------------------ pipeline --------------------------------- */

export type ReconProgress = (event: ReconEvent) => void;

export async function runRecon(
  targetInput: string,
  profile: ReconProfile,
  onProgress: ReconProgress
): Promise<{ target: ResolvedTarget; events: ReconEvent[]; http: HttpProbeData | null }> {
  const events: ReconEvent[] = [];
  const emit = (e: ReconEvent) => { events.push(e); onProgress(e); };

  const t = await resolveAndGuardTarget(targetInput);
  emit({
    id: "guard", label: "Target validation",
    status: "ok", ms: 0,
    output: [
      header("TARGET VALIDATION"),
      `Host        ${t.host}`,
      `Resolved    ${t.addresses.join(", ")}`,
      `Scheme      ${t.scheme}://  ·  profile: ${profile.toUpperCase()}`,
      `Policy      public targets only — private/loopback ranges blocked ✔`,
    ].join("\n"),
    data: { host: t.host, addresses: t.addresses },
  });

  const { event: dnsEvt } = { event: await stepDns(t) };
  emit(dnsEvt);
  emit(await stepWhois(t));

  const { event: httpEvt, data: http } = await stepHttpProbe(t);
  emit(httpEvt);

  emit(await stepTls(t));
  emit(await stepHeaders(http));
  emit(await stepTech(http, t));
  emit(await stepRobots(http, t));
  emit(await stepPorts(t, profile));
  emit(await stepPaths(http, t));

  return { target: t, events, http };
}

/** Compact machine-readable digest handed to the AI analyst. */
export function buildDigest(target: ResolvedTarget, events: ReconEvent[], http: HttpProbeData | null): string {
  const parts: string[] = [];
  parts.push(`TARGET: ${target.host} (${target.addresses.join(", ")}) — ${http?.finalUrl ?? "unreachable"}`);
  for (const e of events) {
    if (e.id === "guard") continue;
    parts.push(`\n### ${e.label} [${e.status.toUpperCase()}]`);
    parts.push(e.output);
  }
  if (http) {
    parts.push("\n### RAW RESPONSE HEADERS");
    parts.push(Object.entries(http.headers).map(([k, v]) => `${k}: ${v}`).join("\n").slice(0, 6_000));
    const bodyBrief = http.body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_500);
    if (bodyBrief) parts.push("\n### PAGE TEXT EXCERPT (fingerprint context)\n" + bodyBrief);
  }
  return parts.join("\n").slice(0, 58_000);
}
