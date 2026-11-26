"""Security guards for merchant-configured outbound HTTP integrations."""

from __future__ import annotations

import socket
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import pytest

from sellable.outbound import open_outbound, validate_outbound_url


def test_private_literal_addresses_are_rejected_in_production() -> None:
    with pytest.raises(ValueError, match="private"):
        validate_outbound_url("https://127.0.0.1/hook")


@pytest.mark.parametrize("address", ["224.0.0.1", "[ff02::1]"])
def test_multicast_literal_addresses_are_rejected_in_production(address: str) -> None:
    with pytest.raises(ValueError, match="reserved"):
        validate_outbound_url(f"https://{address}/hook")


@pytest.mark.parametrize("address", ["64:ff9b::7f00:1", "64:ff9b::a00:1"])
def test_nat64_addresses_embedding_private_ipv4_are_rejected(address: str) -> None:
    with pytest.raises(ValueError, match="reserved"):
        validate_outbound_url(f"https://[{address}]/hook")


def test_dns_nat64_answer_is_rejected(monkeypatch) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (
                socket.AF_INET6,
                socket.SOCK_STREAM,
                socket.IPPROTO_TCP,
                "",
                ("64:ff9b::7f00:1", 443, 0, 0),
            )
        ],
    )
    with pytest.raises(ValueError, match="reserved"):
        validate_outbound_url("https://merchant.example/hook")


def test_development_can_use_local_http_targets() -> None:
    validate_outbound_url(
        "http://127.0.0.1:8080/hook",
        allow_private=True,
        require_https=False,
    )


def test_mixed_public_and_private_dns_answers_are_rejected(monkeypatch) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", 443)),
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", 443)),
        ],
    )
    with pytest.raises(ValueError, match="private"):
        validate_outbound_url("https://merchant.example/hook")


def test_production_rejects_http_even_for_public_hosts(monkeypatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_a, **_kw: [])
    with pytest.raises(ValueError, match="HTTPS"):
        validate_outbound_url("http://merchant.example/hook", resolve=False)


def test_outbound_redirects_are_rejected() -> None:
    class RedirectHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            self.send_response(302)
            self.send_header("Location", "http://127.0.0.1:1/internal")
            self.end_headers()

        def log_message(self, *_args) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), RedirectHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_port}/redirect"
        with pytest.raises(urllib.error.HTTPError) as raised:
            open_outbound(
                urllib.request.Request(url),
                timeout=2,
                allow_private=True,
                require_https=False,
            )
        assert raised.value.code == 302
    finally:
        server.shutdown()
        thread.join(timeout=2)
        server.server_close()
