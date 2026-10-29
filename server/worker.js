// Telegram bot for Yatzy: "your turn" messages, daily reminders, nudges, invitations from any chat, friends' rating.
// One Cloudflare Worker with no dependencies: this whole file goes into the worker's code editor.
//
// Telegram sends the bot's updates here (webhook), and a cron trigger runs the worker every minute. The app never calls
// the worker: many of its players cannot reach Cloudflare, so the app leaves small requests in the Firebase database
// under req/ and the worker picks them up on its next run. The worker's own data lives under srv/, which the app
// cannot read or write; what the app may read goes to pub/. The worker signs in to Firebase with a service account.
//
// Secrets: BOT_TOKEN (from BotFather), FB_SA (the service account key JSON), HOOK_SECRET (any long random string).
// Optional variables: FB_URL, APP_LINK.

const CELLS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'three', 'four', 'small', 'large', 'house', 'chance', 'yatzy'];
const NAMES = { u1: 'Единицы', u2: 'Двойки', u3: 'Тройки', u4: 'Четвёрки', u5: 'Пятёрки', u6: 'Шестёрки', three: 'Тройка', four: 'Каре', small: 'Малый стрит', large: 'Большой стрит', house: 'Фулл-хаус', chance: 'Шанс', yatzy: 'Яцзы', joker: 'Джокер' };
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NUDGE_GAP = 30 * MIN;   // one nudge per room and sender
const FIRST_NOTE = 5 * MIN;   // a player who was in the app when the turn came gets the message once they are gone, but not before this
const REMINDERS = 3;          // daily reminders for one turn, then the bot stops
const IDLE = 30 * DAY;        // a room nobody played in for this long is forgotten
const MAX_ROOMS = 15, MAX_CHECKS = 8, MAX_REQS = 60;   // a free worker may make 50 outside calls per run
const FB_URL = 'https://yatzy-654ba-default-rtdb.europe-west1.firebasedatabase.app';
const APP_LINK = 'https://t.me/k22_yatzy_bot/play';

// ---- game helpers, the same rules as the app ----
const filled = sc => CELLS.filter(c => sc[c] != null).length;
const total = sc => { const up = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].reduce((a, c) => a + (sc[c] || 0), 0); return Object.values(sc).reduce((a, v) => a + (v || 0), 0) + (up >= 63 ? 50 : 0) };
const finished = g => !!g.ended || g.players.every((_, i) => filled(g.scores[i] || {}) === CELLS.length);
const turnOf = g => { if (finished(g)) return -1; const f = g.players.map((_, i) => filled(g.scores[i] || {})); return f.indexOf(Math.min(...f)) };
// changes when a cell is filled, so undo and redo of one move do not send twice
const turnKey = g => g.started + ':' + g.players.reduce((a, _, i) => a + filled(g.scores[i] || {}), 0);
const score = g => g.players.map((p, i) => `${p.name} ${total(g.scores[i] || {})}`).join(' : ');
const roomCode = () => [...crypto.getRandomValues(new Uint8Array(5))].map(x => ROOM_CHARS[x % ROOM_CHARS.length]).join('');
const okCode = c => typeof c === 'string' && /^[A-HJ-NP-Z2-9]{5}$/.test(c);
const okId = x => typeof x === 'string' && /^[a-z0-9]{1,24}$/.test(x);
const same = (a, b) => String(a) === String(b);
// an outside call that hangs fails after 8 s
const get = (url, opt = {}, ms = 8000) => fetch(url, { ...opt, signal: AbortSignal.timeout(ms) });

const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const hmac = async (key, data) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(data));

// ---- Telegram Mini App sign-in: initData is signed with the bot token ----
async function checkInit(init, token, now) {
  if (typeof init !== 'string' || !init) return null;
  const p = new URLSearchParams(init), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const data = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const want = hex(await hmac(await hmac('WebAppData', token), data));
  let diff = want.length ^ hash.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff || now / 1000 - +p.get('auth_date') > 7 * 86400) return null;
  try { const u = JSON.parse(p.get('user')); return u && Number.isInteger(u.id) ? u : null } catch (e) { return null }
}
// the rating marks a player's own line without showing Telegram ids: the app hashes its own id the same way
const tgHash = async id => hex(await crypto.subtle.digest('SHA-256', enc.encode('yatzy:' + id))).slice(0, 12);

// ---- Elo between every pair of rated players, scaled for games of three and four ----
function elo(rs, totals) {
  const n = rs.length, K = 32 / Math.max(1, n - 1), d = rs.map(() => 0);
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const ea = 1 / (1 + 10 ** ((rs[b] - rs[a]) / 400)), sa = totals[a] > totals[b] ? 1 : totals[a] < totals[b] ? 0 : .5;
    d[a] += K * (sa - ea); d[b] -= K * (sa - ea);
  }
  return d.map(Math.round);
}

// db: get(path) and update({path: value}), one write of many paths at once
function makeBot({ db, tg, now = Date.now, token, appLink = APP_LINK }) {
  const button = (text, code) => ({ inline_keyboard: [[{ text, url: appLink + (code ? '?startapp=' + code : '') }]] });
  const lastMove = g => { const e = (g.log || []).slice(-1)[0]; if (!e) return ''; const i = g.players.findIndex(p => p.id === e.pid), v = i < 0 ? null : (g.scores[i] || {})[e.cid]; return v == null || !NAMES[e.cid] ? '' : `${g.players[i].name}: ${NAMES[e.cid]} ${v || 'вычеркнуто'}. ` };
  const parse = r => { try { const s = r && typeof r.state === 'string' ? JSON.parse(r.state) : null; return s && typeof s === 'object' && Array.isArray(s.players) ? { s, on: r.on || {} } : null } catch (e) { return null } };

  // one run: the app's requests, then rooms where a cell was written, then turns that wait for a message
  async function tick() {
    const [reqs, srv = {}] = await Promise.all([db.get('req'), db.get('srv').then(v => v || {})]);
    const seats = srv.seats || {}, users = srv.users || {}, turns = srv.turn || {}, ratings = srv.elo || {}, nudges = srv.nudge || {}, live = srv.live || {}, rated = srv.rated || {};
    // every change is collected here and written at the end in one call
    const out = {}, pubTg = new Set();
    let rerate = false;
    const put = (map, area, key, v) => { if (v == null) delete map[key]; else map[key] = v; out[`${area}/${key}`] = v == null ? null : v };
    const seatsOf = id => Object.keys(seats).filter(c => Object.values(seats[c]).some(x => same(x, id)));
    // a message to a player; a user who blocked the bot is skipped until they allow it again
    async function tell(id, text, code, btn = 'Открыть игру') {
      const u = users[id];
      if (u && u.off) return false;
      const r = await tg('sendMessage', { chat_id: id, text, reply_markup: button(btn, code) });
      if (r && r.error_code === 403) { put(users, 'srv/users', id, { ...(u || {}), off: true }); seatsOf(id).forEach(c => pubTg.add(c)) }
      return !!(r && r.ok);
    }
    function forget(code) {
      for (const [map, area] of [[live, 'srv/live'], [seats, 'srv/seats'], [turns, 'srv/turn'], [nudges, 'srv/nudge']]) put(map, area, code, null);
      out['pub/tg/' + code] = null; pubTg.delete(code);
    }

    // requests from the app; each one is handled once, a broken or forged one is just dropped
    const list = Object.entries(reqs || {}).sort(([a], [b]) => a < b ? -1 : 1), asks = [], moved = new Set();
    for (const [id] of list) out['req/' + id] = null;
    for (const [, raw] of list.slice(0, MAX_REQS)) {
      let r; try { r = JSON.parse(raw) } catch (e) { continue }
      if (!r || !okCode(r.code)) continue;
      // anyone may say a cell was written; only rooms with Telegram players are looked at
      if (r.op === 'moved') { if (seats[r.code]) moved.add(r.code); continue }
      if (r.op !== 'hello' && r.op !== 'nudge') continue;
      if (r.op === 'hello' && !(Array.isArray(r.pids) && r.pids.length && r.pids.length <= 4 && r.pids.every(okId))) continue;
      const user = await checkInit(r.init, token, now());
      if (user) asks.push({ ...r, user });
    }
    const codes = [...new Set([...asks.map(a => a.code), ...moved])].slice(0, MAX_ROOMS);
    const rooms = Object.fromEntries(await Promise.all(codes.map(async c => [c, parse(await db.get('rooms/' + c))])));

    // "hello": who plays from this Telegram account in a room; a seat belongs to the first account that claims it
    for (const a of asks) {
      const r = rooms[a.code];
      if (a.op !== 'hello' || !r) continue;
      const here = new Set(r.s.players.concat(r.s.game ? r.s.game.players : []).map(p => p.id)), st = { ...(seats[a.code] || {}) };
      let changed = false;
      for (const pid of a.pids) if (here.has(pid) && st[pid] == null) { st[pid] = a.user.id; changed = true }
      if (changed) { put(seats, 'srv/seats', a.code, st); pubTg.add(a.code) }
      const u = users[a.user.id] || {}, off = a.allow === true ? false : !!u.off;
      if (off !== !!u.off) seatsOf(a.user.id).forEach(c => pubTg.add(c));
      put(users, 'srv/users', a.user.id, { name: String(a.user.first_name || '').slice(0, 32), off, at: now() });
      if (seats[a.code]) put(live, 'srv/live', a.code, now());
    }

    // whose turn it is now: the player on turn hears about it when they are not in the app; a finished game is rated
    async function look(code, r) {
      if (!r) { forget(code); return }
      const g = r.s.game, st = seats[code] || {};
      if (!g) { if (turns[code]) put(turns, 'srv/turn', code, null); return }
      if (finished(g)) {
        if (turns[code]) put(turns, 'srv/turn', code, null);
        const k = code + '_' + g.started;
        if (!g.ended && !rated[k]) { put(rated, 'srv/rated', k, now()); put(live, 'srv/live', code, now()); await rate(code, g, st, r.on) }
        return;
      }
      const key = turnKey(g), p = g.players[turnOf(g)], id = st[p.id], away = r.on[p.dev] !== true;
      let t = turns[code];
      if (!t || t.key !== key) { t = { key, at: now(), pid: p.id, dev: p.dev || '', away, sent: false, n: 0 }; put(turns, 'srv/turn', code, t); put(live, 'srv/live', code, now()) }
      if (id == null || !away) return;
      if (!t.sent && (t.away || now() - t.at >= FIRST_NOTE)) {
        await tell(id, `🎲 Твой ход в Яцзы. ${lastMove(g)}Счёт: ${score(g)}.`, code, 'Ходить');
        put(turns, 'srv/turn', code, { ...t, sent: true, sentAt: now() });
      } else if (t.sent && t.n < REMINDERS && now() - t.sentAt >= DAY) {
        await tell(id, `⏰ Партия в Яцзы ждёт твой ход уже ${Math.round((now() - t.at) / HOUR)} ч. Счёт: ${score(g)}.`, code, 'Ходить');
        put(turns, 'srv/turn', code, { ...t, n: t.n + 1, sentAt: now() });
      }
    }
    // rating: each finished game with two or more Telegram players counts once
    async function rate(code, g, st, on) {
      const seen = new Set();
      const who = g.players.map((p, i) => ({ id: st[p.id], p, t: total(g.scores[i] || {}) })).filter(x => x.id != null && !seen.has(String(x.id)) && seen.add(String(x.id)));
      if (who.length < 2) return;
      const cur = who.map(x => ({ r: 1000, g: 0, w: 0, ...ratings[x.id] }));
      const d = elo(cur.map(c => c.r), who.map(x => x.t)), best = Math.max(...who.map(x => x.t));
      who.forEach((x, k) => put(ratings, 'srv/elo', x.id, { name: x.p.name, r: cur[k].r + d[k], g: cur[k].g + 1, w: cur[k].w + (x.t === best ? 1 : 0) }));
      rerate = true;
      const line = who.map((x, k) => `${x.p.name} ${d[k] >= 0 ? '+' : ''}${d[k]}`).join(', ');
      for (const x of who) if (on[x.p.dev] !== true) await tell(x.id, `🏁 Партия окончена: ${score(g)}.\nРейтинг: ${line}.`, code, 'Ещё партию');
    }
    for (const code of codes) if (seats[code]) await look(code, rooms[code]);

    // "Поторопить": from a player in the room to the one on turn, once in a while
    for (const a of asks) {
      const g = a.op === 'nudge' && rooms[a.code] && rooms[a.code].s.game;
      if (!g || finished(g)) continue;
      const st = seats[a.code] || {}, from = g.players.find(p => same(st[p.id], a.user.id)), id = st[g.players[turnOf(g)].id];
      const nm = { ...(nudges[a.code] || {}) };
      if (!from || id == null || same(id, a.user.id) || now() - (nm[a.user.id] || 0) < NUDGE_GAP) continue;
      nm[a.user.id] = now(); put(nudges, 'srv/nudge', a.code, nm);
      await tell(id, `👉 ${from.name} ждёт твой ход в Яцзы. Счёт: ${score(g)}.`, a.code, 'Ходить');
    }

    // turns that wait: the first message once the player left the app, then a reminder once a day.
    // Only the small presence list is read every minute; the room itself only when a message is due.
    let checks = 0;
    for (const [code, t] of Object.entries(turns)) {
      if (codes.includes(code) || !seats[code] || seats[code][t.pid] == null || checks >= MAX_CHECKS) continue;
      if (!(t.sent ? t.n < REMINDERS && now() - t.sentAt >= DAY : now() - t.at >= FIRST_NOTE)) continue;
      checks++;
      if (((await db.get(`rooms/${code}/on`)) || {})[t.dev] === true) continue;
      await look(code, parse(await db.get('rooms/' + code)));
    }
    for (const [code, at] of Object.entries(live)) if (now() - at > IDLE) forget(code);
    for (const code of Object.keys(seats)) if (!live[code]) forget(code);

    // what the app may read: which seats the bot can write to (for the nudge button), and the rating
    for (const code of pubTg) out['pub/tg/' + code] = Object.fromEntries(Object.entries(seats[code] || {}).map(([pid, id]) => [pid, users[id] && users[id].off ? 0 : 1]));
    if (rerate) out['pub/rating'] = (await Promise.all(Object.entries(ratings).map(async ([id, x]) => ({ name: x.name, r: x.r, g: x.g, w: x.w, h: await tgHash(id) })))).sort((a, b) => b.r - a.r).slice(0, 100);
    if (Object.keys(out).length) await db.update(out);
    return out;
  }

  // updates from Telegram: /start and inline invitations from any chat
  async function update(u) {
    if (u.message && /^\/start/.test(u.message.text || '')) {
      const f = u.message.from;
      await db.update({ ['srv/users/' + f.id]: { name: String(f.first_name || '').slice(0, 32), off: false, at: now() } });
      await tg('sendMessage', { chat_id: f.id, text: 'Привет! Это блокнот для Яцзы с кубиками и игрой онлайн. Когда в онлайн-партии придёт твой ход, я напишу сюда.\n\nЧтобы позвать друга из любого чата, напиши там @' + (appLink.split('/')[3] || 'bot') + ' и выбери «Новая партия».', reply_markup: button('Открыть Яцзы') });
    }
    if (u.inline_query) {
      const q = String(u.inline_query.query || '').trim().toUpperCase(), code = okCode(q) ? q : null, fresh = roomCode();
      const card = (id, title, description, start) => ({ type: 'article', id, title, description,
        input_message_content: { message_text: '🎲 Сыграем в Яцзы? Жми кнопку, чтобы сесть за стол.' }, reply_markup: button('Играть', start) });
      const results = code ? [card('room' + code, `Позвать в комнату ${code}`, 'Друг войдёт в вашу комнату', code)] : [];
      results.push(card('new' + fresh, 'Новая партия', 'Комната создастся, когда кто-то нажмёт «Играть»', 'NEW-' + fresh));
      await tg('answerInlineQuery', { inline_query_id: u.inline_query.id, results, cache_time: 0, is_personal: true });
    }
  }
  return { tick, update };
}

// ---- Firebase Realtime Database over REST, signed in with the service account ----
function firebase(sa, url) {
  let tok = null;
  const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function token() {
    if (tok && tok.exp > Date.now() + MIN) return tok.v;
    const iat = Math.floor(Date.now() / 1000), json = o => b64(enc.encode(JSON.stringify(o)));
    const body = json({ alg: 'RS256', typ: 'JWT' }) + '.' + json({ iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
      scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email' });
    const der = Uint8Array.from(atob(String(sa.private_key).replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const jwt = body + '.' + b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(body))));
    const r = await get('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt }).then(r => r.json());
    if (!r.access_token) throw new Error('Google не пустил сервисный аккаунт: ' + (r.error_description || r.error || 'нет ответа'));
    tok = { v: r.access_token, exp: Date.now() + r.expires_in * 1000 };
    return tok.v;
  }
  const call = async (method, path, val) => {
    const r = await get(`${url}/${path}.json?access_token=${await token()}`, { method, body: val === undefined ? undefined : JSON.stringify(val) });
    if (!r.ok) throw new Error(`Firebase ${method} /${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  return { get: p => call('GET', p), update: v => call('PATCH', '', v) };
}

let made = null;
function bot(env) {
  if (made && made.key === env.BOT_TOKEN + env.FB_SA) return made;
  const token = env.BOT_TOKEN, db = firebase(JSON.parse(env.FB_SA), env.FB_URL || FB_URL);
  const tg = (method, body) => get(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json()).catch(e => ({ ok: false, description: String(e && e.message || e) }));
  made = { ...makeBot({ db, tg, token, appLink: env.APP_LINK || APP_LINK }), db, tg, key: env.BOT_TOKEN + env.FB_SA };
  return made;
}
const answer = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body, null, 2), { status, headers: { 'content-type': (typeof body === 'string' ? 'text/plain' : 'application/json') + '; charset=utf-8' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Telegram's webhook: answered at once, the work goes on after the answer
    if (request.method === 'POST') {
      if (!env.HOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== env.HOOK_SECRET) return answer('нет доступа', 403);
      const u = await request.json().catch(() => null);
      if (u) ctx.waitUntil(bot(env).update(u).catch(e => console.log('update', e && e.message)));
      return answer('ok');
    }
    // one-time setup and a check of everything: open the worker's link with ?setup=<HOOK_SECRET>
    const q = url.searchParams.get('setup');
    if (!q) return answer('Бот Яцзы работает.');
    if (!env.HOOK_SECRET || q !== env.HOOK_SECRET) return answer('Секрет не совпадает с HOOK_SECRET.', 403);
    const missing = ['BOT_TOKEN', 'FB_SA', 'HOOK_SECRET'].filter(k => !env[k]);
    if (missing.length) return answer({ ok: false, error: 'Не хватает секретов: ' + missing.join(', ') });
    try { JSON.parse(env.FB_SA) } catch (e) { return answer({ ok: false, error: 'FB_SA должен быть целым JSON-файлом ключа, от { до }.' }) }
    const b = bot(env), report = { ok: false };
    const me = await b.tg('getMe', {});
    report.telegram = me.ok ? '@' + me.result.username : 'ошибка: ' + (me.description || 'нет ответа') + ' (проверьте BOT_TOKEN)';
    if (me.ok) {
      const hook = await b.tg('setWebhook', { url: url.origin + '/', secret_token: env.HOOK_SECRET, allowed_updates: ['message', 'inline_query'] });
      report.webhook = hook.ok ? 'подключён: ' + url.origin + '/' : 'ошибка: ' + hook.description;
      await b.tg('setMyCommands', { commands: [{ command: 'start', description: 'Открыть Яцзы' }] });
      if (!me.result.supports_inline_queries) report.inline = 'выключен: в BotFather отправьте /setinline';
    }
    try {
      await b.db.update({ 'pub/bot': true });
      report.firebase = 'ok';
      const done = await b.tick();
      report.tick = 'ok, изменений: ' + Object.keys(done).length;
      report.ok = me.ok;
    } catch (e) { report.firebase = 'ошибка: ' + (e && e.message) }
    return answer(report);
  },
  // every minute
  async scheduled(event, env, ctx) {
    ctx.waitUntil(bot(env).tick().catch(e => console.log('tick', e && e.message)));
  },
};
