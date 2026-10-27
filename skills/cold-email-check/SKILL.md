---
name: cold-email-check
description: Checks whether a cold or unsolicited marketing email to a specific address is allowed before it is sent, under UK (PECR, UK GDPR), US (CAN-SPAM), Canadian (CASL), German (UWG), French (CPCE), Australian (Spam Act), Irish (S.I. 336/2011) and Dutch (Telecommunicatiewet) rules, using Precleared. Use when the user wants to send, schedule or load first-touch outbound or prospecting emails to specific people who are not already customers, or to vet a cold outreach list before a campaign. Returns a verdict per address, the rule behind it, what the email's footer must include and a signed receipt. Not for transactional email such as receipts, invoices or password resets, replies to someone who wrote first, newsletters to opted-in subscribers, or writing a template before there are recipients.
license: MIT
compatibility: Needs network access to precleared.dev. Uses the Precleared MCP tools when they are connected, otherwise the bundled script (Node 18 or later) or curl.
metadata:
  author: Precleared
  version: "1.2.0"
  homepage: https://precleared.dev
---

# Cold email check

Before the first cold email to a new address, ask Precleared whether that email is allowed. Each check returns a verdict, the rule that decided it with its source, what the footer must include and a signed receipt. Nothing is sent to the recipient, and a check takes about a second.

## When to check

Check each new recipient once, before the first cold email, when:

- the email markets or sells something (a product, a service, a partnership) to someone who has not asked to hear from the sender and is not already a customer. Having someone's address, from a business card, a form or a directory, is not the same as them asking to hear from the sender, and
- there is a specific address or company to check. A template with no recipients needs no check.

Precleared covers senders based in the UK, the US or the United Arab Emirates (UAE). It has full rules for recipients in the UK, the US, Canada, Germany, France, Australia, Ireland and the Netherlands; for many other European countries it answers `consent_needed`, and elsewhere `unknown`. If the sender's business is based anywhere else, tell the user Precleared can't assess it rather than running a check.

Skip transactional email (receipts, invoices, password resets, delivery updates), replies in a thread the recipient started, and newsletters to people who opted in. Check again if the pitch, or where the address came from, changes.

## Get the facts right

The verdict depends on the facts you pass. Take them from the user or the lead data, and never fill a gap with a guess that makes the answer more convenient.

| Field | What to pass |
| --- | --- |
| `recipient_email` | One address per check. Use `recipient_domain` (for example `acme.co.uk`) only when there is no address yet. |
| `sender_country` | `GB`, `US` or `AE` (United Arab Emirates): where the sending business is based, not where the recipient is. Ask once if you don't know. |
| `address_source` | Where the address came from: `published` (on their website, a profile or a directory), `bought` (a purchased list), `scraped` (collected by a tool), `given` (they gave it to the sender) or `unknown`. Ask the user if it isn't clear, and use `unknown` if they can't say. Never assume `published`. |
| `pitch` | What the email offers, in a few words, for example "bookkeeping software for dental practices". |
| `recipient_country` | Two-letter code, if known. Otherwise Precleared works it out from the domain and company records. |
| `company_number` | UK company number, if known. |
| `pitch_relevant` | `true` if the offer relates to the recipient's job or business, `false` if it doesn't. Leave it out if unsure. |
| `existing_customer` | `true` if they have bought from the sender before (useful in mixed lists). |
| `suppressed` | `true` if the address is on the sender's do-not-contact list. |

## Run the check

Use the first of these that is available:

1. **The Precleared MCP tool.** If a `contact_check` tool from Precleared is connected (this plugin's connector, or the server at `https://precleared.dev/mcp`), call it once per address with the fields above.
2. **The bundled script** (Node 18 or later, no dependencies) at `scripts/check.mjs` in this skill's folder. If `${CLAUDE_SKILL_DIR}` isn't filled in below, use the full path to this skill's folder:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/check.mjs --email jane@acme.co.uk --sender GB --source SOURCE --pitch "bookkeeping software for dental practices"
   ```

   Replace SOURCE with what the user told you: `published`, `bought`, `scraped`, `given` or `unknown`. The script prints one JSON object. It exits 0 for `ok_to_email`, 2 for do not send, 3 when the check couldn't be made and 1 when a fact is missing or unreadable (ask the user rather than filling it in). Act on the `verdict` in the JSON: no JSON means no check. `--help` lists every option.
3. **The REST API**, if neither of those works:

   ```bash
   curl -s https://precleared.dev/api/v1/check -H "Content-Type: application/json" \
     -d '{"recipient_email":"jane@acme.co.uk","sender_country":"GB","address_source":"SOURCE","pitch":"bookkeeping software"}'
   ```

### Lists

The script's list mode checks a whole file, asks once per distinct address and writes the results beside the original columns:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/check.mjs --file leads.csv --sender GB --source SOURCE --pitch "bookkeeping software" --out leads-checked.csv
```

- The file needs an `email` (or `domain`) column. Optional `source`, `country`, `pitch`, `company_number`, `pitch_relevant`, `existing_customer` and opt-out columns (such as `do_not_email` or `unsubscribed`) override the flags for their row. The summary lists the columns it used.
- Send only to rows where `precleared_send` is `yes`. Blank means the row wasn't checked. For a list, exit 0 means every row has a verdict, not that every row can be emailed; 3 means some rows couldn't be checked and 4 means it stopped at the time limit.
- It stops starting new checks after 90 seconds. Run the same command again and it keeps the answers already in the output file and checks only the rest. To check everything again, write to a new file.
- The script uses the REST allowance: 10 checks a day without a key, 25 with a free key. Without a key, if the MCP tool is connected, check up to 100 a day with it, one address at a time, instead.

## Act on the verdict

| Verdict | What to do |
| --- | --- |
| `ok_to_email` | Allowed. If the user asked you to send, send it with a footer that meets `footer_text`: usually who is sending, a postal address and a simple, free way to opt out. `footer_text` describes the requirement; it is not wording to paste. |
| `consent_needed` | Don't send the cold email. Follow `next_step`, for example writing to the company's general address (check that address first) or getting consent through a channel the person opened, and tell the user. |
| `blocked` | Don't send. Follow `next_step` and tell the user. |
| `unknown` | Treat it as `consent_needed`. If a missing fact would settle it, such as the recipient's country, a UK company number or where the address came from, get that fact from the user or a record, not a guess, and check once more. |
| no verdict (an error) | Don't send to that address yet. Tell the user what happened and carry on with other work. |

Never change the facts to get a different verdict, and never send a cold email to an address whose check failed.

## Keep the receipt

Save the receipt id with the lead, in a CRM note or a column of the sheet. The receipt records what was asked, what was answered and when. Anyone with the id can open it at `https://precleared.dev/r/<receipt_id>`, and the `verify_receipt` tool returns it with its signature.

## Limits and keys

- Without a key: 100 checks a day over MCP and 10 over REST, shared by everyone on the same network.
- A free key from https://precleared.dev/get-key gives the user their own allowance: 25 a day over REST (the script reads it from `PRECLEARED_API_KEY`) and 100 a day over MCP in clients that send it as a header. This plugin's connector doesn't send one. Don't write the key into files or messages.
- A £39 pack adds 2,000 checks that don't expire: https://precleared.dev/#pricing

If a check returns `daily_limit` or `payment_required`, stop checking, tell the user how many addresses are left unchecked and pass on the link from the response (`get_key_url` or `buy_url`). If it returns `invalid_key` or `revoked_key`, tell the user their key needs replacing. Don't try to get round the limit.

## Good to know

- Precleared reports what the rules say for the facts given, with sources. It is decision support, not legal advice.
- It doesn't write or send the email.
- The rules and their sources: https://precleared.dev/rules. API docs: https://precleared.dev/docs
