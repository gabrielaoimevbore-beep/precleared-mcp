from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.client import (
    CHECK_URL,
    build_check_body,
    call,
    check_variables,
    clean_key,
    error_message,
    error_variables,
    summarise_check,
)


class CheckColdEmailTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        api_key = clean_key(self.runtime.credentials)
        body, problem = build_check_body(tool_parameters)
        if problem:
            yield from self._not_checked(problem, status=None)
            return

        result = call("POST", CHECK_URL, api_key, json_body=body)
        answer = result.body or {}
        if result.status == 200 and answer.get("verdict"):
            yield self.create_text_message(summarise_check(answer))
            yield self.create_json_message(answer)
            for name, value in check_variables(answer).items():
                yield self.create_variable_message(name, value)
            return

        if result.status == 200:
            message = "Precleared answered without a verdict. Treat this address as not cleared and try again later."
        else:
            message = error_message(result, api_key)
        yield from self._not_checked(message, status=result.status, answer=answer)

    def _not_checked(
        self, message: str, *, status: int | None, answer: dict[str, Any] | None = None
    ) -> Generator[ToolInvokeMessage, None, None]:
        """The check did not produce a verdict, so the address is not cleared."""
        yield self.create_text_message(f"Not checked, so do not send yet. {message}")
        payload: dict[str, Any] = {"verdict": None, "error": message, "status": status}
        if answer:
            if isinstance(answer.get("error"), str):
                payload["error_code"] = answer["error"]
            for field in ("buy_url", "retry_after"):
                if field in answer:
                    payload[field] = answer[field]
        yield self.create_json_message(payload)
        for name, value in error_variables(message).items():
            yield self.create_variable_message(name, value)
