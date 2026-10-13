// Exercises index.js end to end against a fake Precleared REST API on localhost:
// introspection with no network, a check with a key, a receipt lookup, a 404 and an unreachable API.
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "index.js");

const seen = [];
const fake = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: data });
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/api/v1/check") {
      const body = JSON.parse(data);
      if (!body.recipient_email && !body.recipient_domain) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "bad_request", message: "recipient_email or recipient_domain is required" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          verdict: "ok_to_email",
          confidence: "high",
          reasons: [{ rule: "PECR reg 22 does not apply to corporate subscribers", source: "https://www.legislation.gov.uk/uksi/2003/2426/regulation/22" }],
          rules_applied: ["uk_corporate_subscriber"],
          footer_text: "You are receiving this because ... Reply STOP to opt out.",
          next_step: null,
          facts: { echo: body, key: req.headers.authorization || null, ua: req.headers["user-agent"] },
          receipt: { id: "cc_rcpt_0123456789ABCDEF", algorithm: "Ed25519", verify_url: "https://precleared.dev/api/v1/receipt?id=cc_rcpt_0123456789ABCDEF" },
          usage: { free_remaining_today: 24, credits_remaining: 0 },
          disclaimer: "Decision support with sources, not legal advice.",
        }),
      );
    }
    if (req.method === "GET" && url.pathname === "/api/v1/receipt") {
      const id = url.searchParams.get("id");
      if (id === "cc_rcpt_0123456789ABCDEF") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id, verdict: "ok_to_email", signature: "abc", key_version: "1" }));
      }
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not_found", message: "no receipt with that id" }));
    }
    res.writeHead(404);
    res.end();
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const port = fake.address().port;

async function withServer(env, fn) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, ...env }, stderr: "pipe" });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

// 1. Introspection with nothing reachable (what Glama's check does).
await withServer({ PRECLEARED_API_BASE: "http://127.0.0.1:1/api/v1" }, async (client) => {
  const info = client.getServerVersion();
  assert.equal(info.name, "precleared");
  assert.ok(client.getInstructions().startsWith("Precleared answers one question"));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["contact_check", "verify_receipt"]);
  assert.equal(tools.find((t) => t.name === "verify_receipt").annotations.readOnlyHint, true);
  assert.deepEqual(tools.find((t) => t.name === "verify_receipt").inputSchema.required, ["id"]);
  assert.deepEqual(tools.find((t) => t.name === "contact_check").outputSchema.required, ["verdict"]);
  assert.deepEqual(tools.find((t) => t.name === "verify_receipt").outputSchema.required, ["id"]);
  assert.match(tools.find((t) => t.name === "contact_check").description, /Not needed for transactional emails/);
  console.log("ok  introspection without network");

  // 2. Unreachable API gives an error result, not a crash.
  const r = await client.callTool({ name: "contact_check", arguments: { recipient_email: "a@b.co.uk" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /could not be reached/);
  console.log("ok  unreachable API reported cleanly");
});

// 3. Real round trips against the fake API, with a key.
await withServer({ PRECLEARED_API_BASE: `http://127.0.0.1:${port}/api/v1/`, PRECLEARED_API_KEY: "pc_test_KEY" }, async (client) => {
  await client.listTools(); // so the client checks structured results against each tool's output schema
  const r = await client.callTool({
    name: "contact_check",
    arguments: { recipient_email: "jane@acme.co.uk", address_source: "published", pitch: "bookkeeping software", existing_customer: false, suppressed: undefined },
  });
  assert.notEqual(r.isError, true);
  const parsed = JSON.parse(r.content[0].text);
  assert.equal(parsed.verdict, "ok_to_email");
  assert.equal(r.structuredContent.verdict, "ok_to_email");
  assert.equal(parsed.facts.key, "Bearer pc_test_KEY");
  assert.match(parsed.facts.ua, /^precleared-mcp\/1\./);
  assert.deepEqual(parsed.facts.echo, { recipient_email: "jane@acme.co.uk", address_source: "published", pitch: "bookkeeping software", existing_customer: false });
  console.log("ok  contact_check forwarded with key and clean body");

  const missing = await client.callTool({ name: "contact_check", arguments: {} });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /recipient_email or recipient_domain/);
  console.log("ok  missing recipient rejected locally");

  const rc = await client.callTool({ name: "verify_receipt", arguments: { id: "cc_rcpt_0123456789ABCDEF" } });
  assert.notEqual(rc.isError, true);
  assert.equal(JSON.parse(rc.content[0].text).signature, "abc");
  console.log("ok  verify_receipt");

  const nf = await client.callTool({ name: "verify_receipt", arguments: { id: "cc_rcpt_NOPE000000000000" } });
  assert.equal(nf.isError, true);
  assert.match(nf.content[0].text, /not found: no receipt/);
  console.log("ok  unknown receipt gives a clear error");

  const unknown = await client.callTool({ name: "nope", arguments: {} }).catch((e) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
  assert.equal(unknown.isError, true);
  console.log("ok  unknown tool rejected");
});

assert.equal(seen.filter((s) => s.url.startsWith("/api/v1/check")).length, 1, "one check request reached the API");
fake.close();
console.log("all tests passed");
