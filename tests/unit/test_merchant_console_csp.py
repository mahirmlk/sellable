from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONSOLE = ROOT / "apps" / "merchant-console"


def test_dashboard_script_policy_uses_nonce_without_inline_scripts():
    policy = (CONSOLE / "lib" / "security" / "dashboard-csp.ts").read_text()
    script_directive = next(
        part.strip() for part in policy.split('"') if part.strip().startswith("script-src ")
    ) if False else None

    # Keep the CSP builder explicit: dashboard scripts must use a fresh nonce,
    # and must never regain the unsafe-inline escape hatch.
    assert "'nonce-${nonce}'" in policy
    assert "'unsafe-inline'" not in policy.split("script-src", 1)[1].split("\n", 1)[0]
    assert "nonce must be base64 encoded" in policy


def test_dashboard_nonce_is_forwarded_to_next_and_browser():
    proxy = (CONSOLE / "proxy.ts").read_text()
    middleware = (CONSOLE / "lib" / "supabase" / "middleware.ts").read_text()

    assert "btoa(crypto.randomUUID())" in proxy
    assert 'forwardedHeaders.set("Content-Security-Policy", csp)' in proxy
    assert 'response.headers.set("Content-Security-Policy", csp)' in proxy
    assert "updateSession(request, forwardedHeaders)" in proxy
    assert "NextResponse.next({ request: { headers: forwardedHeaders } })" in middleware


def test_refreshed_supabase_cookies_survive_nonce_header_forwarding():
    middleware = (CONSOLE / "lib" / "supabase" / "middleware.ts").read_text()

    assert 'forwardedHeaders?.set(' in middleware
    assert '"cookie"' in middleware
    assert 'request.headers.get("cookie")' in middleware
