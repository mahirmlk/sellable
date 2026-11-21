"""ASGI middleware that exposes the raw request body hash for HMAC binding.

The request body is read once, its SHA-256 is stashed on ``scope["state"]`` so
the agent-auth dependency can include it in the signed canonical string, and the
body is replayed to the downstream application unchanged.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


# Current write APIs only need small JSON payloads (the largest persisted
# checkout snapshot is separately capped at 256 KiB). Keep a little room for
# protocol metadata while bounding memory consumed before route validation.
MAX_REQUEST_BODY_BYTES = 1_048_576


class RequestBodyCaptureMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        body_size = 0
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            body_size += len(chunk)
            if body_size > MAX_REQUEST_BODY_BYTES:
                response_body = json.dumps(
                    {"detail": f"Request body exceeds {MAX_REQUEST_BODY_BYTES} bytes"}
                ).encode("utf-8")
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(response_body)).encode("ascii")),
                        ],
                    }
                )
                await send(
                    {"type": "http.response.body", "body": response_body}
                )
                return
            chunks.append(chunk)
            more_body = message.get("more_body", False)
        body = b"".join(chunks)

        state = scope.setdefault("state", {})
        state["sellable_body_sha256"] = hashlib.sha256(body).hexdigest() if body else ""

        sent = False

        async def wrapped_receive() -> dict[str, Any]:
            nonlocal sent
            if not sent:
                # Replay the buffered body exactly once so downstream body
                # parsing is unchanged.
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            # Afterwards proxy the REAL channel. Returning a synthetic empty
            # request here (as this code used to) swallows http.disconnect
            # forever: request.is_disconnected() can never fire, Starlette
            # can never cancel SSE responses, and closed browser connections
            # leak server-side streams that poll the database indefinitely.
            return await receive()

        await self.app(scope, wrapped_receive, send)
