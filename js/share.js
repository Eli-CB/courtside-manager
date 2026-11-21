// League Layer: the share pictures (the Recap's, the Draft Recap's, a trade's) and the share popup.
// The site loads js/*.js in order (see index.html); they share one scope, like one file.
'use strict';

// ----- The recap as a picture, for the league chat -----
// 1080 px wide, as tall as it needs: the league and week, the standouts, every final, the site's name. Every player is his
// round photo from the site's own sheet, as the page's cards show him (the owner's ask, Nov 2026: no cutouts there; a
// trade's picture keeps them, each player on his team's colors). Drawn on a canvas from the same recap.
const RC_IMG = { w: 1080, pad: 56, bg: '#0b0c0f', card: '#16181d', card2: '#1f2229', line: '#2a2e36', text: '#f4f4f5', soft: '#d4d8df', muted: '#9aa3b2', accent: '#f07a2a', good: '#4ade80', bad: '#f87171' };
const RC_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// An image for a canvas, or null if it won't load in 8 s. cors: from another site, which must allow it (a canvas that
// drew an image its site didn't allow can't be saved)
const canvasImg = (src, cors) => new Promise(res => {
  const im = new Image(), t = setTimeout(() => res(null), 8000);
  if (cors) im.crossOrigin = 'anonymous';
  im.onload = () => { clearTimeout(t); res(im); };
  im.onerror = () => { clearTimeout(t); res(null); };
  im.src = src;
});
const loadSheet = () => (IMG && IMG.sheet ? canvasImg(IMG.sheet) : Promise.resolve(null));
// A player's cutout for the pictures: ESPN's by his ESPN id, every sport (ESPN's photo server lets a canvas use it;
// NBA.com's, the player card's, doesn't), 520 x 380; asked once a visit (one that failed, again the next time)
const shotImgs = new Map();
function shotImg(raw) {
  if (!raw || !raw.espn || (raw.pos && raw.pos[0] === 'DEF')) return Promise.resolve(null);
  const src = `https://a.espncdn.com/combiner/i?img=/i/headshots/${SPORT.key}/players/full/${raw.espn}.png&w=520&h=380`;
  if (!shotImgs.has(src)) shotImgs.set(src, canvasImg(src, true).then(im => { if (!im) shotImgs.delete(src); return im; }));
  return shotImgs.get(src);
}
// A team's logo for the pictures: the site's own (an SVG), given a square size first (Firefox won't draw an SVG without
// one, and Chrome would stretch it from 300 x 150). Both forms: as images.json has it (base64), and as cropLogos (core.js)
// leaves it on the page, cut to its drawing and with its size taken off (utf-8)
const logoImgs = new Map();
const SVG_B64 = /^data:image\/svg\+xml;base64,(.*)$/, SVG_UTF8 = /^data:image\/svg\+xml;charset=utf-8,(.*)$/;
function logoImg(team) {
  const src = IMG && team && IMG.logos[team];
  if (!src) return Promise.resolve(null);
  if (!logoImgs.has(src)) {
    let url = src;
    const sized = svg => (/<svg[^>]*\swidth=/.test(svg) ? null : svg.replace('<svg', '<svg width="400" height="400"'));
    try {
      const b = SVG_B64.exec(src), u = !b && SVG_UTF8.exec(src);
      const svg = b ? sized(atob(b[1])) : u ? sized(decodeURIComponent(u[1])) : null;
      if (svg) url = b ? `data:image/svg+xml;base64,${btoa(svg)}` : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch (e) { url = src; }
    logoImgs.set(src, canvasImg(url));
  }
  return logoImgs.get(src);
}
// a color as rgba, darkened (dark 0-1), at an opacity (a team's color: teamTint, core.js)
function hexA(hex, a = 1, dark = 0) {
  const n = parseInt(hex.slice(1), 16), k = 1 - dark;
  return `rgba(${Math.round((n >> 16) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)},${a})`;
}

// lines of text that fit the width, at the font already set, broken between words (or between stats: sep ' · ')
function wrapText(ctx, text, max, sep = ' ') {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(sep)) {
    const next = cur ? `${cur}${sep}${w}` : w;
    if (cur && ctx.measureText(next).width > max) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
// one line, cut with … to fit
function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = String(text);
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}
// Text in styled pieces ([text, style]: 'b' bold, 'm' gray, 'a' orange, '' plain) as units that stay on one line: each
// word, its pieces joined where no space parts them ("face" + ":")
function wordUnits(list) {
  const units = [];
  let cur = null, space = true;
  for (const [t, st] of list) {
    for (const piece of String(t).split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) { space = true; continue; }
      if (space || !cur) units.push(cur = []);
      cur.push([piece, st]);
      space = false;
    }
  }
  return units;
}
// A standout's line from its HTML, styled as the page shows it: names bold, a player's fantasy team after him gray (in
// brackets: the page sets it apart by its color alone)
function htmlRuns(html) {
  const out = [];
  const walk = (node, st) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out.push([c.textContent, st]);
      else if (c.nodeType !== 1) continue;
      else if (st !== 'm' && c.classList.contains('muted')) { out.push(['(', 'm']); walk(c, 'm'); out.push([')', 'm']); }
      else walk(c, st === 'm' ? 'm' : ['B', 'STRONG', 'BUTTON'].includes(c.tagName) || c.classList.contains('team-mine') ? 'b' : st);
    }
  };
  walk(new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body, '');
  return out;
}
// numbers as units: each number bold (hot: orange, red below zero), its label gray after it ("27.5 PTS", ".623 FG% 10.8/17.3")
const statUnits = tiles => tiles.map(t => [[t.v, t.hot ? (isBelowZero(t.v) ? 'r' : 'a') : 'b'], [` ${t.k}${t.made ? ` ${t.made}` : ''}`, 'm']]);
const isBelowZero = v => /^[-−]/.test(String(v));

// What every share picture is drawn with (the recap's, the draft's, a trade's): a canvas `tall` px high in the share
// colors, and its tools (K): fonts, text, rounded cards, styled lines (lay, drawLay), a player's round photo (photo) or
// him on his team's colors (panel; prep loads the logos and those cutouts first), his team and positions (meta), the top (a kicker, a
// title, a line under it), then done(y): the site's name at the bottom and the canvas cut to what was drawn
async function sharePad(tall = 5000) {
  const C = RC_IMG, W = C.w;
  // (the site's own font: the page has it, a picture waits for it, Latin Extended too: Jokić)
  const fonts = typeof document !== 'undefined' && document.fonts ? Promise.all([400, 500, 600, 700].map(w => document.fonts.load(`${w} 40px Inter`, 'Ać'))).catch(() => {}) : null;
  const [sheet] = await Promise.all([loadSheet(), fonts]);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = tall;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, cv.height);
  // a warm glow from the top corner
  const glow = ctx.createRadialGradient(W * 0.12, -80, 0, W * 0.12, -80, 980);
  glow.addColorStop(0, hexA(C.accent, 0.22)); glow.addColorStop(1, hexA(C.accent, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 1000);
  ctx.textBaseline = 'top';
  const spacing = 'letterSpacing' in ctx;
  const font = (px, weight = 400, ls = 0) => { ctx.font = `${weight} ${px}px ${RC_FONT}`; if (spacing) ctx.letterSpacing = `${ls}px`; };
  const text = (t, x, y, color = C.text, align = 'left') => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, x, y); };
  const round = (x, y, w, h, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); };
  const clip = (x, y, w, h, r) => { ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); };
  // the logos (and for a panel the cutouts) of the players a picture shows, loaded before it's drawn (prep, 8 s at most each)
  const shots = new Map(), logos = new Map();
  // a circle's edge: `ring` (6 px, so faces that overlap stand apart), else a thin gray line, as on the site
  const edge = (cx, cy, d, ring) => {
    ctx.lineWidth = ring ? 6 : Math.max(2, d / 45); ctx.strokeStyle = ring || C.line;
    ctx.beginPath(); ctx.arc(cx, cy, d / 2 - (ring ? 0 : ctx.lineWidth / 2), 0, Math.PI * 2); ctx.stroke();
  };
  // a player's round photo as the site draws it (core.js headshot): his team's logo faded behind his face, on gray, a thin
  // gray edge (no ring in team colors: dropped on the site, the owner's ask, Nov 2026); his initials without a photo
  const photo = (p, x, y, d, ring) => {
    const raw = nbaById.get(p.nbaId) || {}, logo = logos.get(raw.team), cx = x + d / 2, cy = y + d / 2, i = IMG_INDEX.get(p.nbaId);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fillStyle = C.card2; ctx.fill(); ctx.clip();
    if (logo) { ctx.globalAlpha = 0.52; ctx.drawImage(logo, x, y, d, d); ctx.globalAlpha = 1; }
    ctx.imageSmoothingQuality = 'high'; // (the sheet's 80 px, drawn larger)
    if (sheet && i !== undefined) ctx.drawImage(sheet, (i % IMG.cols) * IMG.size, Math.floor(i / IMG.cols) * IMG.size, IMG.size, IMG.size, x, y, d, d);
    else { font(d * 0.36, 700); ctx.textBaseline = 'middle'; text(initials(p.name), cx, cy, C.muted, 'center'); ctx.textBaseline = 'top'; }
    ctx.restore();
    edge(cx, cy, d, ring);
  };
  // (cutouts: a panel's, which only a trade's picture draws)
  const prep = (ps, cutouts = true) => Promise.all(ps.filter(p => p && p.nbaId != null).map(async p => {
    const raw = nbaById.get(p.nbaId);
    const [shot, logo] = await Promise.all([cutouts ? shotImg(raw) : null, logoImg(raw && raw.team)]);
    if (shot) shots.set(p.nbaId, shot);
    if (logo) logos.set(raw.team, logo);
  }));
  // A player on his team's colors in a rounded box (r as roundRect takes it): its color, its logo faint behind him, his
  // cutout standing on the bottom edge; his round photo where there's no cutout
  const panel = (p, x, y, w, h, r) => {
    const raw = nbaById.get(p.nbaId) || {}, tint = teamTint(raw.team), shot = shots.get(p.nbaId), logo = logos.get(raw.team);
    clip(x, y, w, h, r);
    const g = ctx.createLinearGradient(x, y, x + w * 0.5, y + h);
    g.addColorStop(0, hexA(tint, 1, 0.1)); g.addColorStop(1, hexA(tint, 1, 0.62));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    if (logo) { const s = Math.max(w, h) * 1.05; ctx.globalAlpha = 0.2; ctx.drawImage(logo, x + (w - s) / 2, y + (h - s) / 2, s, s); ctx.globalAlpha = 1; }
    if (shot) { const sh = h * 0.92, sw = sh * shot.width / shot.height; ctx.drawImage(shot, x + (w - sw) / 2, y + h - sh, sw, sh); }
    else standIn(p, raw, logo, x, y, w, h);
    ctx.restore();
  };
  // where there's no cutout, in the middle of a box: a team defense's logo, else his round photo
  const standIn = (p, raw, logo, x, y, w, h) => {
    if (logo && raw.pos && raw.pos[0] === 'DEF') { const s = Math.min(w, h) * 0.72; ctx.drawImage(logo, x + (w - s) / 2, y + (h - s) / 2, s, s); return; }
    const d = Math.min(w, h) * 0.62;
    photo(p, x + (w - d) / 2, y + (h - d) / 2, d);
  };
  // styled units (wordUnits, statUnits) in lines that fit maxW at px, `gap` apart (a space by default); then drawn from
  // (x, y), lh apart, returning the y under them
  const STYLE = { b: [700, C.text], m: [500, C.muted], a: [700, C.accent], r: [700, C.bad], '': [400, C.soft] };
  const unitW = (u, px) => sum(u.map(([t, st]) => { font(px, STYLE[st][0]); return ctx.measureText(t).width; }));
  const lay = (units, maxW, px, gap) => {
    font(px);
    const g = gap ?? ctx.measureText(' ').width, lines = [];
    let line = null, w = 0;
    for (const u of units) {
      const uw = unitW(u, px);
      if (!line || (line.length && w + g + uw > maxW)) { lines.push(line = []); w = -g; }
      line.push({ u, x: w + g }); w += g + uw;
    }
    return lines;
  };
  const drawLay = (lines, x, y, px, lh) => {
    for (const line of lines) {
      for (const { u, x: ux } of line) {
        let cx = x + ux;
        for (const [t, st] of u) { font(px, STYLE[st][0]); text(t, cx, y, STYLE[st][1]); cx += ctx.measureText(t).width; }
      }
      y += lh;
    }
    return y;
  };
  // his NBA team and his positions in their colors (as on the site: slotInk), then any more ([text, color, weight])
  const meta = (x, y, px, team, pos, more = []) => {
    const runs = [[team || 'FA', C.muted, 600], ...(pos || []).flatMap((q, j) => [[j ? ',' : ' · ', C.muted], [q, slotInk(q) || C.muted, 700]]), ...more];
    let cx = x;
    for (const [t, color, weight] of runs) { font(px, weight || 500); text(t, cx, y, color); cx += ctx.measureText(t).width; }
  };
  const inner = W - C.pad * 2;
  // the top: what it is (an orange tab), the league, when (if said); the y below it
  const top = H => {
    let y = C.pad + 8;
    font(22, 700, 2.5);
    round(C.pad, y, ctx.measureText(H.kicker).width + 40, 48, 24, C.accent);
    text(H.kicker, C.pad + 20, y + 13, '#16181d');
    y += 48 + 30;
    font(80, 700, -2);
    for (const l of wrapText(ctx, H.title, inner).slice(0, 2)) { text(fitText(ctx, l, inner), C.pad, y); y += 92; }
    if (!H.sub) return y + 34;
    font(30, 500); text(H.sub, C.pad, y, C.muted);
    return y + 84;
  };
  // the site's mark, as icons/logo.svg draws it (its shapes: copy them here if it changes)
  const mark = (x, y, s) => {
    const k = s / 64;
    round(x, y, s, s, s * 0.2, '#161a22');
    for (const [pts, color] of [[[36.09, 39.16, 56.56, 28.93, 44.28, 22.78, 36.09, 26.88, 19.71, 18.69, 7.42, 24.83], '#ffffff'],
      [[7.42, 28.93, 36.09, 43.26, 56.56, 33.02, 56.56, 39.16, 36.09, 49.4, 7.42, 35.07], '#7f8a9c']]) {
      ctx.fillStyle = color; ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](x + pts[i] * k, y + pts[i + 1] * k);
      ctx.closePath(); ctx.fill();
    }
  };
  // the bottom: where it came from
  const done = y => {
    y += 44;
    ctx.fillStyle = C.line; ctx.fillRect(C.pad, y, inner, 2); y += 36;
    mark(C.pad, y, 52);
    font(30, 700, -0.3); text('League Layer', C.pad + 70, y + 10, C.text);
    font(26, 500); text('leaguelayer.com', W - C.pad, y + 13, C.muted, 'right');
    y += 52 + C.pad;
    const out = document.createElement('canvas');
    out.width = W; out.height = Math.ceil(y);
    out.getContext('2d').drawImage(cv, 0, 0);
    return out;
  };
  return { C, W, inner, ctx, font, text, round, clip, photo, prep, panel, lay, drawLay, meta, top, done };
}

// A picture to share in a league chat (1080 px wide): a kicker, the league's name and any line under it, then the
// standouts laid out as the page's cards (standoutCard, recap.js): each player with his round photo on the right, every one
// alike (no larger card for the first, the owner's ask); the rest with the round photos of any players they name; no
// emoji, the owner's ask), then any finals. H: { kicker, title, sub, items, games,
// mark: tid -> 'top' | 'bottom' | '' }.
// An item: { label, html, text }, a player's also { p, tid, stats (words), tiles (lineTiles), per (games a week's numbers
// are a game of), score: [number, unit] }, one naming players { faces }, Passport { flags: a row of country codes a team },
// a tied Homer { logos: real teams }, a team award's standout { aside: its own line, lighter }
async function shareCanvas(H) {
  const items = H.items, games = H.games || [];
  const K = await sharePad(900 + sum(items.map(it => (it.p ? 400 : 340))) + games.length * 100);
  const { C, W, inner, ctx, font, text, round, clip, photo, lay, drawLay } = K;
  // (flags from flagcdn.com, which lets a canvas use them; one that won't load is left out)
  const flagIms = new Map(), codes = [...new Set(items.flatMap(it => (it.flags || []).flat()))], clubIms = new Map();
  await Promise.all([K.prep([...items.filter(it => it.p).map(it => it.p), ...items.flatMap(it => it.faces || [])], false),
    ...codes.map(c => canvasImg(`https://flagcdn.com/w80/${c.toLowerCase()}.png`, true).then(im => { if (im) flagIms.set(c, im); })),
    ...items.flatMap(it => it.logos || []).map(t => logoImg(t).then(im => { if (im) clubIms.set(t, im); }))]);
  const x0 = C.pad, w = inner, fd = 104; // (every photo one size, a player's as a note's faces, as on the page)
  // the award in orange; a week's games after it, gray ("PLAYER OF THE PERIOD · 4 G, PER GAME")
  const labelText = (it, x, y, max) => {
    font(22, 700, 2); const t = fitText(ctx, it.label.toUpperCase(), max); text(t, x, y, C.accent);
    const per = it.p && it.tiles && it.per ? ` · ${it.per} G, PER GAME` : '', lw = ctx.measureText(t).width;
    if (per && lw + ctx.measureText(per).width <= max) text(per, x + lw, y, C.muted);
  };

  // A player, as the page's card (standoutCard, recap.js): the award; his name (one initial) and his fantasy team after it;
  // his numbers (his value or points in orange, then the league's stats; a week's games beside the award); his round photo
  // on the right. Kept short (the owner's ask, Nov 2026): no NBA team or positions, no minutes
  const player = (it, y) => {
    const p = it.p, tx = x0 + 40, tw = x0 + w - 32 - fd - 32 - tx;
    const units = it.tiles ? statUnits([{ v: it.score[0], k: it.score[1], hot: true }, ...cardTiles(it.tiles, it.per)]) : wordUnits([[it.stats || '', '']]);
    const lines = lay(units, tw, 27, it.tiles ? 22 : undefined), h = Math.max(fd + 60, 147 + lines.length * 40);
    round(x0, y, w, h, 28, C.card);
    photo(p, x0 + w - 32 - fd, y + (h - fd) / 2, fd);
    labelText(it, tx, y + 32, tw);
    // (the name and the team on one baseline; the team cut to what the name leaves)
    ctx.textBaseline = 'alphabetic';
    font(42, 700, -0.5); const name = fitText(ctx, shortName(p.name), tw), nw = ctx.measureText(name).width;
    text(name, tx, y + 106, C.text);
    font(28, 600); if (tw - nw - 18 > 80) text(fitText(ctx, fxTeamName(it.tid), tw - nw - 18), tx + nw + 18, y + 106, C.soft);
    ctx.textBaseline = 'top';
    drawLay(lines, tx, y + 128, 27, 40);
    return y + h;
  };

  // The rest: the award, its line (names bold), and the round photos of the players it names, or its flags (a row a team,
  // as wide as the widest row's flags at 48 px, smaller where a row has more than 7), or its real teams' logos (as big as
  // a photo, side by side)
  const note = (it, y) => {
    const faces = (it.faces || []).filter(f => f && f.nbaId != null).slice(0, 3), step = 72;
    const rows = (it.flags || []).map(r => r.map(c => flagIms.get(c)).filter(Boolean)).filter(r => r.length);
    const most = Math.max(0, ...rows.map(r => r.length)), fgw = Math.min(48, (400 - (most - 1) * 8) / most), fgh = fgw * 0.75;
    const flagsW = rows.length ? most * fgw + (most - 1) * 8 : 0, flagsH = rows.length * fgh + (rows.length - 1) * 12;
    const clubs = (it.logos || []).slice(0, 3).map(t => clubIms.get(t)).filter(Boolean), lg = 16;
    const fw = faces.length ? fd + (faces.length - 1) * step + 28 : rows.length ? flagsW + 28 : clubs.length ? clubs.length * (fd + lg) - lg + 28 : 0;
    const tx = x0 + 40, tw = x0 + w - 32 - fw - tx;
    // (its aside on lines of its own under them, smaller and gray: as a player's numbers)
    const lines = lay(wordUnits(htmlRuns(it.html)), tw, 31), aside = it.aside ? lay(wordUnits(htmlRuns(it.aside).map(([t]) => [t, 'm'])), tw, 27) : [];
    const block = 40 + lines.length * 44 - 8 + (aside.length ? aside.length * 40 + 2 : 0);
    const h = Math.max(block + 64, faces.length || clubs.length ? fd + 60 : 0, rows.length ? flagsH + 60 : 0, 148), ty = y + (h - block) / 2;
    round(x0, y, w, h, 28, C.card);
    labelText(it, tx, ty, tw);
    drawLay(lines, tx, ty + 40, 31, 44);
    if (aside.length) drawLay(aside, tx, ty + 40 + lines.length * 44 + 2, 27, 40);
    faces.forEach((f, i) => photo(f, x0 + w - 32 - fd - (faces.length - 1 - i) * step, y + (h - fd) / 2, fd, C.card));
    rows.forEach((r, j) => r.forEach((im, i) => {
      const fx = x0 + w - 32 - (r.length - i) * fgw - (r.length - 1 - i) * 8, fy = y + (h - flagsH) / 2 + j * (fgh + 12);
      clip(fx, fy, fgw, fgh, 4); ctx.drawImage(im, fx, fy, fgw, fgh); ctx.restore();
    }));
    clubs.forEach((im, i) => ctx.drawImage(im, x0 + w - 32 - fd - (clubs.length - 1 - i) * (fd + lg), y + (h - fd) / 2, fd, fd));
    return y + h;
  };

  let y = K.top(H);
  items.forEach(it => { y = (it.p ? player : note)(it, y) + 22; });

  // every final, winner on the left in bold, the score in the middle
  if (games.length) {
    y += 30;
    font(22, 700, 2); text('RESULTS', x0, y, C.accent);
    const lw = ctx.measureText('RESULTS').width;
    ctx.fillStyle = C.line; ctx.fillRect(x0 + lw + 20, y + 12, w - lw - 20, 2);
    y += 52;
  }
  for (const g of games) {
    font(32, 700); const sc = scoreLine(g.sc), sw = ctx.measureText(sc).width + 44, colW = (w - 64 - sw - 40) / 2; // (the names share what the score leaves)
    round(x0, y, w, 84, 22, C.card);
    round(W / 2 - sw / 2, y + 15, sw, 54, 27, C.bg);
    text(sc, W / 2, y + 26, C.accent, 'center');
    // a team's name cut to fit, its badge (Best, Worst) kept whole on the outer edge
    const side = (tid, left, weight, color) => {
      const k = H.mark ? H.mark(tid) : '', edge = left ? x0 + 32 : x0 + w - 32;
      font(17, 700, 1.5);
      const label = k ? RECAP_MARK[k].toUpperCase() : '', bw = k ? ctx.measureText(label).width + 24 : 0, room = bw ? bw + 12 : 0;
      if (k) {
        const ink = k === 'top' ? C.good : C.bad, bx = left ? edge : edge - bw;
        round(bx, y + 26, bw, 32, 16, hexA(ink, 0.16)); text(label, bx + bw / 2, y + 34, ink, 'center');
      }
      font(30, weight); text(fitText(ctx, fxTeamName(tid), colW - room), left ? edge + room : edge - room, y + 26, color, left ? 'left' : 'right');
    };
    side(g.a, true, g.won ? 700 : 500, C.text);
    side(g.b, false, 500, C.muted);
    y += 96;
  }

  return K.done(y - 22);
}

const canvasBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));

// ----- Sharing: the Recap's week and the Draft tab's awards, as a picture in a popup, or as text and a link -----
// S: { title (the popup's), name (the share sheet's), what ('Recap': the toast's), text, url, link ('Full recap': before
// the url), file, alt, draw: () => its canvas }
// The Share button (the Recap's, the Draft Recap's, a trade's): a spinner in it while its picture is drawn, which
// takes a moment (photos and logos load first): shareWith. A redraw meanwhile draws it turning again; a second tap waits
const shareBtn = (action, attrs = '') => `<button type="button" class="btn sm primary${ui.sharing ? ' busy' : ''}" data-action="${action}"${attrs}${ui.sharing ? ' disabled aria-busy="true"' : ''}>Share</button>`;
function shareBusy(on, el) {
  ui.sharing = on;
  for (const b of new Set([el, ...document.querySelectorAll('.btn.busy')])) {
    if (!b) continue;
    b.classList.toggle('busy', on); b.disabled = on;
    if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
  }
}
// The picture in the popup; the text and link (copied, or the share sheet) where a picture can't be made
async function shareWith(el, S) {
  if (ui.sharing) return;
  shareBusy(true, el);
  let shown = false;
  try {
    const blob = await canvasBlob(await S.draw());
    if (!blob) throw new Error('no image');
    if (ui.share && ui.share.img) URL.revokeObjectURL(ui.share.img);
    ui.share = { ...S, blob, img: URL.createObjectURL(blob) };
    $('#infoTitle').textContent = S.title;
    $('#infoBody').innerHTML = sharePopup(ui.share);
    const d = $('#infoDialog');
    if (!d.open) d.showModal();
    shown = true;
  } catch (e) { ui.share = S; } finally { shareBusy(false, el); }
  if (!shown) await shareText(S);
}
// The popup: the picture, then Share (the share sheet, with the picture, where the browser can), Copy, Save, or the
// text and link
function sharePopup(S) {
  const canFiles = !!(navigator.canShare && navigator.share);
  return `<img class="rc-img" src="${S.img}" alt="${esc(S.alt)}">
    <div class="fb-actions">
      ${canFiles ? '<button type="button" class="btn primary" data-action="share-img">Share image</button>' : ''}
      ${window.ClipboardItem ? `<button type="button" class="btn${canFiles ? '' : ' primary'}" data-action="share-copy">Copy image</button>` : ''}
      <a class="btn" href="${S.img}" download="${esc(S.file)}">Save image</a>
      <button type="button" class="btn" data-action="share-text">Copy text and link</button>
    </div>`;
}
// the text and link: on phones the share sheet (the league chat is one tap away); elsewhere copied
async function shareText(S) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: S.name, text: S.text, url: S.url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${S.text}\n\n${S.link}: ${S.url}`); toast(`${S.what} copied: paste it in your league chat`); } catch (e) { toast(`Couldn't copy the ${S.what.toLowerCase()}`); }
}
