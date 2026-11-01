// League Layer's Yahoo helper: a Cloudflare Worker. Yahoo's fantasy API needs a Yahoo login (OAuth 2.0) and doesn't
// allow requests from other sites' pages, so this small server does the two things the site can't:
//   GET  /yahoo/login?return=<page>   sends the visitor to Yahoo to sign in and allow read access
//   GET  /yahoo/callback              Yahoo sends them back here; trades the code for tokens (that needs the app's
//                                     secret, which only this server has) and returns them to the page, after #yahoo=
//   POST /yahoo/refresh               a fresh access token from the refresh token the page keeps
//   GET  /yahoo/api/<path>            the fantasy API itself, passed through with the visitor's token
// Nothing is stored here: each visitor's tokens live in their own browser.
// Settings (wrangler.toml and `wrangler secret put`): YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, SITE_ORIGINS.

const AUTH = 'https://api.login.yahoo.com/oauth2/';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2/';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origins = String(env.SITE_ORIGINS || 'https://leaguelayer.com').split(',').map(s => s.trim());
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origins.includes(origin) ? origin : origins[0],
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const callback = `${url.origin}/yahoo/callback`;
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    // the page to send someone back to: only the site's own pages
    const safeReturn = r => { try { const u = new URL(r); return origins.includes(u.origin) ? u.origin + u.pathname : origins[0] + '/'; } catch (e) { return origins[0] + '/'; } };
    const tokens = body => fetch(AUTH + 'get_token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    if (url.pathname === '/yahoo/login') {
      const state = btoa(safeReturn(url.searchParams.get('return') || ''));
      const to = new URL(AUTH + 'request_auth');
      to.search = new URLSearchParams({ client_id: env.YAHOO_CLIENT_ID, redirect_uri: callback, response_type: 'code', language: 'en-us', state }).toString();
      return Response.redirect(to.toString(), 302);
    }

    if (url.pathname === '/yahoo/callback') {
      let back = origins[0] + '/';
      try { back = safeReturn(atob(url.searchParams.get('state') || '')); } catch (e) { /* the site's front page */ }
      const code = url.searchParams.get('code');
      if (!code) return Response.redirect(`${back}#yahoo-error=${encodeURIComponent(url.searchParams.get('error') || 'cancelled')}`, 302);
      const r = await tokens({ grant_type: 'authorization_code', code, redirect_uri: callback });
      if (!r.ok) return Response.redirect(`${back}#yahoo-error=${r.status}`, 302);
      const t = await r.json();
      // in the address's fragment, which browsers never send to any server
      const pass = btoa(JSON.stringify({ access: t.access_token, refresh: t.refresh_token, until: Date.now() + (t.expires_in || 3600) * 1000 }));
      return Response.redirect(`${back}#yahoo=${encodeURIComponent(pass)}`, 302);
    }

    if (url.pathname === '/yahoo/refresh' && req.method === 'POST') {
      const { refresh } = await req.json().catch(() => ({}));
      if (!refresh) return json({ error: 'no refresh token' }, 400);
      const r = await tokens({ grant_type: 'refresh_token', refresh_token: refresh, redirect_uri: callback });
      if (!r.ok) return json({ error: `Yahoo answered ${r.status}` }, 401);
      const t = await r.json();
      return json({ access: t.access_token, refresh: t.refresh_token || refresh, until: Date.now() + (t.expires_in || 3600) * 1000 });
    }

    if (url.pathname.startsWith('/yahoo/api/') && req.method === 'GET') {
      const auth = req.headers.get('Authorization') || '';
      if (!/^Bearer \S+$/.test(auth)) return json({ error: 'sign in with Yahoo' }, 401);
      const path = url.pathname.slice('/yahoo/api/'.length);
      if (!/^[\w.;,=\/-]+$/.test(path)) return json({ error: 'bad path' }, 400);
      const q = new URLSearchParams(url.search);
      q.set('format', 'json');
      const r = await fetch(`${API}${path}?${q}`, { headers: { Authorization: auth, Accept: 'application/json' } });
      return new Response(r.body, { status: r.status, headers: { ...cors, 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' } });
    }

    return json({ error: 'not found' }, 404);
  },
};
