from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.client import RECEIPT_URL, call, clean_key, error_message, normalise_receipt_id, summarise_receipt

ID_HINT = "Receipt IDs look like cc_rcpt_ followed by 16 capital letters and digits, for example cc_rcpt_0123456789ABCDEF."


class GetReceiptTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        receipt_id = normalise_receipt_id(tool_parameters.get("receipt_id"))
        if not receipt_id:
            message = f"That is not a Precleared receipt ID. {ID_HINT}"
            yield self.create_text_message(message)
            yield self.create_json_message({"error": message, "status": None})
            return

        # Receipts are public, so the key is not sent with this request.
        result = call("GET", RECEIPT_URL, params={"id": receipt_id})
        answer = result.body or {}
        if result.status == 200 and answer.get("id"):
            yield self.create_text_message(summarise_receipt(answer))
            yield self.create_json_message(answer)
            return

        message = error_message(
            result,
            clean_key(self.runtime.credentials),
            not_found=f"No Precleared receipt with ID {receipt_id}. {ID_HINT}",
        )
        yield self.create_text_message(message)
        yield self.create_json_message({"error": message, "status": result.status})
