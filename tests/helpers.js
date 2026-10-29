// Shared helpers: a static server for the built index.html, a browser, and a fake room server for online tests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

async function start() {
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = p.endsWith(path.sep) ? path.join(p, 'index.html') : p;
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const rooms = {}, pages = [];
  const ctl = { failNext: null, writes: 0 };
  // requests the pages leave for the bot, and what the bot publishes for them
  const reqs = [], pub = {};
  const push = c => pages.forEach(p => p.evaluate(([c, s, o]) => window.__netPush && window.__netPush(c, s, o),
    [c, rooms[c] ? rooms[c].state : null, rooms[c] ? rooms[c].on : {}]).catch(() => {}));

  // a page in its own context, i.e. a separate device; init runs once with empty storage
  async function device(name, init, { online = false, viewport = { width: 820, height: 1180 }, hash = '', setup } = {}) {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', acceptDownloads: true });
    // keep the real Firebase and Google Fonts out of the tests
    await ctx.route(/^https:\/\/(www\.gstatic|fonts\.googleapis|fonts\.gstatic)\.com\//, r => r.abort());
    if (online) {
      await ctx.exposeFunction('__netGet', c => rooms[c] ? rooms[c].state : null);
      await ctx.exposeFunction('__netGetOn', c => rooms[c] ? rooms[c].on : {});
      await ctx.exposeFunction('__netCas', (c, cur, v) => {
        if (ctl.failNext === name) { ctl.failNext = null; throw new Error('PERMISSION_DENIED'); }
        const now = rooms[c] ? rooms[c].state : null;
        if (now !== cur) return false;
        ctl.writes++;
        if (v == null) { if (rooms[c]) rooms[c].state = null; } else (rooms[c] = rooms[c] || { on: {} }).state = v;
        push(c); return true;
      });
      await ctx.exposeFunction('__netSetOn', (c, d, on) => { if (!rooms[c]) return; rooms[c].on[d] = on; push(c); });
      await ctx.exposeFunction('__netRemove', c => { delete rooms[c]; push(c); });
      await ctx.exposeFunction('__netSend', v => { reqs.push({ from: name, ...JSON.parse(v) }); });
      await ctx.exposeFunction('__netRead', p => p.split('/').reduce((o, k) => o == null ? null : o[k], { pub }) ?? null);
      await ctx.addInitScript(fakeNet);
    }
    if (setup) await setup(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    pages.push(page);
    await page.goto(url + hash);
    await page.evaluate(init || (() => localStorage.clear()));
    await page.reload();
    // a page that does not even load fails at once instead of timing out test by test
    if (errors.length) throw new Error('the page failed to load: ' + errors.join('; '));
    return page;
  }
  return {
    url, errors, rooms, ctl, device, reqs, pub,
    // what a room server would send after its data was changed behind the app's back
    tamper(code, fn) { const s = JSON.parse(rooms[code].state); fn(s); rooms[code].state = JSON.stringify(s); push(code); },
    async stop() { await browser.close(); server.close(); },
  };
}

// runs in the page: the same interface as the Firebase backend in src/online.js, backed by the test process.
// Like Firebase, a transaction is first tried against an empty local cache,
// and a room read by a transaction is handed to a new watcher at once.
function fakeNet() {
  window.__yatzyNet = () => {
    const L = { st: {}, on: {}, seen: {} }, dev = () => JSON.parse(localStorage.getItem('yatzy.dev'));
    window.__netPush = (c, s, o) => { (L.st[c] || []).forEach(f => f(s)); (L.on[c] || []).forEach(f => f(o || {})); };
    const sub = (map, code, cb, first) => { (map[code] = map[code] || []).push(cb); if (map === L.st && code in L.seen) cb(L.seen[code]); first(code).then(cb); return () => { map[code] = map[code].filter(f => f !== cb); }; };
    return {
      async tx(code, fn) {
        let cur = null;
        for (let i = 0; i < 6; i++) {
          const v = fn(cur);
          if (v === undefined) { const real = await window.__netGet(code); if (real === cur) { L.seen[code] = cur; return { ok: false, val: cur }; } cur = real; continue; }
          if (await window.__netCas(code, cur, v)) { L.seen[code] = v; return { ok: true, val: v }; }
          cur = await window.__netGet(code);
        }
        return { ok: false, val: cur };
      },
      watch: (code, cb) => sub(L.st, code, cb, window.__netGet),
      watchOn: (code, cb) => sub(L.on, code, cb, window.__netGetOn),
      setOn: (code, on) => window.__netSetOn(code, dev(), on),
      remove: code => window.__netRemove(code),
      connected(cb) { setTimeout(() => cb(true)); return () => {}; },
      send: v => window.__netSend(v),
      read: p => window.__netRead(p),
    };
  };
}

const twoPlayers = () => {
  localStorage.clear();
  localStorage.setItem('yatzy.roster', JSON.stringify([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Миша' }]));
};
// state of the app as plain data
const state = p => p.evaluate(() => ({
  names: game && game.players.map(x => x.name), turn: whoseTurn(), scores: game && game.scores,
  roll: game && game.roll && { n: game.roll.n, dice: game.roll.dice.slice(), held: game.roll.held.slice() },
  hist: history.length, saved: !!(game && game.saved), over: !!over(), log: game ? (game.log || []).length : 0,
}));
const settle = p => p.waitForFunction(() => !rolling, null, { timeout: 8000 });

module.exports = { start, twoPlayers, state, settle };
