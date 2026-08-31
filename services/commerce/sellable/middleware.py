"""ASGI middleware that exposes the raw request body hash for HMAC binding.

The request body is read once, its SHA-256 is stashed on ``scope["state"]`` so
the agent-auth dependency can include it in the signed canonical string, and the
body is replayed to the downstream application unchanged.
"""

from __future__ import annotations

import hashlib
from typing import Any


class RequestBodyCaptureMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunks.append(message.get("body", b""))
            more_body = message.get("more_body", False)
        body = b"".join(chunks)

        state = scope.setdefault("state", {})
        state["sellable_body_sha256"] = hashlib.sha256(body).hexdigest() if body else ""

        sent = False

        async def wrapped_receive() -> dict[str, Any]:
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, wrapped_receive, send)