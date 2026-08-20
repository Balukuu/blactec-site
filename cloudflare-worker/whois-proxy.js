/**
 * BlacTec .ug domain-availability proxy — Cloudflare Worker
 *
 * Uganda's ccTLD registry doesn't publish a public, CORS-enabled availability API.
 * Their own registrar portal (new.registry.co.ug) has an internal domain-search
 * endpoint (POST /check_domain_status) that returns real, accurate availability —
 * but it's a same-origin Rails endpoint: it rejects requests carrying a foreign
 * Origin header (422, no CORS headers), and requires a session cookie + CSRF token
 * obtained by first loading the portal's homepage. This Worker performs that two-step
 * dance server-side (bootstrap session, then check) and hands back a small JSON verdict.
 *
 * Because this is an undocumented internal endpoint of a third party, it could change
 * without notice — every failure mode here degrades to a 502 with an `error` field
 * rather than a guessed answer, so the site can fall back to an honest "couldn't verify"
 * state instead of showing wrong data.
 *
 * Endpoint: GET /?domain=<label>&tld=<.ug|.co.ug|.org.ug|.ac.ug>
 * Response: { domain, available, suggestedTlds, checkedAt } or { error }
 */

const REGISTRY_ORIGIN = 'https://new.registry.co.ug';
const ALLOWED_TLDS = ['.ug', '.co.ug', '.org.ug', '.ac.ug'];

// Origins allowed to call this proxy. CORS headers alone only stop browsers from
// *reading* a cross-origin response — they don't stop a script from calling this
// URL directly, so we also reject disallowed origins before doing any lookup.
const ALLOWED_ORIGINS = new Set([
  'https://blactec.ug',
  'https://www.blactec.ug',
]);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isValidLabel(label) {
  return /^[a-z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-');
}

/** Loads the registrar portal's homepage to obtain a fresh session cookie + CSRF token. */
async function bootstrapSession() {
  const res = await fetch(`${REGISTRY_ORIGIN}/`, {
    headers: { 'User-Agent': BROWSER_USER_AGENT },
  });
  if (!res.ok) throw new Error(`registry_bootstrap_http_${res.status}`);

  const setCookie = res.headers.get('set-cookie');
  const html = await res.text();
  const csrfMatch = html.match(/<meta name="csrf-token" content="([^"]+)"/);

  if (!setCookie || !csrfMatch) throw new Error('registry_bootstrap_shape_changed');

  return { cookie: setCookie.split(';')[0], csrfToken: csrfMatch[1] };
}

/** Calls the portal's own domain-search endpoint with a valid session + CSRF token. */
async function checkDomainStatus(fullDomain) {
  const { cookie, csrfToken } = await bootstrapSession();

  const res = await fetch(`${REGISTRY_ORIGIN}/check_domain_status`, {
    method: 'POST',
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-CSRF-Token': csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookie,
      'Referer': `${REGISTRY_ORIGIN}/`,
      'Origin': REGISTRY_ORIGIN,
    },
    body: JSON.stringify({ domain_name: fullDomain }),
  });

  if (!res.ok) throw new Error(`registry_check_http_${res.status}`);

  const data = await res.json().catch(() => null);
  if (!data || typeof data.status !== 'string') throw new Error('registry_check_shape_changed');

  return data;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const originAllowed = ALLOWED_ORIGINS.has(origin);

    if (request.method === 'OPTIONS') {
      return originAllowed
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : new Response(null, { status: 403 });
    }

    if (!originAllowed) {
      return json({ error: 'origin_not_allowed' }, 403, {});
    }

    const headers = corsHeaders(origin);

    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, headers);
    }

    const url = new URL(request.url);
    const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();
    const tld = (url.searchParams.get('tld') || '').trim().toLowerCase();

    if (!ALLOWED_TLDS.includes(tld)) {
      return json({ error: 'unsupported_tld' }, 400, headers);
    }
    if (!isValidLabel(domain)) {
      return json({ error: 'invalid_domain' }, 400, headers);
    }

    const fullDomain = domain + tld;

    try {
      const data = await checkDomainStatus(fullDomain);

      if (data.status === 'AVAILABLE') {
        return json(
          {
            domain: fullDomain,
            available: true,
            suggestedTlds: Array.isArray(data.suggested_tlds) ? data.suggested_tlds : [],
            checkedAt: new Date().toISOString(),
          },
          200,
          headers,
        );
      }

      if (data.status === 'NOT_AVAILABLE') {
        return json({ domain: fullDomain, available: false, checkedAt: new Date().toISOString() }, 200, headers);
      }

      // TLD_NOT_SUPPORTED, RESTRICTED, or any future status we don't recognize —
      // surface it rather than guessing.
      return json({ error: `registry_status_${data.status}` }, 502, headers);
    } catch (err) {
      return json({ error: 'registry_lookup_failed', message: String((err && err.message) || err) }, 502, headers);
    }
  },
};
