// Loads the site's scripts (js/*.js) in Node with a stand-in page, saved Fantrax/NBA responses instead of the network,
// and a fixed clock, so the tests exercise the same code the site runs.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const NOW = Date.parse('2026-10-26T20:00:00-04:00'); // a Monday evening, week 2 of the fixtures' season

// An element that accepts anything the app does to it
class El {
  constructor() {
    this.dataset = {}; this.style = {}; this.hidden = false; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.open = false;
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  addEventListener() {} removeEventListener() {} setAttribute() {} removeAttribute() {} scrollIntoView() {}
  showModal() {} close() {} focus() {} closest() { return null; } querySelector() { return null; } querySelectorAll() { return []; }
}

function readFixture(rel) {
  const file = path.join(FIX, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

// Serve data files and Fantrax API calls from tests/fixtures
function fakeFetch(url) {
  const u = new URL(String(url), 'http://localhost/');
  let body = null;
  if (u.pathname.endsWith('/data/players.json')) body = readFixture('players.json');
  else if (u.pathname.endsWith('/data/boxscores.json')) body = readFixture('boxscores.json');
  else if (u.pathname.includes('/data/seasons/')) body = readFixture('seasons/' + u.pathname.split('/').pop());
  else if (u.hostname === 'www.fantrax.com') {
    const ep = u.pathname.split('/').pop();
    const id = u.searchParams.get('leagueId');
    const period = u.searchParams.get('period');
    body = id ? readFixture(`fantrax/${id}/${ep}${period ? '-' + period : ''}.json`) : readFixture(`fantrax/${ep}.json`);
  }
  const ok = body != null;
  return Promise.resolve({ ok, status: ok ? 200 : 404, text: async () => body, json: async () => JSON.parse(body) });
}

function loadApp() {
  const store = new Map();
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [NOW])); }
    static now() { return NOW; }
  }
  const document = {
    documentElement: new El(), body: new El(),
    querySelector: () => new El(), querySelectorAll: () => [], getElementById: () => new El(),
    addEventListener() {}, createElement: () => new El(),
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, URL, Intl, Math, JSON, Promise, Map, Set,
    Date: FixedDate,
    location: { hostname: 'example.test', hash: '', search: '', reload() {} },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    fetch: fakeFetch,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: { clipboard: { writeText: async () => {} } },
    requestAnimationFrame: f => setTimeout(f, 0),
    structuredClone: v => JSON.parse(JSON.stringify(v)),
    confirm: () => true,
    addEventListener() {}, scrollTo() {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // the page's scripts, in the order index.html loads them, one script at a time like the browser
  // (so a file using something only a later file defines fails here too)
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  // gives tests access to the scripts' top-level let/const bindings
  vm.runInContext('globalThis.__get = expr => eval(expr);', ctx);
  // app.anyName finds functions and constants whether they're declared with function, const or let
  const app = new Proxy(ctx, {
    get(t, k) {
      if (k in t || typeof k !== 'string' || k === 'then') return t[k];
      try { return ctx.__get(k); } catch (e) { return undefined; }
    },
  });
  app.get = expr => ctx.__get(expr);
  app.set = (name, value) => { ctx.__value = value; ctx.__get(`${name} = globalThis.__value`); };
  app.ready = () => ctx.__get('nbaLoading');
  // load a Fantrax league from the fixtures and make it the current one
  app.useLeague = async id => {
    const res = await ctx.fetchFantraxLeague(id);
    const L = res.league;
    ctx.__get('NBA').league = L;
    ctx.applyLeagueRules(L);
    return L;
  };
  return app;
}

module.exports = { loadApp, readFixture, NOW };
