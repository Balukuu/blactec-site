# .ug domain-availability proxy

Uganda's ccTLD registry doesn't publish a public, CORS-enabled availability API, so
the domain checker on the site can't query `.ug` / `.co.ug` / `.org.ug` / `.ac.ug`
directly from the browser. This Worker relays the registrar portal's own domain-search
endpoint (`new.registry.co.ug`) server-side and hands back a small JSON verdict.

`.com` / `.org` / `.net` don't need this — the site queries their RDAP servers
directly from the browser via the public `rdap.org` bootstrap, which supports CORS.

## How it works

`new.registry.co.ug` has an internal `POST /check_domain_status` endpoint that returns
real, accurate availability plus suggested alternate TLDs — but it's a same-origin
Rails endpoint: it rejects requests carrying a foreign `Origin` header, and requires a
valid session cookie + CSRF token obtained by first loading the portal's homepage.
This Worker does that two-step dance (bootstrap session → check domain) on every
request, so it always uses a fresh, valid session rather than caching one.

Because this is an **undocumented internal endpoint of a third party**, it could
change shape without notice — every failure mode here returns a 502 with an `error`
field instead of guessing, so the site falls back to an honest "couldn't verify" state
rather than showing wrong data.

## Deploy status

Deployed by Claude via the Cloudflare REST API using the account's API token — no
local Node/wrangler install needed. Live URL is wired into `UG_WHOIS_PROXY_URL` in
`src/main.ts` (and mirrored in `dist/main.js`).

## Notes

- The Worker only accepts requests from `https://blactec.ug` and
  `https://www.blactec.ug` (checked server-side, not just via CORS headers) — update
  the `ALLOWED_ORIGINS` list in `whois-proxy.js` if the site ever moves domains or
  you want to test from a staging URL.
- No API keys, no database, no ongoing cost at this site's traffic level — the free
  Workers plan covers far more requests per day than a domain-search box will ever see.
- If the registry ever changes their portal's markup, cookie name, or endpoint shape,
  lookups will start returning the "couldn't verify" fallback state instead of breaking
  silently — check this file's Worker logs (Cloudflare dashboard → Workers → Logs) if
  `.ug` checks start failing.
- To redeploy after an edit to `whois-proxy.js` without local tooling, `PUT` the file
  to `https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/blactec-ug-whois`
  with the Cloudflare API token (multipart: a `metadata` JSON part with
  `{"main_module":"whois-proxy.js","compatibility_date":"2026-01-01"}`, plus the script
  itself as `Content-Type: application/javascript+module`).
