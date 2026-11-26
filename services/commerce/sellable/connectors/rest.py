"""Generic custom-REST connector: any merchant HTTP API that lists
products becomes a SELLABLE source through URL + field mapping. Stdlib
HTTPS only.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from sellable.connectors.base import BaseConnector, ConnectorError
from sellable.config import settings
from sellable.outbound import open_outbound, validate_outbound_url


MAX_CONNECTOR_RESPONSE_BYTES = 5 * 1024 * 1024


class RestConnector(BaseConnector):
    """Fetch product lists from a merchant JSON endpoint."""

    provider = "custom_rest"

    def fetch_raw(self, *, limit: int = 500) -> list[dict]:
        if self._fetcher is not None:
            return list(self._fetcher(limit=limit))[:limit]
        base_url = (self.config.base_url or "").rstrip("/")
        if not base_url:
            raise ConnectorError("custom_rest connector needs a base_url")
        url = f"{base_url}{self.config.products_path}"
        try:
            validate_outbound_url(
                url,
                allow_private=settings.is_dev_environment,
                require_https=not settings.is_dev_environment,
            )
        except ValueError as error:
            raise ConnectorError(f"unsafe connector URL: {error}") from error
        headers = {"Accept": "application/json", **dict(self.config.headers or {})}
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with open_outbound(
                request,
                timeout=self.config.timeout_seconds,
                allow_private=settings.is_dev_environment,
                require_https=not settings.is_dev_environment,
            ) as response:
                raw = response.read(MAX_CONNECTOR_RESPONSE_BYTES + 1)
                if len(raw) > MAX_CONNECTOR_RESPONSE_BYTES:
                    raise ConnectorError("source response exceeds 5 MiB")
                payload = json.loads(raw.decode("utf-8"))
        except ConnectorError:
            raise
        except json.JSONDecodeError as error:
            raise ConnectorError("source did not return valid JSON") from error
        except ValueError as error:
            raise ConnectorError(f"unsafe connector URL: {error}") from error
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 303, 307, 308):
                raise ConnectorError("source redirects are blocked") from error
            raise ConnectorError(f"source returned HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise ConnectorError(f"source unreachable: {error.reason}") from error
        records = payload.get("products", payload) if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            raise ConnectorError("source did not return a product list")
        return records[:limit]
