import { NextRequest, NextResponse } from "next/server";
import { shopSearch, itemQuery, loginQuery, PRODUCTS, RANGE_VERSION, RANGE_FLAG } from "@/lib/pentest/range-data";

/**
 * VULNSHOP — the built-in deliberately vulnerable practice target.
 * A catch-all route serving every /api/range/* path. DELIBERATELY insecure:
 * SQL injection (string + numeric contexts), auth bypass, exposed files.
 * Read-only emulation — nothing can be modified or destroyed.
 */

export const dynamic = "force-dynamic";

const SERVER = "Apache/2.4.41 (Ubuntu)";
const POWERED = "PHP/7.4.3";

function page(body: string, status = 200, contentType = "text/html; charset=utf-8"): NextResponse {
  const res = new NextResponse(body, { status, headers: { "Content-Type": contentType } });
  res.headers.set("Server", SERVER);
  res.headers.set("X-Powered-By", POWERED);
  res.headers.set("X-Practice-Range", "VULNSHOP - deliberately vulnerable, do not use for real workloads");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

const STYLE = `
  body { font-family: Verdana, Arial, sans-serif; background:#e8e4d8; margin:0; }
  header { background:#4b3b2a; color:#f5ecd0; padding:14px 22px; }
  header h1 { margin:0; font-size:22px; letter-spacing:1px; }
  header .sub { font-size:11px; color:#cbb98a; }
  nav { background:#6b5a42; padding:6px 22px; }
  nav a { color:#f5ecd0; margin-right:14px; font-size:13px; text-decoration:none; }
  main { max-width:860px; margin:18px auto; background:#fffdf4; border:1px solid #b8a888; padding:18px 24px; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th, td { border:1px solid #c5b795; padding:5px 8px; text-align:left; }
  th { background:#efe6c8; }
  .err { background:#ffd7d0; border:2px solid #cc3322; color:#8a1100; padding:12px 16px; font-family:monospace; font-size:12px; white-space:pre-wrap; }
  .ok { background:#d8f0c8; border:2px solid #447722; padding:12px 16px; }
  footer { text-align:center; color:#99886a; font-size:11px; padding:14px; }
  input[type=text], input[type=password] { border:1px solid #b8a888; padding:4px 6px; }
  button { background:#4b3b2a; color:#f5ecd0; border:0; padding:6px 14px; cursor:pointer; }
`;

function shell(title: string, content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title} — VULNSHOP</title><style>${STYLE}</style></head>
<body>
<header><h1>⚔ VULNSHOP</h1><div class="sub">adventurer supplies since 1999 — PHP 7.4.3 / Apache 2.4.41 / MySQL 8</div></header>
<nav><a href="/api/range/home">Home</a><a href="/api/range/shop">Shop</a><a href="/api/range/item?id=1">Items</a><a href="/api/range/admin">Admin</a><a href="/api/range/uploads">Uploads</a></nav>
<main>
<!-- TODO(cody): rewrite query builder, this search is still string-concatenated -->
<!-- FIXME: login page still vulnerable since 2016, low priority -->
${content}
</main>
<footer>VULNSHOP v1.2.0 © 1999-2026 · powered by legacy · practice range only</footer>
</body></html>`;
}

function esc(s: string | number | null): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Row = { id: number; name: string; price: number; stock: number; category: string; internal_note: string };

function shopTable(rows: Array<Row | Array<string | number | null>>, union = false): string {
  const head = `<tr><th>id</th><th>name</th><th>price</th><th>stock</th><th>category</th><th>internal_note</th></tr>`;
  const body = rows.map((r) => {
    if (union && Array.isArray(r)) {
      return `<tr>${r.map((v) => `<td>${esc(v ?? "NULL")}</td>`).join("")}</tr>`;
    }
    const p = r as Row;
    return `<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>$${Number(p.price).toFixed(2)}</td><td>${p.stock}</td><td>${esc(p.category)}</td><td>${esc(p.internal_note)}</td></tr>`;
  }).join("");
  return `<table>${head}${body || `<tr><td colspan="6">No items matched your search.</td></tr>`}</table>`;
}

async function handleGet(path: string[], sp: URLSearchParams): Promise<NextResponse> {
  const route = path.join("/");

  switch (route) {
    case "":
    case "home": {
      const content = `
<h2>Welcome to VULNSHOP</h2>
<p>Finest adventurer equipment at knock-down prices! Browse our <a href="/api/range/shop">catalog</a> or search below.</p>
<form method="get" action="/api/range/shop">
  <input type="text" name="search" placeholder="search items…" value="">
  <button type="submit">Search</button>
</form>
<h3>Featured items</h3>
${shopTable(PRODUCTS.slice(0, 3))}
<p style="font-size:11px;color:#99886a">DB: mysql8@vulnshop-db-01 · admin portal: <a href="/api/range/admin">/admin</a></p>`;
      return page(shell("Welcome", content));
    }

    case "shop": {
      const search = sp.get("search") ?? "";
      const outcome = shopSearch(search);
      if (outcome.kind === "delay") {
        await new Promise((r) => setTimeout(r, outcome.seconds * 1000));
        return shopResponse(outcome.then);
      }
      return shopResponse(outcome);
    }

    case "item": {
      const id = sp.get("id") ?? "";
      const outcome = itemQuery(id);
      if (outcome.kind === "delay") {
        await new Promise((r) => setTimeout(r, outcome.seconds * 1000));
        return itemResponse(outcome.then, id);
      }
      return itemResponse(outcome, id);
    }

    case "login": {
      const err = sp.get("err");
      const content = `
<h2>Customer login</h2>
${err ? `<div class="err">Login error: ${esc(err)}</div>` : ""}
<form method="post" action="/api/range/login">
  <label>Username <input type="text" name="username" value=""></label><br><br>
  <label>Password <input type="password" name="password" value=""></label><br><br>
  <button type="submit">Sign in</button>
</form>
<p style="font-size:11px;color:#99886a">staff area: <a href="/api/range/admin">/admin</a></p>`;
      return page(shell("Login", content));
    }

    case "admin": {
      const content = `
<h2>🛡 VULNSHOP — Admin Control Panel</h2>
<p>Authorized staff only. All actions are logged.</p>
<form method="post" action="/api/range/login?admin=1">
  <label>Admin user <input type="text" name="username" value=""></label><br><br>
  <label>Admin pass <input type="password" name="password" value=""></label><br><br>
  <button type="submit">Enter panel</button>
</form>
<!-- dev note: backup of the site lives at /backup.zip, db dump at /db.sql -->`;
      return page(shell("Admin", content));
    }

    case "robots.txt":
      return page(
        `User-agent: *\nDisallow: /admin\nDisallow: /api/range/.env\nDisallow: /backup.zip\nDisallow: /db.sql\nDisallow: /uploads/\n\n# sitemap: /sitemap.xml\n`,
        200,
        "text/plain"
      );

    case ".env":
      return page(
        `APP_NAME=VULNSHOP\nAPP_ENV=production\nAPP_KEY=base64:Kk9x2mV8wQ1pLz4rTn7YhG6fDs3aJc5b\n\nDB_HOST=vulnshop-db-01\nDB_DATABASE=vulnshop\nDB_USERNAME=root\nDB_PASSWORD=Sup3rS3cret!\nDB_VERSION=${RANGE_VERSION}\n\nMAIL_HOST=mail.vulnshop.internal\nMAIL_PASSWORD=hunter2\n\nSTRIPE_KEY=sk_live_51H8xYzEXAMPLE0000\nADMIN_BACKUP_TOKEN=${RANGE_FLAG}\n`,
        200,
        "text/plain"
      );

    case ".git/HEAD":
      return page(`ref: refs/heads/main\n`, 200, "text/plain");

    case "phpinfo.php": {
      const rows: Array<[string, string]> = [
        ["PHP Version", "7.4.3-4ubuntu2.19"],
        ["System", "Linux vulnshop-web-01 5.15.0-91-generic #101-Ubuntu SMP x86_64"],
        ["Server API", "Apache 2.0 Handler"],
        ["Loaded Configuration File", "/etc/php/7.4/apache2/php.ini"],
        ["display_errors", "On"],
        ["expose_php", "On"],
        ["allow_url_include", "On"],
        ["session.save_path", "/var/lib/php/sessions"],
        ["MYSQL_DEFAULT_SOCKET", "/var/run/mysqld/mysqld.sock"],
      ];
      const content = `<h2>phpinfo()</h2><table>${rows.map(([k, v]) => `<tr><th style="width:280px">${k}</th><td>${v}</td></tr>`).join("")}</table>`;
      return page(shell("phpinfo", content));
    }

    case "uploads": {
      const files = ["avatar_admin.png", "invoice_2026-03.pdf", "product_cloak_hi.jpg", "stock_export_v2.xlsx", "backup_2025-12.tar.gz", "note_from_ceo.txt"];
      const content = `<h1>Index of /uploads</h1><table>${files.map((f) => `<tr><td><a href="#">${f}</a></td><td>${(Math.random() * 900 + 50).toFixed(0)} KB</td></tr>`).join("")}</table>`;
      return page(`<html><head><title>Index of /uploads</title></head><body>${content}</body></html>`);
    }

    case "backup.zip":
      return page("PK\u0003\u0004\u0014\u0000\u0000\u0000\u0008\u0000VULNSHOP_FULL_BACKUP_2026_01 www/html [simulated archive — contents: source code + config + db dump]", 200, "application/zip");

    case "db.sql":
      return page(
        `-- MySQL dump 10.13  Distrib 8.0.36\n--\n-- Host: localhost    Database: vulnshop\n--\nCREATE TABLE users (\n  id int NOT NULL AUTO_INCREMENT,\n  user varchar(64),\n  pass varchar(128),\n  role varchar(32),\n  PRIMARY KEY (id)\n);\nINSERT INTO users VALUES (1,'admin','<hash:bcrypt>','administrator');\nINSERT INTO users VALUES (2,'guest','<hash:bcrypt>','customer');\n`,
        200,
        "text/plain"
      );

    case "sitemap.xml":
      return page(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>/api/range/home</loc></url>\n<url><loc>/api/range/shop</loc></url>\n<url><loc>/api/range/admin</loc></url>\n</urlset>`, 200, "application/xml");

    case "security.txt":
    case ".well-known/security.txt":
      return page(`Contact: mailto:security@vulnshop.invalid\nExpires: 2027-01-01T00:00:00Z\nPreferred-Languages: en\n`, 200, "text/plain");

    default:
      return page(
        `{"error":"not_found","path":"/api/range/${route}","range":"VULNSHOP"}`,
        404,
        "application/json"
      );
  }
}

function shopResponse(outcome: ReturnType<typeof shopSearch>): NextResponse {
  if (outcome.kind === "error") {
    const content = `<h2>Search results</h2><div class="err">Fatal error: Uncaught mysqli_sql_exception: ${esc(outcome.message)} in /var/www/html/shop.php:42\nStack trace:\n#0 /var/www/html/shop.php(42): mysqli-&gt;query('SELECT * FROM p...')\n#1 {main}\n  thrown in /var/www/html/shop.php on line 42</div>`;
    return page(shell("Shop error", content), 500);
  }
  if (outcome.kind === "rows") {
    const rows = outcome.rows;
    const content = `<h2>Search results</h2><p>${rows.length} item(s) found.</p>${shopTable(rows, outcome.union)}`;
    return page(shell("Shop", content));
  }
  return page(shell("Shop", "<h2>Search results</h2>"));
}

function itemResponse(outcome: ReturnType<typeof itemQuery>, idRaw: string): NextResponse {
  if (outcome.kind === "error") {
    const content = `<h2>Item detail</h2><div class="err">Fatal error: Uncaught mysqli_sql_exception: ${esc(outcome.message)} in /var/www/html/item.php:28\nStack trace:\n#0 /var/www/html/item.php(28): mysqli-&gt;query('SELECT * FROM p...')\n#1 {main}\n  thrown in /var/www/html/item.php on line 28</div>`;
    return page(shell("Item error", content), 500);
  }
  if (outcome.kind === "rows") {
    const first = outcome.rows[0];
    if (outcome.union && first && Array.isArray(first)) {
      const content = `<h2>Item detail</h2><table>${first.map((v, i) => `<tr><th>col_${i}</th><td>${esc(v ?? "NULL")}</td></tr>`).join("")}</table>`;
      return page(shell("Item", content));
    }
    if (!first) {
      const content = `<h2>Item detail</h2><p>Item id=${esc(idRaw)} not found.</p>`;
      return page(shell("Item", content));
    }
    const p = first as Row;
    const content = `<h2>${esc(p.name)}</h2>
<p>Category: ${esc(p.category)} · Price: $${Number(p.price).toFixed(2)} · Stock: ${p.stock}</p>
<p><em>Internal note:</em> ${esc(p.internal_note)}</p>
<p><a href="/api/range/shop">← back to shop</a></p>`;
    return page(shell(String(p.name), content));
  }
  return page(shell("Item", `<h2>Item detail</h2><p>Nothing found for id=${esc(idRaw)}.</p>`));
}

async function handlePost(path: string[], form: URLSearchParams): Promise<NextResponse> {
  const route = path.join("/");

  if (route === "login") {
    const username = form.get("username") ?? "";
    const password = form.get("password") ?? "";
    let outcome = loginQuery(username, password);
    if (outcome.kind === "delay") {
      const secs = outcome.seconds;
      await new Promise((r) => setTimeout(r, secs * 1000));
      outcome = outcome.then;
    }
    if (outcome.kind === "error") {
      const content = `<h2>Customer login</h2><div class="err">Fatal error: Uncaught mysqli_sql_exception: ${esc(outcome.message)} in /var/www/html/login.php:19\nStack trace:\n#0 /var/www/html/login.php(19): mysqli-&gt;query('SELECT * FROM u...')\n#1 {main}\n  thrown in /var/www/html/login.php on line 19</div>`;
      return page(shell("Login error", content), 500);
    }
    if (outcome.kind === "auth") {
      const content = `<div class="ok"><h2>Welcome back, ${esc(outcome.user)}!</h2><p>Role: <strong>${esc(outcome.role)}</strong></p><p>Session: ${esc(outcome.role === "administrator" ? RANGE_FLAG : "guest-session")}</p><p><a href="/api/range/admin">Go to admin panel →</a></p></div>`;
      return page(shell("Logged in", content));
    }
    return page(shell("Login", `<h2>Customer login</h2><div class="err">Invalid username or password.</div><p><a href="/api/range/login">try again</a></p>`), 401);
  }

  return page(shell("404", `<h2>404 — page not found</h2>`), 404);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  return handleGet(path, sp);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  let form = new URLSearchParams();
  try {
    const text = await req.text();
    form = new URLSearchParams(text);
  } catch { /* empty body */ }
  return handlePost(path, form);
}
