// Single source of truth for the Demo Mode routing flag.
//
// The demo cookie is a ROUTING HINT, never an auth credential: it only
// selects the isolated demo adapter (fixtures + localStorage overlay) in
// lib/api.ts. It must stay readable from document.cookie so hasDemoCookie()
// works — never httpOnly. Server routes set/clear it; the client can also
// clear it on sign-in (same Path/SameSite attributes, Max-Age=0).
export const DEMO_COOKIE = "sellable_demo_auth";

/** 24h demo session. Short on purpose: demo state is disposable. */
export const DEMO_COOKIE_MAX_AGE = 60 * 60 * 24;
