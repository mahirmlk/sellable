"""Generic custom-REST connector: any merchant HTTP API that lists
products becomes a SELLABLE source through URL + field mapping. Stdlib
HTTPS only.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from sellable.connectors.base import BaseConnector, ConnectorError


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
        headers = {"Accept": "application/json", **dict(self.config.headers or {})}
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(
                request, timeout=self.config.timeout_seconds
            ) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise ConnectorError(f"source returned HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise ConnectorError(f"source unreachable: {error.reason}") from error
        records = payload.get("products", payload) if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            raise ConnectorError("source did not return a product list")
        return records[:limit]
