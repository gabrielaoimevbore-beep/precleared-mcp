"""Tests for the Precleared Dify plugin. Every HTTP call is mocked; nothing reaches the network."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import mock

import pytest
import requests

PLUGIN_DIR = Path(__file__).resolve().parent.parent / "precleared"
sys.path.insert(0, str(PLUGIN_DIR))

from dify_plugin.entities.tool import ToolInvokeMessage  # noqa: E402
from dify_plugin.errors.tool import ToolProviderCredentialValidationError  # noqa: E402

from provider.precleared import PreclearedProvider  # noqa: E402
from tools import client  # noqa: E402
from tools.check_cold_email import CheckColdEmailTool  # noqa: E402
from tools.get_receipt import GetReceiptTool  # noqa: E402

KEY = "pc_live_TESTKEY1234567890abcdef"
RECEIPT = "cc_rcpt_ABCDEF0123456789"

OK_BODY = {
    "verdict": "ok_to_email",
    "confidence": "high",
    "reasons": [{
        "rule_key": "gb_corporate_subscriber",
        "text": "Cold B2B email to a limited company is allowed with an opt-out.",
        "source_title": "PECR regulation 22",
        "source_url": "https://www.legislation.gov.uk/uksi/2003/2426/regulation/22",
    }],
    "rules_applied": ["gb_corporate_subscriber"],
    "footer_text": "Say who you are, give a postal address and an easy way to opt out.",
    "next_step": "Send, with a compliant footer.",
    "facts": {"recipient_country": "GB"},
    "receipt": {"id": RECEIPT, "verify_url": "https://precleared.dev/r/" + RECEIPT},
    "rules_version": "2026-10-17",
    "usage": {"free_remaining_today": 24},
    "disclaimer": "Decision support with sources, not legal advice.",
}


class FakeResponse:
    def __init__(self, status: int, body=None, raw: bytes | None = None):
        self.status_code = status
        self._body = body
        self._raw = raw

    def json(self):
        if self._raw is not None:
            raise ValueError("not json")
        if self._body is None:
            raise ValueError("no body")
        return self._body


def run(tool, params: dict) -> list[ToolInvokeMessage]:
    return list(tool.invoke(dict(params)))


def texts(messages):
    return [m.message.text for m in messages if m.type == ToolInvokeMessage.MessageType.TEXT]


def jsons(messages):
    return [m.message.json_object for m in messages if m.type == ToolInvokeMessage.MessageType.JSON]


def variables(messages):
    return {
        m.message.variable_name: m.message.variable_value
        for m in messages
        if m.type == ToolInvokeMessage.MessageType.VARIABLE
    }


def everything(messages) -> str:
    return " ".join(str(m.message) for m in messages)


def check_tool(key: str = KEY) -> CheckColdEmailTool:
    return CheckColdEmailTool.from_credentials({"api_key": key})


def receipt_tool(key: str = KEY) -> GetReceiptTool:
    return GetReceiptTool.from_credentials({"api_key": key})


# ---------- request building ----------

def test_needs_an_email_or_a_domain():
    body, problem = client.build_check_body({"pitch": "bookkeeping software"})
    assert body == {} and problem == "Give a recipient email or a recipient domain."


def test_domain_alone_is_enough_and_blanks_are_dropped():
    body, problem = client.build_check_body({
        "recipient_domain": " acme.co.uk ", "recipient_email": "   ", "pitch": "",
        "recipient_country": None, "company_number": "",
    })
    assert problem is None
    assert body == {"recipient_domain": "acme.co.uk"}


def test_full_body_is_normalised():
    body, problem = client.build_check_body({
        "recipient_email": "jo@acme.co.uk", "sender_country": "gb", "address_source": "published",
        "pitch": "dental software", "recipient_country": "gb", "default_recipient_country": "us",
        "company_number": "01234567", "pitch_relevant": "yes", "existing_customer": False, "suppressed": "false",
    })
    assert problem is None
    assert body == {
        "recipient_email": "jo@acme.co.uk", "sender_country": "GB", "address_source": "published",
        "pitch": "dental software", "recipient_country": "GB", "default_recipient_country": "US",
        "company_number": "01234567", "pitch_relevant": True, "existing_customer": False, "suppressed": False,
    }


@pytest.mark.parametrize("field,value,message", [
    ("recipient_country", "GBR", "Recipient country must be a two-letter country code"),
    ("default_recipient_country", "1A", "Fallback country must be a two-letter country code"),
    ("sender_country", "DE", "Sender country must be one of: GB, US, AE."),
    ("address_source", "linkedin", "Address source must be one of: published, bought, scraped, given, unknown."),
])
def test_bad_values_are_refused_before_any_request(field, value, message):
    body, problem = client.build_check_body({"recipient_email": "jo@acme.co.uk", field: value})
    assert body == {} and problem.startswith(message)


def test_uae_sender_is_accepted():
    body, problem = client.build_check_body({"recipient_email": "jo@acme.co.uk", "sender_country": "ae"})
    assert problem is None
    assert body == {"recipient_email": "jo@acme.co.uk", "sender_country": "AE"}


def test_unset_pitch_relevant_is_not_sent():
    body, _ = client.build_check_body({"recipient_email": "jo@acme.co.uk", "pitch_relevant": None})
    assert "pitch_relevant" not in body


# ---------- Check cold email compliance ----------

def test_ok_verdict_gives_summary_json_and_variables():
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(200, OK_BODY)) as post:
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk", "sender_country": "GB"})

    post.assert_called_once()
    args, kwargs = post.call_args
    assert args[0] == "https://precleared.dev/api/v1/check"
    assert kwargs["json"] == {"recipient_email": "jo@acme.co.uk", "sender_country": "GB"}
    assert kwargs["headers"]["Authorization"] == f"Bearer {KEY}"
    assert kwargs["headers"]["User-Agent"].startswith("precleared-dify-plugin/")
    assert kwargs["timeout"] == client.TIMEOUT

    summary = texts(messages)[0]
    assert summary.startswith("Verdict: ok_to_email. You may send this email")
    assert "Rule: Cold B2B email to a limited company is allowed with an opt-out. (source: PECR regulation 22" in summary
    assert "Next step: Send, with a compliant footer." in summary
    assert "not wording to paste" in summary
    assert f"Receipt: {RECEIPT} (https://precleared.dev/r/{RECEIPT})" in summary
    assert jsons(messages) == [OK_BODY]
    assert variables(messages) == {
        "verdict": "ok_to_email", "ok_to_send": True,
        "rule": "Cold B2B email to a limited company is allowed with an opt-out.",
        "rule_source": "PECR regulation 22", "next_step": "Send, with a compliant footer.",
        "footer_text": "Say who you are, give a postal address and an easy way to opt out.",
        "receipt_id": RECEIPT, "error": "",
    }
    assert KEY not in everything(messages)


def test_unknown_is_treated_as_consent_needed():
    body = dict(OK_BODY, verdict="unknown", reasons=[{"note": "The recipient's country could not be worked out."}],
                footer_text=None, next_step="Pass recipient_country and check again.")
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(200, body)):
        messages = run(check_tool(), {"recipient_domain": "acme.example"})
    summary = texts(messages)[0]
    assert "treat this as consent_needed and do not send" in summary
    assert "Rule: The recipient's country could not be worked out." in summary
    assert variables(messages)["ok_to_send"] is False
    assert variables(messages)["verdict"] == "unknown"


def test_consent_needed_and_low_balance_notice():
    body = dict(OK_BODY, verdict="consent_needed",
                usage={"credits_remaining": 150, "low_balance": True, "notice": "This key has 150 checks left."})
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(200, body)):
        messages = run(check_tool(), {"recipient_email": "sam@soletrader.co.uk"})
    summary = texts(messages)[0]
    assert summary.startswith("Verdict: consent_needed. Do not send")
    assert "Note from Precleared: This key has 150 checks left." in summary


def test_missing_recipient_never_calls_the_api():
    with mock.patch.object(client.requests, "post") as post:
        messages = run(check_tool(), {"pitch": "anything"})
    post.assert_not_called()
    assert texts(messages) == ["Not checked, so do not send yet. Give a recipient email or a recipient domain."]
    assert variables(messages)["error"] == "Give a recipient email or a recipient domain."
    assert variables(messages)["ok_to_send"] is False
    assert jsons(messages)[0]["verdict"] is None


def test_400_shows_the_api_message():
    with mock.patch.object(client.requests, "post",
                           return_value=FakeResponse(400, {"error": "invalid_request", "message": "recipient_email is not a valid address."})):
        messages = run(check_tool(), {"recipient_email": "not-an-address"})
    assert "Precleared could not run this check: recipient_email is not a valid address." in texts(messages)[0]
    assert jsons(messages)[0]["error_code"] == "invalid_request"


def test_401_points_to_a_free_key_and_never_echoes_the_key():
    with mock.patch.object(client.requests, "post",
                           return_value=FakeResponse(401, {"error": "invalid_key", "message": f"Bad key {KEY}"})):
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk"})
    message = texts(messages)[0]
    assert "rejected the API key" in message and "https://precleared.dev/get-key" in message
    assert KEY not in everything(messages)


def test_402_gives_the_api_message_and_its_buy_link():
    link = "https://precleared.dev/buy/session_abc"
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(402, {
        "error": "payment_required", "message": "This key has used today's free checks.", "buy_url": link,
    })):
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk"})
    message = texts(messages)[0]
    assert "This key has used today's free checks. Buy more checks: " + link in message
    assert jsons(messages)[0]["buy_url"] == link
    assert variables(messages)["error"].endswith(link)


@pytest.mark.parametrize("bad_link", [None, "http://precleared.dev/buy", "javascript:alert(1)", "https://x.dev/a b", 42])
def test_402_without_a_usable_link_falls_back_to_the_buy_page(bad_link):
    body = {"error": "payment_required", "message": "No checks left."}
    if bad_link is not None:
        body["buy_url"] = bad_link
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(402, body)):
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk"})
    assert texts(messages)[0].endswith("Buy more checks: https://precleared.dev/buy")


def test_429_shows_the_api_message_and_retry_time():
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(429, {
        "error": "rate_limited", "message": "Too many checks this minute.", "retry_after": 12,
    })):
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk"})
    assert "Too many checks this minute. Try again in 12 seconds." in texts(messages)[0]


def test_429_without_a_body():
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(429, raw=b"")):
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk"})
    assert "Precleared's limit was reached for now." in texts(messages)[0]


def test_server_error_and_non_json():
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(502, raw=b"<html>")):
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk"})
    assert "unexpected answer (HTTP 502)" in texts(messages)[0]


def test_200_without_a_verdict_is_not_treated_as_cleared():
    with mock.patch.object(client.requests, "post", return_value=FakeResponse(200, {"something": "else"})):
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk"})
    assert "answered without a verdict" in texts(messages)[0]
    assert variables(messages)["ok_to_send"] is False


@pytest.mark.parametrize("exc,expected", [
    (requests.Timeout("slow"), "did not answer in time"),
    (requests.ConnectionError("down"), "Could not reach Precleared"),
])
def test_network_problems(exc, expected):
    with mock.patch.object(client.requests, "post", side_effect=exc):
        messages = run(check_tool(), {"recipient_email": "jo@acme.co.uk"})
    assert expected in texts(messages)[0]
    assert variables(messages)["ok_to_send"] is False


# ---------- Get a receipt ----------

RECEIPT_BODY = {
    "id": RECEIPT, "created_at": "2026-10-18T21:14:04.291+00:00", "verdict": "consent_needed",
    "confidence": "high", "rules_applied": ["gb_individual_consent"], "recipient_domain": "precleared.dev",
    "recipient_email_masked": "s***@precleared.dev", "sender_country": "GB", "rules_version": "2026-10-17",
    "request_hash": "a" * 64, "response_hash": "b" * 64, "signature": "sig", "algorithm": "Ed25519",
    "key_version": "1", "public_key": "pk",
}


def test_receipt_found():
    with mock.patch.object(client.requests, "get", return_value=FakeResponse(200, RECEIPT_BODY)) as get:
        messages = run(receipt_tool(), {"receipt_id": RECEIPT})
    args, kwargs = get.call_args
    assert args[0] == "https://precleared.dev/api/v1/receipt"
    assert kwargs["params"] == {"id": RECEIPT}
    assert "Authorization" not in kwargs["headers"]
    summary = texts(messages)[0]
    assert summary.startswith(f"Receipt {RECEIPT}: verdict consent_needed (high confidence).")
    assert "for s***@precleared.dev" in summary
    assert f"Receipt page: https://precleared.dev/r/{RECEIPT}" in summary
    assert jsons(messages) == [RECEIPT_BODY]


def test_receipt_id_is_normalised():
    with mock.patch.object(client.requests, "get", return_value=FakeResponse(200, RECEIPT_BODY)) as get:
        run(receipt_tool(), {"receipt_id": "  CC_RCPT_abcdef0123456789 "})
    assert get.call_args.kwargs["params"] == {"id": RECEIPT}


def test_receipt_not_found():
    missing = "cc_rcpt_0000000000000000"
    with mock.patch.object(client.requests, "get", return_value=FakeResponse(404, {"error": "not found"})):
        messages = run(receipt_tool(), {"receipt_id": missing})
    assert texts(messages)[0].startswith(f"No Precleared receipt with ID {missing}.")
    assert jsons(messages)[0]["status"] == 404


@pytest.mark.parametrize("bad", ["", "rcpt_123", "cc_rcpt_123", "cc_rcpt_ABCDEF012345678!", None])
def test_receipt_bad_id_never_calls_the_api(bad):
    with mock.patch.object(client.requests, "get") as get:
        messages = run(receipt_tool(), {"receipt_id": bad})
    get.assert_not_called()
    assert texts(messages)[0].startswith("That is not a Precleared receipt ID.")


def test_receipt_network_problem():
    with mock.patch.object(client.requests, "get", side_effect=requests.ConnectionError("down")):
        messages = run(receipt_tool(), {"receipt_id": RECEIPT})
    assert "Could not reach Precleared" in texts(messages)[0]


# ---------- credential validation ----------

def provider() -> PreclearedProvider:
    return PreclearedProvider()


def test_valid_key_passes_without_spending_a_check():
    body = {"key_prefix": "pc_live_TEST", "status": "active"}
    with mock.patch.object(client.requests, "get", return_value=FakeResponse(200, body)) as get, \
            mock.patch.object(client.requests, "post") as post:
        provider()._validate_credentials({"api_key": f"  {KEY} "})
    post.assert_not_called()
    args, kwargs = get.call_args
    assert args[0] == "https://precleared.dev/api/v1/key"
    assert kwargs["headers"]["Authorization"] == f"Bearer {KEY}"


@pytest.mark.parametrize("response,expected", [
    (FakeResponse(401, {"error": "invalid_key"}), "rejected this API key"),
    (FakeResponse(401, {"error": "revoked_key"}), "rejected this API key"),
    (FakeResponse(200, {"status": "revoked"}), "could not check the key (HTTP 200)"),
    (FakeResponse(500, raw=b"oops"), "could not check the key (HTTP 500)"),
])
def test_bad_keys_are_refused(response, expected):
    with mock.patch.object(client.requests, "get", return_value=response):
        with pytest.raises(ToolProviderCredentialValidationError) as err:
            provider()._validate_credentials({"api_key": KEY})
    assert expected in str(err.value)
    assert KEY not in str(err.value)


def test_missing_key_is_refused_without_a_request():
    with mock.patch.object(client.requests, "get") as get:
        with pytest.raises(ToolProviderCredentialValidationError) as err:
            provider()._validate_credentials({"api_key": "   "})
    get.assert_not_called()
    assert "https://precleared.dev/get-key" in str(err.value)


def test_key_check_network_problem():
    with mock.patch.object(client.requests, "get", side_effect=requests.Timeout("slow")):
        with pytest.raises(ToolProviderCredentialValidationError) as err:
            provider()._validate_credentials({"api_key": KEY})
    assert "did not answer in time" in str(err.value)


# ---------- the plugin loads the way Dify loads it ----------

def test_plugin_manifest_and_classes_load(monkeypatch):
    from dify_plugin import DifyPluginEnv
    from dify_plugin.core.plugin_registration import PluginRegistration

    monkeypatch.chdir(PLUGIN_DIR)
    registration = PluginRegistration(DifyPluginEnv())
    assert registration.configuration.author == "precleared"
    assert registration.configuration.name == "precleared"
    provider_config, provider_cls, tools = registration.tools_mapping["precleared"]
    assert provider_cls is not None and provider_cls.__name__ == "PreclearedProvider"
    assert sorted(tools) == ["check_cold_email", "get_receipt"]
    check_config, check_cls = tools["check_cold_email"]
    names = [p.name for p in check_config.parameters]
    assert names == [
        "recipient_email", "recipient_domain", "sender_country", "address_source", "pitch",
        "recipient_country", "default_recipient_country", "company_number", "pitch_relevant",
        "existing_customer", "suppressed",
    ]
    assert set(check_config.output_schema["properties"]) == {
        "verdict", "ok_to_send", "rule", "rule_source", "next_step", "footer_text", "receipt_id", "error",
    }
    assert [c.name for c in provider_config.credentials_schema] == ["api_key"]
    assert provider_config.credentials_schema[0].required is True
    assert {f.filename for f in registration.files} == {"icon.svg"}


def test_shipped_text_has_no_em_dashes_or_allowance_numbers():
    shipped = [p for p in PLUGIN_DIR.rglob("*") if p.is_file() and p.suffix in {".md", ".yaml", ".py", ".toml"}]
    assert shipped
    for path in shipped:
        text = path.read_text(encoding="utf-8")
        assert "—" not in text, f"em dash in {path.name}"
        for phrase in ("25 checks", "100 checks", "10 checks", "£39", "2,000"):
            assert phrase not in text, f"{phrase!r} in {path.name}"
