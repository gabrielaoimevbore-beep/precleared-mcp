"""A small HTTPS client for the Precleared API, shared by the provider and both tools.

Every request goes to the fixed host precleared.dev. The API key is sent only in
the Authorization header and is never written to logs or returned in a message.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import requests

BASE_URL = "https://precleared.dev"
CHECK_URL = f"{BASE_URL}/api/v1/check"
KEY_URL = f"{BASE_URL}/api/v1/key"
RECEIPT_URL = f"{BASE_URL}/api/v1/receipt"
GET_KEY_URL = f"{BASE_URL}/get-key"
BUY_URL = f"{BASE_URL}/buy"
RECEIPT_PAGE_URL = f"{BASE_URL}/r/"
USER_AGENT = "precleared-dify-plugin/0.1.0 (+https://precleared.dev)"

# Precleared answers within about 25 seconds, even when a company register is slow,
# so the read timeout sits a little above that. (connect, read) in seconds.
TIMEOUT = (10, 35)

MAX_TEXT = 500
MAX_LINK = 2048
RECEIPT_ID_RE = re.compile(r"^cc_rcpt_[0-9A-Z]{16}$")
COUNTRY_RE = re.compile(r"^[A-Za-z]{2}$")

STRING_FIELDS = ("recipient_email", "recipient_domain", "pitch", "company_number")
COUNTRY_FIELDS = {
    "recipient_country": "Recipient country",
    "default_recipient_country": "Fallback country",
}
SELECT_FIELDS = {
    "sender_country": ("Sender country", ("GB", "US")),
    "address_source": ("Address source", ("published", "bought", "scraped", "given", "unknown")),
}
BOOL_FIELDS = ("pitch_relevant", "existing_customer", "suppressed")

VERDICT_LINES = {
    "ok_to_email": "ok_to_email. You may send this email, with a footer that meets the requirement below.",
    "consent_needed": "consent_needed. Do not send this cold email. Follow the next step instead.",
    "blocked": "blocked. Do not send this email.",
    "unknown": (
        "unknown. A fact could not be established, so treat this as consent_needed and do not send, "
        "unless you can supply the missing fact (for example the recipient's country or company number) "
        "and check again."
    ),
}


@dataclass
class ApiResult:
    """What came back from Precleared. status is None when the API could not be reached."""

    status: int | None
    body: dict[str, Any] | None
    error: str | None = None


def _headers(api_key: str | None) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _parse(response: requests.Response) -> dict[str, Any] | None:
    try:
        data = response.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def call(
    method: str,
    url: str,
    api_key: str | None = None,
    *,
    json_body: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
) -> ApiResult:
    """Make one request to Precleared. Network problems come back as ApiResult.error."""
    try:
        if method == "POST":
            response = requests.post(url, json=json_body, headers=_headers(api_key), timeout=TIMEOUT)
        else:
            response = requests.get(url, params=params, headers=_headers(api_key), timeout=TIMEOUT)
    except requests.Timeout:
        return ApiResult(None, None, "Precleared did not answer in time. Try again in a minute.")
    except requests.RequestException:
        return ApiResult(None, None, "Could not reach Precleared. Check the network connection and try again.")
    return ApiResult(response.status_code, _parse(response))


def clean_key(credentials: dict[str, Any] | None) -> str:
    value = (credentials or {}).get("api_key")
    return value.strip() if isinstance(value, str) else ""


def clean_text(value: Any) -> str:
    """A stripped, length-limited string, or "" for anything that isn't one."""
    if not isinstance(value, str):
        return ""
    return value.strip()[:MAX_TEXT]


def is_https_link(value: Any) -> bool:
    return (
        isinstance(value, str)
        and value.startswith("https://")
        and len(value) <= MAX_LINK
        and value.isprintable()
        and not any(ch.isspace() for ch in value)
    )


def redact(text: str, hidden: str | None) -> str:
    """Replace every copy of `hidden` (the API key) in a message with ***."""
    if hidden and text:
        text = text.replace(hidden, "***")
    return text


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "yes", "1"):
            return True
        if lowered in ("false", "no", "0"):
            return False
    return None


def build_check_body(params: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    """Turn tool parameters into a /api/v1/check request body.

    Returns (body, problem). Blank values count as not given, as they do in the API.
    """
    body: dict[str, Any] = {}
    for name in STRING_FIELDS:
        value = params.get(name)
        if isinstance(value, str) and value.strip():
            body[name] = value.strip()

    for name, label in COUNTRY_FIELDS.items():
        value = params.get(name)
        if isinstance(value, str) and value.strip():
            code = value.strip()
            if not COUNTRY_RE.match(code):
                return {}, f"{label} must be a two-letter country code, such as GB, US or DE."
            body[name] = code.upper()

    for name, (label, allowed) in SELECT_FIELDS.items():
        value = params.get(name)
        if isinstance(value, str) and value.strip():
            choice = value.strip()
            if name == "sender_country":
                choice = choice.upper()
            if choice not in allowed:
                return {}, f"{label} must be one of: {', '.join(allowed)}."
            body[name] = choice

    for name in BOOL_FIELDS:
        flag = _as_bool(params.get(name))
        if flag is not None:
            body[name] = flag

    if not body.get("recipient_email") and not body.get("recipient_domain"):
        return {}, "Give a recipient email or a recipient domain."
    return body, None


def first_reason(body: dict[str, Any]) -> tuple[str, str, str]:
    """The deciding rule (or note), its source title and its source link."""
    reasons = body.get("reasons")
    first = reasons[0] if isinstance(reasons, list) and reasons and isinstance(reasons[0], dict) else {}
    text = clean_text(first.get("text")) or clean_text(first.get("note"))
    source = clean_text(first.get("source_title"))
    link = first.get("source_url") if is_https_link(first.get("source_url")) else ""
    return text, source, link


def receipt_id_of(body: dict[str, Any]) -> str:
    receipt = body.get("receipt")
    return clean_text(receipt.get("id")) if isinstance(receipt, dict) else ""


def summarise_check(body: dict[str, Any]) -> str:
    """One short message an agent can act on."""
    verdict = clean_text(body.get("verdict"))
    lines = [f"Verdict: {VERDICT_LINES.get(verdict, verdict or 'none given')}"]
    confidence = clean_text(body.get("confidence"))
    if confidence:
        lines.append(f"Confidence: {confidence}.")
    rule, source, link = first_reason(body)
    if rule:
        detail = f"Rule: {rule}"
        if source:
            detail += f" (source: {source}{', ' + link if link else ''})"
        lines.append(detail)
    next_step = clean_text(body.get("next_step"))
    if next_step:
        lines.append(f"Next step: {next_step}")
    footer = clean_text(body.get("footer_text"))
    if footer:
        lines.append(f"Footer must include: {footer} This describes the requirement; it is not wording to paste.")
    receipt_id = receipt_id_of(body)
    if receipt_id:
        lines.append(f"Receipt: {receipt_id} ({RECEIPT_PAGE_URL}{receipt_id})")
    usage = body.get("usage")
    notice = clean_text(usage.get("notice")) if isinstance(usage, dict) else ""
    if notice:
        lines.append(f"Note from Precleared: {notice}")
    return "\n".join(lines)


def check_variables(body: dict[str, Any]) -> dict[str, Any]:
    """Workflow output variables for a successful check."""
    verdict = clean_text(body.get("verdict"))
    rule, source, _ = first_reason(body)
    return {
        "verdict": verdict,
        "ok_to_send": verdict == "ok_to_email",
        "rule": rule,
        "rule_source": source,
        "next_step": clean_text(body.get("next_step")),
        "footer_text": clean_text(body.get("footer_text")),
        "receipt_id": receipt_id_of(body),
        "error": "",
    }


def error_variables(message: str) -> dict[str, Any]:
    """Workflow output variables when the check could not run."""
    return {
        "verdict": "",
        "ok_to_send": False,
        "rule": "",
        "rule_source": "",
        "next_step": "",
        "footer_text": "",
        "receipt_id": "",
        "error": message,
    }


def error_message(result: ApiResult, api_key: str | None = None, *, not_found: str | None = None) -> str:
    """A plain message for anything other than a successful answer."""
    if result.error:
        return result.error
    body = result.body or {}
    api_message = clean_text(body.get("message")) or clean_text(body.get("error"))
    status = result.status
    if status == 400:
        text = f"Precleared could not run this check: {api_message or 'the request was not valid.'}"
    elif status == 401:
        text = (
            "Precleared rejected the API key. Get a free key at "
            f"{GET_KEY_URL}, then update it in the Precleared plugin settings in Dify."
        )
    elif status == 402:
        link = body.get("buy_url") if is_https_link(body.get("buy_url")) else BUY_URL
        text = f"{api_message or 'This key has no checks left today.'} Buy more checks: {link}"
    elif status == 404 and not_found:
        text = not_found
    elif status == 429:
        text = api_message or "Precleared's limit was reached for now."
        retry = body.get("retry_after")
        if isinstance(retry, (int, float)) and not isinstance(retry, bool) and retry > 0:
            text += f" Try again in {int(retry)} seconds."
    else:
        text = f"Precleared returned an unexpected answer (HTTP {status}). Try again shortly."
    safe_text = redact(text, api_key)
    return safe_text


def normalise_receipt_id(value: Any) -> str:
    """cc_rcpt_ plus 16 capital letters or digits, or "" if the value is not a receipt ID."""
    if not isinstance(value, str):
        return ""
    candidate = value.strip()
    if candidate.lower().startswith("cc_rcpt_"):
        candidate = "cc_rcpt_" + candidate[8:].upper()
    return candidate if RECEIPT_ID_RE.match(candidate) else ""


def summarise_receipt(body: dict[str, Any]) -> str:
    receipt_id = clean_text(body.get("id"))
    verdict = clean_text(body.get("verdict")) or "not recorded"
    confidence = clean_text(body.get("confidence"))
    who = clean_text(body.get("recipient_email_masked")) or clean_text(body.get("recipient_domain"))
    created = clean_text(body.get("created_at"))
    lines = [f"Receipt {receipt_id}: verdict {verdict}" + (f" ({confidence} confidence)" if confidence else "") + "."]
    if created or who:
        lines.append("Checked" + (f" on {created}" if created else "") + (f" for {who}" if who else "") + ".")
    sender = clean_text(body.get("sender_country"))
    if sender:
        lines.append(f"Sender country: {sender}.")
    rules = body.get("rules_applied")
    if isinstance(rules, list) and rules:
        lines.append("Rules applied: " + ", ".join(clean_text(r) for r in rules if clean_text(r)) + ".")
    algorithm = clean_text(body.get("algorithm"))
    if algorithm:
        key_version = clean_text(body.get("key_version"))
        lines.append(f"Signed with {algorithm}" + (f" (key version {key_version})" if key_version else "") + ".")
    if receipt_id:
        lines.append(f"Receipt page: {RECEIPT_PAGE_URL}{receipt_id}")
    return "\n".join(lines)
