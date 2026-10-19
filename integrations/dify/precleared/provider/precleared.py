from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from tools.client import GET_KEY_URL, KEY_URL, call, clean_key


class PreclearedProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        """Check the key with GET /api/v1/key, which never uses up a check."""
        api_key = clean_key(credentials)
        if not api_key:
            raise ToolProviderCredentialValidationError(
                f"Add your Precleared API key. You can get a free key at {GET_KEY_URL}."
            )

        result = call("GET", KEY_URL, api_key)
        if result.error:
            raise ToolProviderCredentialValidationError(result.error)
        if result.status == 200 and (result.body or {}).get("status") == "active":
            return
        if result.status == 401:
            raise ToolProviderCredentialValidationError(
                "Precleared rejected this API key. Check that it starts with pc_live_, "
                f"or get a free key at {GET_KEY_URL}."
            )
        raise ToolProviderCredentialValidationError(
            f"Precleared could not check the key (HTTP {result.status}). Try again in a minute."
        )
