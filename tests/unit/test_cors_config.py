"""Tests for CORS origin parsing and the preflight response.

CORS misconfiguration silently breaks every browser API call with a preflight
400, so the ``CORS_ORIGINS`` parser must tolerate the common env-var mistakes
(JSON arrays, quotes, whitespace, trailing slashes) and the middleware must
answer the exact preflight the browser sends for authenticated requests.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from sellable.config import _parse_cors_origins
from sellable.main import app


def test_parse_simple_comma_separated() -> None:
    assert _parse_cors_origins("https://sellable.shop,http://localhost:3000") == (
        "https://sellable.shop",
        "http://localhost:3000",
    )


def test_parse_json_array_format() -> None:
    raw = '["https://sellable.shop", "http://localhost:3000"]'
    assert _parse_cors_origins(raw) == ("https://sellable.shop", "http://localhost:3000")


def test_parse_quoted_and_whitespace() -> None:
    raw = '"https://sellable.shop", \'http://localhost:3000\',  '
    assert _parse_cors_origins(raw) == ("https://sellable.shop", "http://localhost:3000")


def test_parse_strips_trailing_slash_and_deduplicates() -> None:
    raw = "https://sellable.shop/,https://sellable.shop,https://www.example.com/"
    assert _parse_cors_origins(raw) == ("https://sellable.shop", "https://www.example.com")


def test_parse_empty_or_blank() -> None:
    assert _parse_cors_origins(None) == ()
    assert _parse_cors_origins("") == ()
    assert _parse_cors_origins("   ") == ()


def test_preflight_for_production_origin_is_allowed() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/agents/status",
            headers={
                "Origin": "https://sellable.shop",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization, content-type, x-agent-key",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://sellable.shop"
    assert response.headers["access-control-allow-credentials"] == "true"
    methods = response.headers["access-control-allow-methods"].lower()
    for method in ("get", "post", "patch", "delete", "options"):
        assert method in methods
    headers = response.headers["access-control-allow-headers"].lower()
    for header in ("authorization", "content-type", "x-agent-key"):
        assert header in headers


def test_preflight_for_disallowed_origin_is_rejected() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/agents/status",
            headers={
                "Origin": "https://www.sellable.shop",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert response.status_code == 400