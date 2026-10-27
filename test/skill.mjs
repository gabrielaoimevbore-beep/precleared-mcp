// Tests for skills/cold-email-check/scripts/check.mjs against a fake API on localhost.
// No network and no real checks: run with `node test/skill.mjs`.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPayload, factsHash, VERSION } from "../skills/cold-email-check/scripts/check.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "skills/cold-email-check/scripts/check.mjs");
const KEY = "pc_live_" + "A1b2C3d4".repeat(4);
const BOM = String.fromCharCode(0xfeff);
const dir = mkdtempSync(join(tmpdir(), "precleared-skill-test-"));

// ---------- fake API ----------
const seen = [];
let delayMs = 0;
let failAll = false;
const elsewhere = [];

const decoy = http.createServer((req, res) => {
  elsewhere.push(req.url);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ verdict: "ok_to_email" }));
});
await new Promise((r) => decoy.listen(0, "127.0.0.1", r));

function answer(body) {
  const email = String(body.recipient_email ?? body.recipient_domain ?? "");
  if (email.includes("redirect")) return [307, null, { Location: `http://127.0.0.1:${decoy.address().port}/api/v1/check` }];
  if (failAll || email.includes("boom")) return [500, { error: "server_error", message: "The check could not be completed. Try again." }];
  if (email.includes("limit")) return [429, { error: "daily_limit", message: "Keyless use is limited to 10 checks a day per network.", get_key_url: "https://precleared.dev/get-key" }];
  if (email.includes("pay")) return [402, { error: "payment_required", message: "Today's free checks are used and there are no credits left.", buy_url: "https://precleared.dev/#pricing" }];
  if (email.includes("html")) return [200, "<html>not json</html>"];
  if (email.includes("array")) return [200, []];
  const verdict = email.includes("consent") ? "consent_needed" : email.includes("blocked") ? "blocked" : email.includes("unknown") ? "unknown" : "ok_to_email";
  const reasons =
    verdict === "unknown"
      ? [{ note: "No rule matched these facts" }]
      : [{ rule_key: "gb_corporate_ok", text: `Rule for ${verdict}`, source_title: "PECR 2003 regulation 22", source_url: "https://example.org/pecr" }, { note: "A note" }];
  const n = seen.length;
  return [
    200,
    {
      verdict,
      confidence: "high",
      reasons,
      footer_text: verdict === "ok_to_email" ? "Say who you are, give a postal address and a free way to opt out." : null,
      next_step: verdict === "ok_to_email" ? "Send." : "Do not send a cold email.",
      receipt: { id: `cc_rcpt_${String(n).padStart(16, "0")}`, created_at: new Date().toISOString(), verify_url: "x" },
      usage: { free_remaining_today: 100 - n, credits_remaining: 0 },
    },
  ];
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const who = String(body.recipient_email ?? "");
    const wait = who.includes("hang") ? 5000 : delayMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const [status, out, extra = {}] = answer(body);
    if (res.destroyed) return;
    res.writeHead(status, { "Content-Type": typeof out === "string" ? "text/html" : "application/json", ...extra });
    res.end(out === null ? "" : typeof out === "string" ? out : JSON.stringify(out));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const API = `http://127.0.0.1:${server.address().port}/api/v1/check`;
const ORIGIN = new URL(API).origin;

// ---------- harness ----------
function run(args, env = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      { env: { PATH: process.env.PATH, PRECLEARED_API_URL: API, ...env }, timeout: 60000 },
      (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, stdout, stderr, ms: Date.now() - started }),
    );
  });
}
const lines = (s) => s.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const lastJson = (s) => JSON.parse(s.trim().split("\n").filter(Boolean).pop());
let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) passed++;
  else {
    failed++;
    console.log(`FAIL ${name} ${String(detail).slice(0, 600)}`);
  }
}
const csvRows = (path) => {
  let text = readFileSync(path, "utf8");
  if (text.startsWith(BOM)) text = text.slice(1);
  if (/^sep=/.test(text)) text = text.slice(text.indexOf("\n") + 1);
  const firstLine = text.split("\n")[0];
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  return rows;
};
const ok = ["--sender", "GB", "--source", "published"];

// ---------- versions ----------
{
  const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
  const skill = readFileSync(join(ROOT, "skills/cold-email-check/SKILL.md"), "utf8");
  const skillVersion = /^\s+version:\s*"([^"]+)"/m.exec(skill)?.[1];
  check("plugin, skill and script versions match", plugin.version === VERSION && skillVersion === VERSION, `${plugin.version} ${skillVersion} ${VERSION}`);
}

// ---------- one address ----------
{
  seen.length = 0;
  const r = await run(["--email", "Jane Smith <jane@acme.co.uk>", "--sender", "gb", "--source", "Published", "--pitch", "  bookkeeping software  ", "--country", "Germany", "--company-number", "0123 4567", "--pitch-relevant", "--existing-customer"], { PRECLEARED_API_KEY: KEY });
  const out = JSON.parse(r.stdout);
  check("single ok exit 0", r.code === 0, JSON.stringify(r));
  check("single ok verdict", out.verdict === "ok_to_email" && out.send === true);
  check("single ok rule and source", out.rule === "Rule for ok_to_email" && out.rule_source === "PECR 2003 regulation 22" && out.rule_source_url === "https://example.org/pecr");
  check("single ok receipt url", out.receipt_url === `${ORIGIN}/r/${out.receipt_id}` && out.receipt_id.startsWith("cc_rcpt_"));
  check("single ok footer and usage", out.footer_text.startsWith("Say who") && out.usage.free_remaining_today === 99 && out.usage.credits_remaining === 0, JSON.stringify(out.usage));
  check("single ok notes and time", Array.isArray(out.notes) && out.notes[0] === "A note" && !Number.isNaN(Date.parse(out.checked_at)));
  const req = seen[0];
  check("one request", seen.length === 1);
  check("request body normalised", JSON.stringify(req.body) === JSON.stringify({ recipient_email: "jane@acme.co.uk", sender_country: "GB", address_source: "published", pitch: "bookkeeping software", recipient_country: "DE", company_number: "01234567", pitch_relevant: true, existing_customer: true }), JSON.stringify(req.body));
  check("bearer key sent", req.headers.authorization === `Bearer ${KEY}`);
  check("user agent", req.headers["user-agent"] === `precleared-skill/${VERSION} (cold-email-check)`, req.headers["user-agent"]);
  check("key never printed", !r.stdout.includes(KEY) && !r.stderr.includes(KEY));
}
{
  seen.length = 0;
  const r = await run(["--domain", "https://www.Acme.co.uk/about?x=1", "--sender", "US", "--source", "scraped", "--pitch-not-relevant"]);
  check("domain check exit 0", r.code === 0, r.stdout);
  check("domain normalised", seen[0]?.body.recipient_domain === "acme.co.uk" && seen[0]?.body.pitch_relevant === false && !("recipient_email" in seen[0].body));
  check("no key header without key", seen[0] && seen[0].headers.authorization === undefined);
}
{
  seen.length = 0;
  const r = await run(["--email", "omar@example-trading.ae", "--sender", "ae", "--source", "published"]);
  check("UAE sender accepted", r.code === 0 && seen[0]?.body.sender_country === "AE", JSON.stringify(seen[0]?.body));
}
{
  seen.length = 0;
  const r = await run(["--email", "mailto:Jane@Acme.co.uk?subject=Hello", ...ok]);
  check("mailto link and query stripped", r.code === 0 && seen[0]?.body.recipient_email === "jane@acme.co.uk", JSON.stringify(seen[0]?.body));
}
for (const [input, code] of [["Spain", "ES"], ["U.K.", "GB"], ["the Netherlands", "NL"], ["Cote d'Ivoire", "CI"], ["usa", "US"], ["fr", "FR"]]) {
  seen.length = 0;
  const r = await run(["--email", "a@acme.example", ...ok, "--country", input]);
  check(`country "${input}" is ${code}`, r.code === 0 && seen[0]?.body.recipient_country === code, `${r.stdout} ${JSON.stringify(seen[0]?.body)}`);
}
for (const [email, verdict] of [["consent@acme.de", "consent_needed"], ["blocked@acme.de", "blocked"], ["unknown@acme.de", "unknown"]]) {
  const r = await run(["--email", email, "--sender", "GB", "--source", "bought"]);
  const out = JSON.parse(r.stdout);
  check(`single ${verdict} exit 2`, r.code === 2, r.stdout);
  check(`single ${verdict} send false`, out.verdict === verdict && out.send === false);
  if (verdict === "unknown") check("unknown uses the note as the rule", out.rule === "No rule matched these facts");
}
for (const [email, error, link] of [["limit@acme.de", "daily_limit", "get_key_url"], ["pay@acme.de", "payment_required", "buy_url"], ["html@acme.de", "unexpected_response", null], ["array@acme.de", "unexpected_response", null], ["boom@acme.de", "server_error", null]]) {
  seen.length = 0;
  const r = await run(["--email", email, ...ok]);
  const out = JSON.parse(r.stdout);
  check(`single ${error} (${email}) exit 3`, r.code === 3, r.stdout);
  check(`single ${error} no verdict`, out.verdict === null && out.send === false && out.error === error, r.stdout);
  if (link) check(`single ${error} link`, typeof out[link] === "string");
  if (error === "server_error") check("single mode retries a server error once", seen.length === 2, String(seen.length));
}
{
  const r = await run(["--email", "a@acme.de", ...ok], { PRECLEARED_API_URL: "http://127.0.0.1:1/api/v1/check" });
  check("unreachable exit 3", r.code === 3 && JSON.parse(r.stdout).error === "unreachable", r.stdout);
}
{
  seen.length = 0;
  elsewhere.length = 0;
  const r = await run(["--email", "redirect@acme.de", ...ok]);
  check("redirects are not followed", r.code === 3 && elsewhere.length === 0 && JSON.parse(r.stdout).verdict === null, `${r.code} ${r.stdout} ${elsewhere.length}`);
}
{
  seen.length = 0;
  const cases = [
    [["--email", "a@acme.de", "--sender", "GB"], "missing source"],
    [["--email", "not-an-email", ...ok], "bad email"],
    [["--email", "a@acme.de", "--sender", "FR", "--source", "published"], "sender not covered"],
    [["--email", "a@acme.de", "--source", "published"], "no sender"],
    [["--email", "a@acme.de", "--sender", "GB", "--source", "found"], "bad source"],
    [["--email", "a@acme.de", ...ok, "--country", "Atlantis"], "unknown country name"],
    [["--email", "a@acme.de", ...ok, "--country", "XX"], "unknown country code"],
    [["--email", "Jane <jane@acme.co.uk>, Bob <bob@other.com>", ...ok], "two addresses"],
    [["--email", "a@acme.de", ...ok, "--pitch", "x".repeat(2001)], "pitch too long"],
    [["--email", "a@acme.de", "--domain", "acme.de", ...ok], "email and domain"],
    [["--email", "a@acme.de", ...ok, "--time-limit", "10"], "time limit without a file"],
    [["--email", "a@acme.de", ...ok, "--colour", "red"], "unknown flag"],
    [["--email"], "missing value"],
    [["--email", "--sender", "GB"], "flag as a value"],
    [["--email", "a@acme.de", ...ok, "--out", "x.csv"], "out without file"],
    [["--email", "a@acme.de", ...ok, "--pitch-relevant", "--pitch-not-relevant"], "both relevance flags"],
    [[], "no arguments"],
  ];
  for (const [args, name] of cases) {
    const r = await run(args);
    check(`usage: ${name} exit 1`, r.code === 1, `${r.code} ${r.stdout.slice(0, 200)}`);
  }
  const help = await run(["--help"]);
  check("help exit 0", help.code === 0 && help.stdout.includes("Exit codes") && help.stdout.includes("--source SOURCE"));
  check("usage errors make no requests", seen.length === 0, String(seen.length));
  const missing = await run(["--email", "a@acme.de", "--sender", "GB"]);
  check("missing source says to ask the user", /Ask the user/.test(JSON.parse(missing.stdout).message), missing.stdout);
}
{
  seen.length = 0;
  const env = { PRECLEARED_SENDER_COUNTRY: "GB", PRECLEARED_API_KEY: KEY };
  const r = await run(["--email", "a@acme.de", "--source", "given", "--pitch", "--50% off", "--dry-run"], env);
  const out = JSON.parse(r.stdout);
  check("dry run exit 0", r.code === 0, r.stdout);
  check("dry run shows payload", out.dry_run === true && out.payload.sender_country === "GB" && out.payload.pitch === "--50% off" && out.key === "set", r.stdout);
  check("dry run sends nothing", seen.length === 0);
  check("dry run hides the key", !r.stdout.includes(KEY));
}
{
  seen.length = 0;
  const bad = await run(["--email", "a@acme.de", ...ok], { PRECLEARED_API_KEY: "sk_live_wrong" });
  check("malformed key exit 1", bad.code === 1 && seen.length === 0, bad.stdout);
  const evil = await run(["--email", "a@acme.de", ...ok], { PRECLEARED_API_URL: "https://evil.example.com/api/v1/check" });
  check("foreign API URL refused", evil.code === 1 && /precleared.dev/.test(evil.stdout), evil.stdout);
  const look = await run(["--email", "a@acme.de", ...ok], { PRECLEARED_API_URL: "https://precleared.dev.evil.com/x" });
  check("look-alike API URL refused", look.code === 1, look.stdout);
}

// ---------- lists ----------
{
  seen.length = 0;
  const input = join(dir, "leads.csv");
  const out = join(dir, "leads-checked.csv");
  writeFileSync(
    input,
    BOM + "Name;Email Address;Country;Source;Notes\r\n" +
      'Jane;jane@acme.co.uk;UK;published;"likes ""tea""; and cake"\r\n' +
      "Joe;consent@acme.de;DE;bought;\r\n" +
      "Jane again;JANE@acme.co.uk ;UK;published;\r\n" +
      "Jane copy;jane@acme.co.uk;United Kingdom;published;\r\n" +
      "Bad;not-an-email;UK;published;\r\n" +
      "No source;nosource@acme.fr;FR;;\r\n" +
      "Spain;ana@acme.es;Spain;published;\r\n" +
      ";;;;\r\n",
  );
  const r = await run(["--file", input, "--sender", "GB", "--pitch", "tea", "--out", out, "--delay-ms", "0"]);
  const { summary } = JSON.parse(r.stdout);
  check("csv list with bad rows exits 3", r.code === 3, `${r.code} ${r.stdout} ${r.stderr}`);
  check("csv summary counts", summary.rows === 7 && summary.checked === 5 && summary.invalid_rows === 2 && summary.repeated_rows === 2 && summary.checks_made === 3 && summary.not_checked === 0, JSON.stringify(summary));
  check("csv summary message", /precleared_send is yes/.test(summary.message) && /missing or unreadable facts \(row 5/.test(summary.message), summary.message);
  check("csv summary shows the columns used", summary.columns.email[0] === "Email Address" && summary.columns.source[0] === "Source", JSON.stringify(summary.columns));
  check("csv made one request per distinct question", seen.length === 3, String(seen.length));
  check("Spain sent as ES", seen.find((s) => s.body.recipient_email === "ana@acme.es")?.body.recipient_country === "ES");
  check("UK mapped to GB", seen[0].body.recipient_country === "GB" && seen[0].body.pitch === "tea");
  const rows = csvRows(out);
  const header = rows[0];
  const col = (name) => header.indexOf(name);
  check("csv keeps original columns first", header.slice(0, 5).join("|") === "Name|Email Address|Country|Source|Notes", header.join("|"));
  check("csv adds result columns", ["precleared_verdict", "precleared_send", "precleared_receipt_id", "precleared_checked_at", "precleared_facts_hash"].every((c) => header.includes(c)));
  check("csv keeps quoted field", rows[1][4] === 'likes "tea"; and cake', rows[1][4]);
  check("csv row 1 ok", rows[1][col("precleared_verdict")] === "ok_to_email" && rows[1][col("precleared_send")] === "yes");
  check("csv row 2 consent", rows[2][col("precleared_verdict")] === "consent_needed" && rows[2][col("precleared_send")] === "no");
  check("csv repeated row reuses the receipt", rows[4][col("precleared_receipt_id")] === rows[1][col("precleared_receipt_id")]);
  check("csv same address in other case reuses the answer", rows[3][col("precleared_receipt_id")] === rows[1][col("precleared_receipt_id")]);
  check("csv invalid rows explained and not sendable", /invalid_row/.test(rows[5][col("precleared_error")]) && /Ask the user/.test(rows[6][col("precleared_error")]) && rows[6][col("precleared_send")] === "", rows[6][col("precleared_error")]);
  const raw = readFileSync(out, "utf8");
  check("csv output keeps BOM, semicolons and CRLF", raw.startsWith(BOM) && raw.includes(";precleared_verdict;") && raw.includes("\r\n"));

  // A second run keeps every answer and makes no new requests.
  seen.length = 0;
  const again = await run(["--file", input, "--sender", "GB", "--pitch", "tea", "--out", out, "--delay-ms", "0"]);
  const s2 = JSON.parse(again.stdout).summary;
  check("rerun makes no requests", seen.length === 0 && s2.from_earlier_run === 5 && s2.checks_made === 0, JSON.stringify(s2));
  check("rerun keeps receipts", csvRows(out)[1][col("precleared_receipt_id")] === rows[1][col("precleared_receipt_id")]);

  // Answers are kept whatever their age; the summary says how old the oldest is.
  writeFileSync(out, readFileSync(out, "utf8").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "2026-01-01T00:00:00.000Z"));
  seen.length = 0;
  const old = await run(["--file", input, "--sender", "GB", "--pitch", "tea", "--out", out, "--delay-ms", "0"]);
  const s3 = JSON.parse(old.stdout).summary;
  check("old answers are kept, with their date", seen.length === 0 && s3.oldest_reused_check === "2026-01-01T00:00:00.000Z" && /new --out file/.test(s3.message), JSON.stringify(s3));

  // A row added at the top doesn't make the others count as new.
  const shifted = join(dir, "leads-shifted.csv");
  const original = readFileSync(input, "utf8");
  writeFileSync(shifted, original.replace("Notes\r\n", "Notes\r\nNew;new@acme.co.uk;UK;published;\r\n"));
  seen.length = 0;
  const moved = await run(["--file", shifted, "--sender", "GB", "--pitch", "tea", "--out", out, "--delay-ms", "0"]);
  check("answers follow the address, not the row number", seen.length === 1 && seen[0].body.recipient_email === "new@acme.co.uk" && JSON.parse(moved.stdout).summary.from_earlier_run === 5, `${seen.length} ${moved.stdout}`);

  // Different facts mean a different question, so earlier answers are not reused.
  seen.length = 0;
  const changed = await run(["--file", input, "--sender", "GB", "--pitch", "coffee", "--out", out, "--delay-ms", "0"]);
  check("changed facts are checked again", seen.length === 3 && JSON.parse(changed.stdout).summary.from_earlier_run === 0, changed.stdout);
}
{
  seen.length = 0;
  const input = join(dir, "countries.csv");
  writeFileSync(input, "email,country\na@acme.example,Atlantis\nb@acme.example,\n");
  const r = await run(["--file", input, ...ok, "--country", "GB", "--delay-ms", "0"]);
  const rows = lines(r.stdout);
  check("an unreadable row country is not replaced by --country", rows[0].error === "invalid_row" && seen.length === 1 && seen[0].body.recipient_email === "b@acme.example" && seen[0].body.recipient_country === "GB", r.stdout);
}
{
  seen.length = 0;
  const input = join(dir, "optout.csv");
  writeFileSync(input, "Email,Do Not Email,Unsubscribed\na@acme.example,TRUE,\nb@acme.example,,yes\nc@acme.example,false,no\n");
  const r = await run(["--file", input, ...ok, "--delay-ms", "0"]);
  const bodies = Object.fromEntries(seen.map((s) => [s.body.recipient_email, s.body.suppressed]));
  check("opt-out columns are sent as suppressed", bodies["a@acme.example"] === true && bodies["b@acme.example"] === true && bodies["c@acme.example"] === false, JSON.stringify(bodies));
  check("opt-out columns are listed in the summary", JSON.parse(r.stderr.trim()).summary.columns.suppressed.join("|") === "Do Not Email|Unsubscribed", r.stderr);
}
{
  seen.length = 0;
  const input = join(dir, "twocell.csv");
  writeFileSync(input, 'email\n"Jane <jane@acme.co.uk>, Bob <bob@other.com>"\nok@acme.example\n');
  const r = await run(["--file", input, ...ok, "--delay-ms", "0"]);
  const rows = lines(r.stdout);
  check("a cell with two addresses is not checked", rows[0].error === "invalid_row" && /More than one address/.test(rows[0].message) && seen.length === 1 && r.code === 3, r.stdout);
}
{
  seen.length = 0;
  const input = join(dir, "plain2.csv");
  writeFileSync(input, "email\na@acme.example\nb@acme.example\n");
  const noSender = await run(["--file", input, "--source", "published"]);
  check("list without a sender exits 1 before checking", noSender.code === 1 && /Ask the user/.test(noSender.stdout), noSender.stdout);
  const fr = await run(["--file", input, "--sender", "FR", "--source", "published"]);
  check("list with an uncovered sender exits 1", fr.code === 1, fr.stdout);
  const found = await run(["--file", input, "--sender", "GB", "--source", "found"]);
  check("list with a bad --source exits 1", found.code === 1, found.stdout);
  const noSource = await run(["--file", input, "--sender", "GB"]);
  check("list with no source anywhere exits 1", noSource.code === 1 && /source column/.test(noSource.stdout), noSource.stdout);
  const emptyLimit = await run(["--file", input, ...ok, "--time-limit", ""]);
  check("an empty --time-limit is refused", emptyLimit.code === 1, emptyLimit.stdout);
  const badOut = await run(["--file", input, ...ok, "--out", join(dir, "no-such-folder", "out.csv")]);
  check("an unwritable --out fails before any check", badOut.code === 1 && /Can't write/.test(badOut.stdout), badOut.stdout);
  const jsonOut = await run(["--file", input, ...ok, "--out", join(dir, "out.json")]);
  check("a .json --out is refused", jsonOut.code === 1 && /\.csv or \.jsonl/.test(jsonOut.stdout), jsonOut.stdout);
  check("none of these made a request", seen.length === 0, String(seen.length));
  const allBad = join(dir, "allbad.csv");
  writeFileSync(allBad, "email\nnot-an-email\nalso bad\n");
  const r = await run(["--file", allBad, ...ok]);
  check("a list where no row can be checked exits 1", r.code === 1 && seen.length === 0, `${r.code} ${r.stderr}`);
}
{
  seen.length = 0;
  const input = join(dir, "stop.csv");
  const out = join(dir, "stop-checked.csv");
  writeFileSync(input, "email\na@acme.de\nb@acme.de\nlimit@acme.de\nc@acme.de\nd@acme.de\n");
  const r = await run(["--file", input, ...ok, "--out", out, "--delay-ms", "0"]);
  const { summary } = JSON.parse(r.stdout);
  check("daily limit stops the list with exit 3", r.code === 3 && summary.stopped === "daily_limit", r.stdout);
  check("daily limit: no requests after the stop", seen.length === 3, String(seen.length));
  check("daily limit counts", summary.checked === 2 && summary.not_checked === 3 && summary.get_key_url === "https://precleared.dev/get-key", JSON.stringify(summary));
  const rows = csvRows(out);
  const e = rows[0].indexOf("precleared_error");
  check("rows after the stop are marked", /not_checked/.test(rows[5][e]) && /daily_limit/.test(rows[3][e]), rows[5][e]);

  // Next day: the earlier answers are kept and only the rest are checked.
  seen.length = 0;
  writeFileSync(input, "email\na@acme.de\nb@acme.de\nnolim@acme.de\nc@acme.de\nd@acme.de\n");
  const next = await run(["--file", input, ...ok, "--out", out, "--delay-ms", "0"]);
  check("a later run checks only the unanswered rows", next.code === 0 && seen.length === 3 && JSON.parse(next.stdout).summary.from_earlier_run === 2, next.stdout);
}
{
  seen.length = 0;
  delayMs = 400;
  const input = join(dir, "slow.csv");
  const out = join(dir, "slow-checked.csv");
  writeFileSync(input, "email\n" + ["a", "b", "c", "d", "e", "f"].map((x) => `${x}@acme.co.uk`).join("\n") + "\n");
  const args = ["--file", input, ...ok, "--out", out, "--delay-ms", "0", "--time-limit", "1"];
  const first = await run(args);
  const s1 = JSON.parse(first.stdout).summary;
  check("time limit exits 4", first.code === 4 && s1.stopped === "time_limit" && s1.not_checked > 0 && s1.checked > 0, first.stdout);
  check("time limit message says run again", /Run the same command again/.test(s1.message));
  const madeFirst = seen.length;
  let later = first;
  for (let i = 0; i < 10 && later.code === 4; i++) later = await run(args);
  check("later runs finish the list", later.code === 0 && JSON.parse(later.stdout).summary.checked === 6, later.stdout);
  check("no row is checked twice across runs", seen.length === 6 && madeFirst < 6, `${madeFirst} then ${seen.length}`);
  delayMs = 0;
}
{
  seen.length = 0;
  const input = join(dir, "hang.csv");
  writeFileSync(input, "email\nhang1@acme.co.uk\nhang2@acme.co.uk\nhang3@acme.co.uk\n");
  const r = await run(["--file", input, ...ok, "--delay-ms", "0", "--time-limit", "2"]);
  check("a hanging request can't carry the run far past the limit", r.code === 4 && r.ms < 8000, `${r.code} ${r.ms}ms ${r.stderr}`);
}
{
  seen.length = 0;
  delayMs = 700;
  const input = join(dir, "sig.csv");
  writeFileSync(input, "email\n" + ["a", "b", "c", "d", "e"].map((x) => `${x}@acme.co.uk`).join("\n") + "\n");
  const child = spawn(process.execPath, [SCRIPT, "--file", input, ...ok, "--delay-ms", "0"], { env: { PATH: process.env.PATH, PRECLEARED_API_URL: API } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const code = await new Promise((resolve) => {
    setTimeout(() => child.kill("SIGTERM"), 1800);
    child.on("exit", (c) => resolve(c));
  });
  const printed = lines(stdout);
  const summary = JSON.parse(stderr.trim()).summary;
  check("stdout mode prints rows as they finish", printed.filter((r) => r.verdict).length >= 1 && printed.length === 5, stdout);
  check("an interrupted list exits 4 with a summary", code === 4 && summary.stopped === "interrupted", `${code} ${stderr}`);
  delayMs = 0;
}
{
  seen.length = 0;
  const input = join(dir, "leads.jsonl");
  const out = join(dir, "results.jsonl");
  writeFileSync(input, '{"email":"a@acme.de","source":"given","existing_customer":true}\n\n{"recipient_domain":"acme.fr","address_source":"published","suppressed":"yes"}\n');
  const r = await run(["--file", input, "--sender", "US", "--out", out, "--delay-ms", "0"]);
  check("jsonl list exit 0", r.code === 0, r.stdout);
  check("jsonl bodies", seen[0]?.body.existing_customer === true && seen[1]?.body.recipient_domain === "acme.fr" && seen[1]?.body.suppressed === true, JSON.stringify(seen.map((s) => s.body)));
  const results = lines(readFileSync(out, "utf8"));
  check("jsonl results have rows and hashes", results.length === 2 && results[0].row === 1 && results[1].domain === "acme.fr" && typeof results[0].facts_hash === "string");
  seen.length = 0;
  const again = await run(["--file", input, "--sender", "US", "--out", out, "--delay-ms", "0"]);
  check("jsonl rerun reuses answers", again.code === 0 && seen.length === 0, again.stdout);

  // A stored answer can't say send when its verdict says otherwise.
  const hash = factsHash(buildPayload({ email: "a@acme.de", source: "given", existingCustomer: "true", sender: "US" }));
  writeFileSync(out, JSON.stringify({ row: 1, email: "a@acme.de", verdict: "consent_needed", send: true, facts_hash: hash }) + "\n");
  const tampered = await run(["--file", input, "--sender", "US", "--out", out, "--delay-ms", "0"]);
  check("send is worked out from the verdict", tampered.code === 0 && lines(readFileSync(out, "utf8"))[0].send === false, readFileSync(out, "utf8"));
}
{
  seen.length = 0;
  const input = join(dir, "leads.json");
  writeFileSync(input, JSON.stringify([{ Email: "a@acme.de" }, { Email: "consent@acme.de" }]));
  const r = await run(["--file", input, ...ok, "--delay-ms", "0"]);
  const rows = lines(r.stdout);
  const summary = JSON.parse(r.stderr.trim()).summary;
  check("stdout mode prints one line per row", r.code === 0 && rows.length === 2 && rows[1].verdict === "consent_needed", r.stdout);
  check("stdout mode prints the summary on stderr", summary.rows === 2 && summary.checked === 2);
}
{
  seen.length = 0;
  const input = join(dir, "dupes.csv");
  writeFileSync(input, "email\na@acme.example\na@acme.example\nb@acme.example\nA@acme.example\n");
  const r = await run(["--file", input, ...ok, "--dry-run"]);
  const summary = JSON.parse(r.stderr.trim()).summary;
  check("dry run counts distinct checks", r.code === 0 && /2 checks would be made/.test(summary.message) && seen.length === 0, summary.message);
}
{
  seen.length = 0;
  const input = join(dir, "excel.csv");
  const out = join(dir, "excel-checked.csv");
  const head = Buffer.from('sep=;\r\nName;Email\r\nM\xfcller GmbH; "info@mueller.example"\r\n', "latin1");
  writeFileSync(input, head);
  const r = await run(["--file", input, ...ok, "--out", out, "--delay-ms", "0"]);
  const raw = readFileSync(out, "utf8");
  check("Excel sep line, a space before a quote and Windows-1252 text are read", r.code === 0 && seen[0]?.body.recipient_email === "info@mueller.example", `${r.stdout} ${JSON.stringify(seen[0]?.body)}`);
  check("the output keeps the sep line and is UTF-8 with a BOM", raw.startsWith(BOM + "sep=;") && raw.includes("Müller GmbH"), raw.slice(0, 120));
}
{
  const input = join(dir, "plain.csv");
  writeFileSync(input, "email\na@acme.de\n");
  const notOurs = join(dir, "notes.csv");
  writeFileSync(notOurs, "name,phone\nx,y\n");
  const r1 = await run(["--file", input, ...ok, "--out", notOurs]);
  check("refuses to overwrite an unrelated csv", r1.code === 1 && readFileSync(notOurs, "utf8") === "name,phone\nx,y\n", r1.stdout);
  const notOursJsonl = join(dir, "other.jsonl");
  writeFileSync(notOursJsonl, '{"name":"x"}\n');
  const r2 = await run(["--file", input, ...ok, "--out", notOursJsonl]);
  check("refuses to overwrite unrelated json lines", r2.code === 1 && readFileSync(notOursJsonl, "utf8") === '{"name":"x"}\n', r2.stdout);
  const r3 = await run(["--file", input, ...ok, "--out", input]);
  check("refuses --out equal to --file", r3.code === 1, r3.stdout);
  const noCol = join(dir, "nocol.csv");
  writeFileSync(noCol, "name,phone\nx,y\n");
  const r4 = await run(["--file", noCol, ...ok]);
  check("needs an email or domain column", r4.code === 1 && /Columns found: name, phone/.test(r4.stdout), r4.stdout);
  const r5 = await run(["--file", join(dir, "missing.csv"), ...ok]);
  check("missing file exit 1", r5.code === 1, r5.stdout);
  const r6 = await run(["--file", input, "--email", "a@acme.de", ...ok]);
  check("file and email together exit 1", r6.code === 1, r6.stdout);
  seen.length = 0;
  const r7 = await run(["--file", input, ...ok, "--dry-run", "--out", join(dir, "dry.csv")]);
  check("list dry run sends and writes nothing", r7.code === 0 && seen.length === 0 && !existsSync(join(dir, "dry.csv")) && lines(r7.stdout)[0].dry_run === true, r7.stdout);
}
{
  seen.length = 0;
  failAll = true;
  const input = join(dir, "fail.csv");
  writeFileSync(input, "email\na@acme.de\nb@acme.de\nc@acme.de\nd@acme.de\n");
  const r = await run(["--file", input, ...ok, "--delay-ms", "0"]);
  const summary = JSON.parse(r.stderr.trim()).summary;
  check("three failures in a row stop the list", r.code === 3 && summary.not_checked === 4 && summary.checks_made === 3, r.stderr);
  check("each failure is retried once", seen.length === 6, String(seen.length));
  failAll = false;
}

server.close();
decoy.close();
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
