"""Guarded HTTP access for merchant-configured outbound integrations."""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import urllib.request
from functools import partial
from urllib.parse import urlsplit


def _resolve_target(
    url: str, *, allow_private: bool, resolve: bool = True
) -> tuple[str, int, list[tuple]]:
    if len(url) > 2048:
        raise ValueError("outbound URL is too long")
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as error:
        raise ValueError("outbound URL is invalid") from error
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ValueError("outbound URL must be an http(s) URL without credentials or a fragment")
    host = parsed.hostname
    port = port or (443 if parsed.scheme == "https" else 80)
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not allow_private and not literal.is_global:
            raise ValueError("private, loopback, and reserved outbound addresses are blocked")
        family = socket.AF_INET6 if literal.version == 6 else socket.AF_INET
        sockaddr = (host, port, 0, 0) if family == socket.AF_INET6 else (host, port)
        addresses = [(family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)]
    else:
        if not resolve:
            return host, port, []
        try:
            addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as error:
            raise ValueError("outbound hostname could not be resolved") from error
        if not addresses:
            raise ValueError("outbound hostname has no addresses")
        if not allow_private and any(
            not ipaddress.ip_address(address[4][0].split("%", 1)[0]).is_global
            for address in addresses
        ):
            raise ValueError("private, loopback, and reserved outbound addresses are blocked")
    return host, port, addresses


def validate_outbound_url(
    url: str,
    *,
    allow_private: bool = False,
    require_https: bool = True,
    resolve: bool = True,
) -> None:
    """Validate an outbound URL and resolve it before storing/using it."""
    _resolve_target(url, allow_private=allow_private, resolve=resolve)
    if require_https and urlsplit(url).scheme != "https":
        raise ValueError("production outbound URLs must use HTTPS")


def _connect(
    host: str,
    port: int,
    timeout: float | None,
    *,
    allow_private: bool,
) -> socket.socket:
    # Resolve again at connection time and connect to one of the checked IPs
    # directly. This prevents DNS rebinding between URL validation and connect.
    url_host = f"[{host}]" if ":" in host else host
    _, _, addresses = _resolve_target(
        f"https://{url_host}:{port}/", allow_private=allow_private
    )
    last_error: OSError | None = None
    for family, socktype, proto, _, sockaddr in addresses:
        connection = socket.socket(family, socktype, proto)
        try:
            connection.settimeout(timeout)
            connection.connect(sockaddr)
            return connection
        except OSError as error:
            last_error = error
            connection.close()
    if last_error:
        raise last_error
    raise OSError("outbound hostname has no connectable addresses")


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, *args, allow_private: bool, **kwargs) -> None:
        super().__init__(host, *args, **kwargs)
        self._allow_private = allow_private

    def connect(self) -> None:
        self.sock = _connect(
            self.host, self.port, self.timeout, allow_private=self._allow_private
        )
        if self._tunnel_host:
            self._tunnel()


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, *args, allow_private: bool, **kwargs) -> None:
        super().__init__(host, *args, **kwargs)
        self._allow_private = allow_private

    def connect(self) -> None:
        self.sock = _connect(
            self.host, self.port, self.timeout, allow_private=self._allow_private
        )
        if self._tunnel_host:
            self._tunnel()
            server_hostname = self._tunnel_host
        else:
            server_hostname = self.host
        self.sock = self._context.wrap_socket(self.sock, server_hostname=server_hostname)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Merchant credentials and webhook signatures must never be replayed to
        # a redirect target. Require subscriptions/connectors to use the final URL.
        return None


class _PinnedHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, allow_private: bool) -> None:
        super().__init__()
        self._connection = partial(_PinnedHTTPConnection, allow_private=allow_private)

    def http_open(self, request):
        return self.do_open(self._connection, request)


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, allow_private: bool) -> None:
        super().__init__(context=ssl.create_default_context())
        self._connection = partial(_PinnedHTTPSConnection, allow_private=allow_private)

    def https_open(self, request):
        return self.do_open(self._connection, request, context=self._context)


def open_outbound(
    request: urllib.request.Request,
    *,
    timeout: float,
    allow_private: bool,
    require_https: bool,
):
    """Open a bounded-policy outbound request with no environment proxy."""
    validate_outbound_url(
        request.full_url,
        allow_private=allow_private,
        require_https=require_https,
    )
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _NoRedirect(),
        _PinnedHTTPHandler(allow_private),
        _PinnedHTTPSHandler(allow_private),
    )
    return opener.open(request, timeout=timeout)
