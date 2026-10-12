<img src="https://precleared.dev/icon.png" width="56" alt="">

# Precleared: cold-email legality checks for AI agents

**Is your agent allowed to send that?** Precleared answers before the email goes out: a per-address verdict on cold marketing email, the rule quoted, the footer wording, and a signed receipt anyone can verify. Covers the UK (PECR and UK GDPR), the US (CAN-SPAM), Canada (CASL), Germany (UWG) and France.

- Site and docs: https://precleared.dev/docs
- MCP server (streamable HTTP): `https://precleared.dev/mcp`
- REST: `POST https://precleared.dev/api/v1/check`
- OpenAPI: https://precleared.dev/openapi.json
- Rules, with sources: https://precleared.dev/rules

## Add it to your client

**Cursor:** [Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=precleared&config=eyJ1cmwiOiAiaHR0cHM6Ly9wcmVjbGVhcmVkLmRldi9tY3AifQ==)

**VS Code:** [Add to VS Code](vscode:mcp/install?%7B%22name%22%3A%20%22precleared%22%2C%20%22type%22%3A%20%22http%22%2C%20%22url%22%3A%20%22https%3A//precleared.dev/mcp%22%7D)

**Claude Code:**

```bash
claude mcp add --transport http precleared https://precleared.dev/mcp
```

**Claude.ai and the Claude desktop app:** Settings, Connectors, Add custom connector, paste `https://precleared.dev/mcp`.

**Any MCP client (JSON):**

```json
{
  "mcpServers": {
    "precleared": {
      "url": "https://precleared.dev/mcp",
      "headers": { "Authorization": "Bearer pc_live_..." }
    }
  }
}
```

The `Authorization` header is optional. Without a key you get 10 free checks a day. A free key from https://precleared.dev/get-key gives 25 a day; a £39 pack adds 2,000 checks that never expire.

## Tools

| Tool | What it does |
| --- | --- |
| `contact_check` | Takes a recipient email or domain, your sender country (GB or US), the pitch and where the address came from. Returns `verdict` (ok_to_email, consent_needed, blocked or unknown), `confidence`, the rule quoted with its source, `footer_text`, `next_step`, the facts used, and a signed `receipt`. |
| `verify_receipt` | Takes a receipt id and returns the receipt with its hashes, Ed25519 signature and public key. |

## Example

```bash
curl https://precleared.dev/api/v1/check \
  -H "Content-Type: application/json" \
  -d '{"recipient_email":"jane@acme.co.uk","sender_country":"GB","address_source":"published"}'
```

```json
{
  "verdict": "ok_to_email",
  "confidence": "high",
  "reasons": [{ "rule_key": "gb_corporate_ok", "text": "Under PECR the consent rule for marketing email applies to individual subscribers only...", "source_title": "PECR 2003 regulation 22(1) and ICO Guide to PECR" }],
  "footer_text": "Say who you are and who the email is from, include a valid postal address, and give a simple free way to stop further emails (PECR regulation 23).",
  "next_step": "Send. Log the receipt against the lead.",
  "receipt": { "id": "cc_rcpt_...", "signature": "...", "key_version": "k1", "verify_url": "https://precleared.dev/api/v1/receipt?id=cc_rcpt_..." }
}
```

## What the receipt proves

That Precleared was asked this question, with these facts, at this time, and gave this answer. Every receipt has a public page at `https://precleared.dev/r/<id>` and can be verified offline with the public key at https://precleared.dev/api/v1/public-key. It is decision support with sources, not legal advice.

## Privacy and terms

https://precleared.dev/privacy · https://precleared.dev/terms
