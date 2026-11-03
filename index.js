#!/usr/bin/env node
// precleared-mcp: a Model Context Protocol server (stdio) for Precleared,
// the cold email compliance check for outbound agents. https://precleared.dev
//
// It exposes three tools, contact_check, verify_receipt and suppress_contact, and fulfils them
// through Precleared's public REST API (https://precleared.dev/api/v1).
// Nothing is sent to the recipient; nothing is stored locally.
//
// Environment:
//   PRECLEARED_API_KEY   optional, pc_live_... (a new key: 100 checks a day for 14 days, then 25; packs on top)
//   PRECLEARED_API_BASE  optional, defaults to https://precleared.dev/api/v1
//   PRECLEARED_TIMEOUT_MS optional, per request, default 30000
//
// stdout carries JSON-RPC only. Diagnostics go to stderr.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const VERSION = "1.3.0";
const API_BASE = (process.env.PRECLEARED_API_BASE || "https://precleared.dev/api/v1").replace(/\/+$/, "");
const API_KEY = (process.env.PRECLEARED_API_KEY || "").trim();
const TIMEOUT_MS = Math.max(1000, Number(process.env.PRECLEARED_TIMEOUT_MS) || 30000);
const USER_AGENT = `precleared-mcp/${VERSION} (+https://github.com/gabrielaoimevbore-beep/precleared-mcp)`;
const DOCS_URL = "https://precleared.dev/docs";

const INSTRUCTIONS =
  "Precleared answers one question for outbound agents: may a cold or unsolicited marketing email be sent to this address? " +
  "Use contact_check once per recipient before the first email to anyone who is not already a customer, in the UK, US, Canada, Germany, France, Australia, Ireland, the Netherlands, Spain, Italy, Latvia or the United Arab Emirates. " +
  "It is not needed for transactional emails such as invoices, receipts or password resets. " +
  "It returns a verdict (ok_to_email, consent_needed, blocked or unknown), the rule that decided it with its source, what the email's footer must include (footer_text), a next step and a signed receipt id. " +
  "ok_to_email means send, with a footer that meets footer_text, for example who you are, a postal address and a way to opt out; footer_text describes the requirement and is not wording to paste. " +
  "consent_needed and blocked mean do not send and follow next_step; unknown means a fact could not be established, so treat it as consent_needed unless you can supply the missing fact. " +
  "Pass the draft in the email field and the answer also says whether its footer has an opt-out, the sender's identity and, where the rule needs one, a postal address; the draft is not stored. " +
  "No sign-in is needed, a check usually takes a few seconds, and nothing is sent to the recipient. " +
  "verify_receipt returns a receipt by id so a check can be shown to a person later. " +
  "suppress_contact adds an address or domain to the key's own opt-out list (or removes it); every later check on it answers blocked, free of charge.";

const CHECK_FIELDS = [
  "recipient_email",
  "recipient_domain",
  "sender_country",
  "pitch",
  "address_source",
  "recipient_country",
  "default_recipient_country",
  "company_name",
  "recipient_name",
  "company_number",
  "pitch_relevant",
  "existing_customer",
  "suppressed",
  "email",
];

const TOOLS = [
  {
    name: "contact_check",
    title: "Contact check",
    description:
      "Check whether a cold or unsolicited marketing email to one recipient is allowed under UK PECR and GDPR, US CAN-SPAM, Canadian CASL, German UWG, French CPCE, Australia's Spam Act, Ireland's ePrivacy Regulations, the Dutch Telecommunicatiewet, Spain's LSSI, Italy's Privacy Code, Latvia's Information Society Services Law and the UAE's PDPL. " +
      "Use it before the first email to a new contact, one call per address. " +
      "Not needed for transactional emails such as invoices, receipts or password resets. " +
      "Returns the verdict, confidence, the rule quoted with its source, what the email's footer must include, the next step and the facts used. " +
      "Pass the draft in email and the answer also reports whether its footer meets the rule (email_check). " +
      "Each charged check uses one check from your allowance and is saved as a signed receipt; answers where no rule applied, and one re-check within a day, are free. It does not send anything.",
    inputSchema: {
      type: "object",
      properties: {
        recipient_email: {
          type: "string",
          maxLength: 254,
          description: "The recipient's email address. Give this or recipient_domain.",
        },
        recipient_domain: {
          type: "string",
          maxLength: 253,
          description: "The recipient's domain when you have no email address, for example acme.co.uk.",
        },
        sender_country: {
          type: "string",
          enum: ["GB", "US", "AE", "CA"],
          description: "Country the sending business is based in: GB, US, AE (United Arab Emirates) or CA (Canada). Canadian senders must also meet CASL. Not the recipient's country. Default GB.",
        },
        pitch: {
          type: "string",
          maxLength: 2000,
          description:
            "What the email offers, in a few words, for example 'bookkeeping software for dental practices'. Used to judge relevance to the recipient's role.",
        },
        address_source: {
          type: "string",
          enum: ["published", "bought", "scraped", "given", "unknown"],
          description:
            "Where the address came from: published (on their website, profile or a directory), bought (a purchased list), scraped (collected by a tool), given (the person gave it to you) or unknown. It affects the verdict, so do not assume published.",
        },
        recipient_country: {
          type: "string",
          pattern: "^[A-Za-z]{2}$",
          description:
            "Two-letter country code of the recipient if known, for example GB or DE. Otherwise it is worked out from the domain, company records and the company's website.",
        },
        default_recipient_country: {
          type: "string",
          pattern: "^[A-Za-z]{2}$",
          description:
            "Two-letter country code to use only when the recipient's country can't be worked out from recipient_country, the domain, company records or the company's website, for example US if all your prospects are in the US. recipient_country always wins.",
        },
        company_name: {
          type: "string",
          maxLength: 160,
          description:
            "The recipient's company or organisation name if you know it, for example from your CRM. For UK recipients it is used to search Companies House when the domain alone does not find the company. A company is only used when other evidence links it to the recipient.",
        },
        recipient_name: {
          type: "string",
          maxLength: 120,
          description:
            "The recipient's full name if you know it, for example Jane Smith. For UK recipients it is matched against a company's current officers at Companies House. Precleared does not store it.",
        },
        company_number: {
          type: "string",
          maxLength: 12,
          description: "UK company number if known (8 characters), so the register can confirm the company.",
        },
        pitch_relevant: {
          type: "boolean",
          description: "True if the pitch relates to the recipient's job or business, false if it does not.",
        },
        existing_customer: {
          type: "boolean",
          description: "True if the recipient has bought from you before. Default false.",
        },
        suppressed: {
          type: "boolean",
          description: "True if the recipient is on your own do-not-contact list.",
        },
        email: {
          type: "object",
          description:
            "The draft email, if you want the answer to say whether its footer meets the rule for the recipient's country. The body is not stored; only a hash of it goes on the receipt.",
          properties: {
            subject: { type: "string", maxLength: 300, description: "Subject line." },
            body: { type: "string", maxLength: 20000, description: "Body, plain text or HTML, including the footer and any merge tags such as {{unsubscribe}}." },
            from_name: { type: "string", maxLength: 120, description: "Sender name shown to the recipient." },
            from_email: { type: "string", maxLength: 254, description: "Sending address." },
          },
          required: ["body"],
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["ok_to_email", "consent_needed", "blocked", "unknown"], description: "The answer for this recipient." },
        confidence: { type: "string", description: "high, medium or low." },
        reasons: { type: "array", items: { type: "object" }, description: "The rule that matched, with its text and source, then any notes." },
        rules_applied: { type: "array", items: { type: "string" }, description: "Rule keys used." },
        footer_text: { type: ["string", "null"], description: "What the email's footer must include, if the rule sets requirements." },
        next_step: { type: ["string", "null"], description: "What to do next." },
        facts: { type: "object", description: "Facts gathered about the recipient." },
        receipt: { type: "object", description: "Signed receipt for this check, with id and verify_url." },
        email_check: { type: ["object", "null"], description: "Only when a draft was passed in email: status (pass or fail), the requirements checked (opt_out, sender_identity, postal_address, commercial_nature), which are missing, and a note." },
        charged: { type: "boolean", description: "False when the answer was free (no rule applied, a re-check within a day, or an address on your opt-out list)." },
        rules_version: { type: "string", description: "Version of the rule set used." },
        usage: { type: "object", description: "Allowance left for the caller." },
        disclaimer: { type: "string", description: "Fixed disclaimer line." },
      },
      required: ["verdict"],
    },
    annotations: {
      title: "Contact check",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "verify_receipt",
    title: "Verify receipt",
    description:
      "Fetch a Precleared receipt by its id (cc_rcpt_...) to show what was checked, when, and the verdict, with the hashes, Ed25519 signature and public key needed to verify it. " +
      "Use it when a person or an audit asks for proof of a check.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Receipt id, such as cc_rcpt_0123456789ABCDEF.",
        },
      },
      required: ["id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Receipt id." },
        created_at: { type: ["string", "null"], description: "When the check was made." },
        verdict: { type: ["string", "null"], description: "Verdict given." },
        confidence: { type: ["string", "null"], description: "Confidence given." },
        rules_applied: { type: ["array", "null"], items: { type: "string" }, description: "Rule keys used." },
        recipient_domain: { type: ["string", "null"], description: "Recipient domain." },
        recipient_email_masked: { type: ["string", "null"], description: "Masked recipient address." },
        sender_country: { type: ["string", "null"], description: "Sender country." },
        rules_version: { type: ["string", "null"], description: "Rule set version." },
        request_hash: { type: ["string", "null"], description: "SHA-256 of the request." },
        response_hash: { type: ["string", "null"], description: "SHA-256 of the response." },
        signature: { type: ["string", "null"], description: "Ed25519 signature, base64." },
        algorithm: { type: ["string", "null"], description: "Signature algorithm." },
        key_version: { type: ["string", "null"], description: "Signing key version." },
        public_key: { type: ["string", "null"], description: "Public key, base64 SPKI DER." },
      },
      required: ["id"],
    },
    annotations: {
      title: "Verify receipt",
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "suppress_contact",
    title: "Opt-out list",
    description:
      "Add an email address or a whole domain to this key's opt-out list, or remove it. Use it when someone unsubscribes, replies asking not to be contacted, or must never be emailed. " +
      "Every later contact_check on a listed address answers blocked, free of charge, so the list works across every tool that uses the same key. " +
      "Needs PRECLEARED_API_KEY: the list belongs to a key. Nothing is sent to the recipient.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", maxLength: 254, description: "The address to list. Give this or domain." },
        domain: { type: "string", maxLength: 253, description: "A whole domain to list, for example acme.co.uk. Give this or email." },
        remove: { type: "boolean", description: "True to take the address or domain off the list instead. Default false." },
        reason: { type: "string", maxLength: 200, description: "Why, in a few words, for example 'replied asking not to be contacted'. Kept with the entry." },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        created: { type: "boolean", description: "True when a new entry was added; false when it was already listed." },
        removed: { type: "boolean", description: "True when an entry was removed." },
        entry: { type: ["object", "null"], description: "The entry: id, type, masked_email, domain, reason, source, created_at." },
        charged: { type: "boolean", description: "Always false: listing is free." },
      },
    },
    annotations: {
      title: "Opt-out list",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

function log(...args) {
  if (process.env.PRECLEARED_DEBUG) console.error("[precleared-mcp]", ...args);
}

async function api(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
  };
  try {
    const res = await fetch(API_BASE + path, { ...init, headers, signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

function errorResult(text) {
  return { isError: true, content: [{ type: "text", text }] };
}

function okResult(body) {
  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    structuredContent: body && typeof body === "object" && !Array.isArray(body) ? body : undefined,
  };
}

function describeFailure(status, body, what) {
  const detail = body && typeof body === "object" && (body.message || body.error) ? `: ${body.message || body.error}` : "";
  switch (status) {
    case 400:
      return `Precleared rejected the request${detail}`;
    case 401:
      return `Precleared did not accept the API key (invalid or revoked)${detail}. Check PRECLEARED_API_KEY, see ${DOCS_URL}.`;
    case 402:
      return `No free checks or credits left today${detail}. Add an API key or buy a pack, see ${DOCS_URL}.`;
    case 404:
      return `${what} was not found${detail}`;
    case 429:
      return `Daily limit reached${detail}. An API key raises the allowance, see ${DOCS_URL}.`;
    default:
      return `Precleared returned HTTP ${status} while handling ${what}${detail}`;
  }
}

async function contactCheck(args) {
  const body = {};
  for (const key of CHECK_FIELDS) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== "") body[key] = args[key];
  }
  if (!body.recipient_email && !body.recipient_domain) {
    return errorResult("Give recipient_email or recipient_domain.");
  }
  const res = await api("/check", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) return errorResult(describeFailure(res.status, res.body, "the check"));
  return okResult(res.body);
}

async function suppressContact(args) {
  const email = typeof args.email === "string" ? args.email.trim() : "";
  const domain = typeof args.domain === "string" ? args.domain.trim() : "";
  if (!email && !domain) return errorResult("Give email or domain.");
  if (!API_KEY) {
    return errorResult(`An opt-out list belongs to a Precleared key, and PRECLEARED_API_KEY is not set. Get a free key at https://precleared.dev/get-key and set it, see ${DOCS_URL}.`);
  }
  const body = email ? { email } : { domain };
  if (typeof args.reason === "string" && args.reason.trim()) body.reason = args.reason.trim();
  const remove = args.remove === true;
  const res = await api("/suppressions", { method: remove ? "DELETE" : "POST", body: JSON.stringify(body) });
  if (!res.ok) return errorResult(describeFailure(res.status, res.body, remove ? "the opt-out list removal" : "the opt-out list entry"));
  return okResult(res.body);
}

async function verifyReceipt(args) {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return errorResult("Give the receipt id, for example cc_rcpt_0123456789ABCDEF.");
  const res = await api(`/receipt?id=${encodeURIComponent(id)}`, { method: "GET" });
  if (!res.ok) return errorResult(describeFailure(res.status, res.body, `receipt ${id}`));
  return okResult(res.body);
}

const server = new Server(
  { name: "precleared", title: "Precleared Contact Check", version: VERSION },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === "contact_check") return await contactCheck(args);
    if (name === "verify_receipt") return await verifyReceipt(args);
    if (name === "suppress_contact") return await suppressContact(args);
    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    const reason = err && err.name === "AbortError" ? `no reply within ${TIMEOUT_MS} ms` : (err && err.message) || String(err);
    log("request failed:", reason);
    return errorResult(`Precleared could not be reached (${reason}). Check the network and try again.`);
  }
});

const transport = new StdioServerTransport();
server.onclose = () => process.exit(0);
await server.connect(transport);
log(`ready, api ${API_BASE}, key ${API_KEY ? "set" : "not set"}`);
