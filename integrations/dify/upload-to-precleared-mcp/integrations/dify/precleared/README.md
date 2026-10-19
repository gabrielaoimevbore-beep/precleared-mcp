# Precleared

Is your agent allowed to send that cold email? Precleared answers that for one recipient at a time, before the first email goes out. Each check returns a verdict, the rule that decided it with its legal source, what the email's footer must include, the next step and a signed receipt ID you can show a client or auditor later.

It covers the UK, US, Canada, Germany, France, Australia, Ireland and the Netherlands: UK PECR and GDPR, US CAN-SPAM, Canadian CASL, German UWG, French CPCE, Australia's Spam Act, Ireland's ePrivacy Regulations and the Dutch Telecommunicatiewet. Whether an email is allowed often turns on facts you can't see in the address, such as whether a UK recipient is a limited company or a sole trader, so Precleared looks them up live.

## Tools

- **Check cold email compliance**: one recipient email address (or domain) in, a verdict out. Verdicts are `ok_to_email`, `consent_needed`, `blocked` or `unknown`.
- **Get a receipt**: fetch a past check by its receipt ID (`cc_rcpt_...`) to show what was checked, when and the verdict, with the signature details needed to verify it.

## Setup

1. Get a free API key at https://precleared.dev/get-key. It starts with `pc_live_`.
2. Install Precleared from the Dify Marketplace, open the plugin's authorisation settings and paste the key. Dify checks the key with Precleared when you save it, and that check does not use up any of your allowance.
3. Add **Check cold email compliance** to your agent or workflow, before the step that sends email.

## Usage

### In an agent

Add the tool and tell the agent to check every new address before the first cold email, for example:

> Before you email a new lead, run Check cold email compliance on their address. Only send when the verdict is ok_to_email, and make the footer meet footer_text. Otherwise follow next_step.

The agent sees a short summary it can act on, plus the full answer as JSON.

### In a workflow

1. Put the tool node before the node that sends email.
2. Set **Sender country** (GB or US) and, if all your prospects are in one country, **Fallback country** in the node.
3. Map the lead's email address to **Recipient email**. Set **Address source** if you know it, because it changes the verdict.
4. Branch on the `ok_to_send` output: when true, send with a footer that meets `footer_text`; when false, hold the email and follow `next_step`.
5. Store `receipt_id` with the lead, so the check can be shown later.

Outputs: `verdict`, `ok_to_send`, `rule`, `rule_source`, `next_step`, `footer_text`, `receipt_id` and `error` (set when the check could not run, for example when the key was rejected). The full API answer is also returned as JSON.

What the verdicts mean:

- `ok_to_email`: send, with a footer that meets `footer_text` (for example who you are, a postal address and a way to opt out). `footer_text` describes the requirement; it is not wording to paste.
- `consent_needed` and `blocked`: do not send. Follow `next_step`.
- `unknown`: a fact could not be established. Treat it as `consent_needed` unless you can supply the missing fact, such as the recipient's country or UK company number, and check again.

Precleared is not needed for transactional emails such as invoices, receipts or password resets.

## Credentials

A Precleared API key is required. Dify sends requests from shared servers, and Precleared's allowance without a key is shared by everyone on the same network address, so a key of your own keeps your checks separate. Each check uses your key's free daily allowance first, then any prepaid credits. Allowances and pricing: https://precleared.dev/#pricing.

The key is sent only to precleared.dev, in the Authorization header. The plugin never logs it or includes it in a message.

## Connection requirements

The plugin makes outbound HTTPS requests to one host, `precleared.dev`, on port 443:

- `POST https://precleared.dev/api/v1/check` to check an address
- `GET https://precleared.dev/api/v1/receipt` to fetch a receipt
- `GET https://precleared.dev/api/v1/key` to check the key when you save it

Requests time out after 35 seconds. If your self-hosted Dify uses an egress allowlist or a proxy, allow `precleared.dev`.

## Notes

Precleared is decision support with sources, not legal advice. A receipt proves what was asked and answered, not that an email was sent.

## Source, docs and support

- Source: https://github.com/gabrielaoimevbore-beep/precleared-mcp/tree/main/integrations/dify
- Docs: https://precleared.dev/docs
- Privacy: see PRIVACY.md and https://precleared.dev/privacy
- Support: support@precleared.dev
