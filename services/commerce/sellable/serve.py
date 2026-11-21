"""Start the API on the port provided by the hosting platform."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    raw_port = os.getenv("PORT", "8000")
    try:
        port = int(raw_port)
    except ValueError as error:
        raise SystemExit("PORT must be an integer from 1 to 65535") from error
    if not 1 <= port <= 65535:
        raise SystemExit("PORT must be an integer from 1 to 65535")

    trust_proxy_headers = os.getenv("TRUST_PROXY_HEADERS", "").lower() in {
        "1",
        "true",
        "yes",
    }
    uvicorn.run(
        "sellable.main:app",
        host="0.0.0.0",
        port=port,
        proxy_headers=trust_proxy_headers,
        forwarded_allow_ips="*" if trust_proxy_headers else "127.0.0.1",
    )


if __name__ == "__main__":
    main()
