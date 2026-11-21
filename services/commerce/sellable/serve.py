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

    uvicorn.run("sellable.main:app", host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
