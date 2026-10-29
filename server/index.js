// Telegram bot for Yatzy: "your turn" messages, daily reminders, nudges, invitations from any chat, friends' rating.
// Runs as one Yandex Cloud Function (Node.js 18+, no dependencies). Its data lives in the same Firebase database
// as the rooms, under srv/, which the app cannot read or write: the function signs in with a service account.
//
// Environment: BOT_TOKEN (from BotFather), FB_SA (the service account key JSON), HOOK_SECRET (any long random string).
// Optional: FB_URL, APP_LINK, APP_ORIGIN, SELF_URL.
const crypto = require('crypto');
// the function's network has no IPv6 route: an IPv6 address first makes every call hang until the timeout
require('dns').setDefaultResultOrder('ipv4first');
try { require('net').setDefaultAutoSelectFamily(true) } catch (e) {}
// an outside call that hangs fails after 8 s instead of eating the function's whole time
const get = (url, opt = {}) => fetch(url, { ...opt, signal: AbortSignal.timeout(8000) });

const CELLS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'three', 'four', 'small', 'large', 'house', 'chance', 'yatzy'];
const NAMES = { u1: 'Единицы', u2: 'Двойки', u3: 'Тройки', u4: 'Четвёрки', u5: 'Пятёрки', u6: 'Шестёрки', three: 'Тройка', four: 'Каре', small: 'Малый стрит', large: 'Большой стрит', house: 'Фулл-хаус', chance: 'Шанс', yatzy: 'Яцзы', joker: 'Джокер' };
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NUDGE_GAP = 30 * MIN;   // one nudge per room and sender
const FIRST_NOTE = 5 * MIN;   // a player who was in the app when the turn came gets the message once they are gone this long
const REMINDERS = 3;          // daily reminders for one turn, then the bot stops

// ---- game helpers, the same rules as the app ----
const filled = sc => CELLS.filter(c => sc[c] != null).length;
const total = sc => { const up = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].reduce((a, c) => a + (sc[c] || 0), 0); return Object.values(sc).reduce((a, v) => a + (v || 0), 0) + (up >= 63 ? 50 : 0) };
const finished = g => !!g.ended || g.players.every((_, i) => filled(g.scores[i] || {}) === CELLS.length);
const turnOf = g => { if (finished(g)) return -1; const f = g.players.map((_, i) => filled(g.scores[i] || {})); return f.indexOf(Math.min(...f)) };
// changes when a cell is filled, so undo and redo of one move do not send twice
const turnKey = g => g.started + ':' + g.players.reduce((a, _, i) => a + filled(g.scores[i] || {}), 0);
const score = g => g.players.map((p, i) => `${p.name} ${total(g.scores[i] || {})}`).join(' : ');
const roomCode = () => [...crypto.randomBytes(5)].map(x => ROOM_CHARS[x % ROOM_CHARS.length]).join('');
const okCode = c => typeof c === 'string' && /^[A-HJ-NP-Z2-9]{5}$/.test(c);
const okId = x => typeof x === 'string' && /^[a-z0-9]{1,24}$/.test(x);

// ---- Telegram Mini App sign-in: initData is signed with the bot token ----
function checkInit(init, token, now) {
  if (typeof init !== 'string' || !init) return null;
  const p = new URLSearchParams(init), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const data = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const want = crypto.createHmac('sha256', key).update(data).digest('hex');
  if (want.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(hash))) return null;
  if (now / 1000 - +p.get('auth_date') > 7 * 86400) return null;
  try { const u = JSON.parse(p.get('user')); return u && Number.isInteger(u.id) ? u : null } catch (e) { return null }
}

// ---- Elo between every pair of rated players, scaled for games of three and four ----
function elo(rs, totals) {
  const n = rs.length, K = 32 / Math.max(1, n - 1), d = rs.map(() => 0);
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const ea = 1 / (1 + 10 ** ((rs[b] - rs[a]) / 400)), sa = totals[a] > totals[b] ? 1 : totals[a] < totals[b] ? 0 : .5;
    d[a] += K * (sa - ea); d[b] -= K * (sa - ea);
  }
  return d.map(Math.round);
}

function makeBot({ db, tg, now = Date.now, token, appLink, roomState }) {
  const button = (text, code) => ({ inline_keyboard: [[{ text, url: appLink + (code ? '?startapp=' + code : '') }]] });
  // a message to a player; a user who blocked the bot is skipped until they allow it again
  async function tell(id, text, code, btn = 'Открыть игру') {
    const u = await db.get(`srv/users/${id}`);
    if (u && u.off) return false;
    const r = await tg('sendMessage', { chat_id: id, text, reply_markup: button(btn, code) });
    if (r && r.error_code === 403) await db.patch(`srv/users/${id}`, { off: true });
    return !!(r && r.ok);
  }
  const room = async code => { const s = await roomState(code); return s && typeof s === 'object' ? s : null };
  const online = async (code, dev) => (await db.get(`rooms/${code}/on/${dev}`)) === true;
  const lastMove = g => { const e = (g.log || []).slice(-1)[0]; if (!e) return ''; const i = g.players.findIndex(p => p.id === e.pid), v = i < 0 ? null : (g.scores[i] || {})[e.cid]; return v == null || !NAMES[e.cid] ? '' : `${g.players[i].name}: ${NAMES[e.cid]} ${v || 'вычеркнуто'}. ` };

  // the player on turn hears about it when they are not in the app
  async function turnNews(code, s, seats, why) {
    const g = s.game, i = turnOf(g), key = turnKey(g);
    if (i < 0) return;
    const p = g.players[i], id = seats[p.id];
    let t = await db.get(`srv/turn/${code}`);
    if (!t || t.key !== key) { t = { key, at: now(), pid: p.id, sent: false, n: 0 }; await db.put(`srv/turn/${code}`, t) }
    if (!id || t.sent || await online(code, p.dev)) return;
    if (why === 'timer' && now() - t.at < FIRST_NOTE) return;
    await tell(id, `🎲 Твой ход в Яцзы. ${lastMove(g)}Счёт: ${score(g)}.`, code, 'Ходить');
    await db.patch(`srv/turn/${code}`, { sent: true, sentAt: now() });
  }

  // rating: each finished game counts once
  async function rate(code, s, seats) {
    const g = s.game;
    if (g.ended || !finished(g)) return null;
    const ids = g.players.map(p => seats[p.id]), seen = new Set();
    const who = g.players.map((p, i) => ({ id: ids[i], name: p.name, t: total(g.scores[i] || {}) })).filter(x => x.id && !seen.has(x.id) && seen.add(x.id));
    if (who.length < 2 || !await db.claim(`srv/rated/${code}_${g.started}`)) return null;
    const cur = await Promise.all(who.map(x => db.get(`srv/elo/${x.id}`)));
    const d = elo(cur.map(c => (c && c.r) || 1000), who.map(x => x.t)), best = Math.max(...who.map(x => x.t));
    await Promise.all(who.map((x, k) => db.put(`srv/elo/${x.id}`, { name: x.name, r: ((cur[k] && cur[k].r) || 1000) + d[k], g: ((cur[k] && cur[k].g) || 0) + 1, w: ((cur[k] && cur[k].w) || 0) + (x.t === best ? 1 : 0) })));
    return who.map((x, k) => ({ ...x, d: d[k] }));
  }

  const api = {
    // the app reports who plays from this Telegram account in a room
    async hello({ user, code, pids, allow }) {
      const s = await room(code);
      if (!s || !Array.isArray(pids)) return { ok: false };
      const mine = s.players.concat(s.game ? s.game.players : []).filter(p => pids.includes(p.id));
      const seats = (await db.get(`srv/seats/${code}`)) || {};
      for (const p of mine) if (!seats[p.id] || seats[p.id] === user.id || seats[p.id] === String(user.id)) seats[p.id] = user.id;
      await db.put(`srv/seats/${code}`, seats);
      const u = (await db.get(`srv/users/${user.id}`)) || {};
      await db.put(`srv/users/${user.id}`, { name: String(user.first_name || '').slice(0, 32), off: allow ? false : !!u.off, at: now() });
      return { ok: true };
    },
    // the app made a move or started a game
    async moved({ code }) {
      const s = await room(code);
      if (!s || !s.game) return { ok: false };
      const seats = (await db.get(`srv/seats/${code}`)) || {};
      if (!finished(s.game)) { await turnNews(code, s, seats, 'move'); return { ok: true } }
      await db.del(`srv/turn/${code}`);
      const r = await rate(code, s, seats);
      if (r) for (const p of s.game.players) {
        const id = seats[p.id];
        if (id && !await online(code, p.dev)) await tell(id, `🏁 Партия окончена: ${score(s.game)}.\nРейтинг: ${r.map(x => `${x.name} ${x.d >= 0 ? '+' : ''}${x.d}`).join(', ')}.`, code, 'Ещё партию');
      }
      return { ok: true, rated: !!r };
    },
    // "Поторопить": once in a while, from a player in the room to the one on turn
    async nudge({ user, code }) {
      const s = await room(code);
      if (!s || !s.game || finished(s.game)) return { ok: false, why: 'Партия не идёт.' };
      const seats = (await db.get(`srv/seats/${code}`)) || {}, g = s.game, i = turnOf(g);
      const from = g.players.find(p => String(seats[p.id]) === String(user.id)), to = g.players[i], id = seats[to.id];
      if (!from) return { ok: false, why: 'Вы не играете в этой комнате.' };
      if (String(id) === String(user.id)) return { ok: false, why: 'Сейчас ваш ход.' };
      if (!id) return { ok: false, why: `${to.name} играет не через Telegram, бот не может написать.` };
      const last = (await db.get(`srv/nudge/${code}/${user.id}`)) || 0;
      if (now() - last < NUDGE_GAP) return { ok: false, wait: Math.ceil((NUDGE_GAP - (now() - last)) / MIN) };
      await db.put(`srv/nudge/${code}/${user.id}`, now());
      const sent = await tell(id, `👉 ${from.name} ждёт твой ход в Яцзы. Счёт: ${score(g)}.`, code, 'Ходить');
      return sent ? { ok: true, wait: NUDGE_GAP / MIN } : { ok: false, why: `${to.name} не разрешил боту писать.` };
    },
    async rating({ user }) {
      const all = (await db.get('srv/elo')) || {};
      const list = Object.entries(all).map(([id, x]) => ({ name: x.name, r: x.r, g: x.g, w: x.w, me: id === String(user.id) })).sort((a, b) => b.r - a.r).slice(0, 50);
      return { ok: true, list };
    },
  };

  // every few minutes: the first "your turn" for those who were in the app, then a reminder once a day
  async function tick() {
    const all = (await db.get('srv/turn')) || {};
    for (const [code, t] of Object.entries(all)) {
      const s = await room(code);
      if (!s || !s.game || finished(s.game)) { await db.del(`srv/turn/${code}`); continue }
      const seats = (await db.get(`srv/seats/${code}`)) || {};
      if (turnKey(s.game) !== t.key || !t.sent) { await turnNews(code, s, seats, 'timer'); continue }
      const g = s.game, p = g.players[turnOf(g)], id = seats[p.id];
      if (!id || t.n >= REMINDERS || now() - (t.sentAt || t.at) < DAY || await online(code, p.dev)) continue;
      const h = Math.round((now() - t.at) / HOUR);
      await tell(id, `⏰ Партия в Яцзы ждёт твой ход уже ${h} ч. Счёт: ${score(g)}.`, code, 'Ходить');
      await db.patch(`srv/turn/${code}`, { n: t.n + 1, sentAt: now() });
    }
  }

  // updates from Telegram: /start and inline invitations from any chat
  async function update(u) {
    if (u.message && /^\/start/.test(u.message.text || '')) {
      const id = u.message.from.id;
      await db.patch(`srv/users/${id}`, { name: String(u.message.from.first_name || '').slice(0, 32), off: false, at: now() });
      await tg('sendMessage', { chat_id: id, text: 'Привет! Это блокнот для Яцзы с кубиками и игрой онлайн. Когда в онлайн-партии придёт твой ход, я напишу сюда.\n\nЧтобы позвать друга из любого чата, напиши там @' + (appLink.split('/')[3] || 'bot') + ' и выбери «Новая партия».', reply_markup: button('Открыть Яцзы') });
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
  return { api, tick, update };
}

// ---- Firebase Realtime Database over REST, signed in with the service account ----
function firebase(sa, url) {
  let tok = null;
  async function token() {
    if (tok && tok.exp > Date.now() + MIN) return tok.v;
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url'), iat = Math.floor(Date.now() / 1000);
    const body = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600,
      scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email' });
    const jwt = body + '.' + crypto.createSign('RSA-SHA256').update(body).sign(sa.private_key, 'base64url');
    const r = await get('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt }).then(r => r.json());
    if (!r.access_token) throw new Error('Firebase sign-in failed');
    tok = { v: r.access_token, exp: Date.now() + r.expires_in * 1000 };
    return tok.v;
  }
  const req = async (method, path, val, headers = {}) => {
    const r = await get(`${url}/${path}.json?access_token=${await token()}`, { method, headers, body: val === undefined ? undefined : JSON.stringify(val) });
    if (!r.ok && r.status !== 412) throw new Error(`Firebase ${method} ${path}: ${r.status}`);
    return r;
  };
  return {
    get: async p => (await req('GET', p)).json(),
    put: (p, v) => req('PUT', p, v),
    patch: (p, v) => req('PATCH', p, v),
    del: p => req('DELETE', p),
    // true for the first caller only: a conditional write on an empty spot
    async claim(p) {
      const r = await req('GET', p, undefined, { 'X-Firebase-ETag': 'true' });
      if ((await r.json()) != null) return false;
      return (await req('PUT', p, true, { 'if-match': r.headers.get('etag') })).status === 200;
    },
  };
}

let bot = null;
function setup() {
  if (bot) return bot;
  const env = process.env, token = env.BOT_TOKEN, sa = JSON.parse(env.FB_SA);
  const db = firebase(sa, env.FB_URL || 'https://yatzy-654ba-default-rtdb.europe-west1.firebasedatabase.app');
  const tg = (method, body) => get(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(e => ({ ok: false, description: String(e && (e.cause || e.message) || e) }));
  const roomState = async code => { const v = await db.get(`rooms/${code}/state`); try { return typeof v === 'string' ? JSON.parse(v) : null } catch (e) { return null } };
  bot = { ...makeBot({ db, tg, token, roomState, appLink: env.APP_LINK || 'https://t.me/k22_yatzy_bot/play' }), tg, token, db };
  return bot;
}

// one entry point for the app's requests, Telegram's webhook and the timer
async function handler(event, context) {
  const env = process.env, origin = env.APP_ORIGIN || 'https://kitoglav22.github.io';
  const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
  const out = (statusCode, body) => ({ statusCode, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const b = setup();
  if (event && Array.isArray(event.messages)) { await b.tick(); return out(200, { ok: true }) }   // timer trigger
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  const q = event.queryStringParameters || {}, h = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  // one-time setup: open the function's link with ?setup=<HOOK_SECRET>
  if (q.setup && q.setup === env.HOOK_SECRET) {
    const self = env.SELF_URL || 'https://functions.yandexcloud.net/' + context.functionName;
    const hook = await b.tg('setWebhook', { url: self, secret_token: env.HOOK_SECRET, allowed_updates: ['message', 'inline_query'] });
    await b.tg('setMyCommands', { commands: [{ command: 'start', description: 'Открыть Яцзы' }] });
    // the same check for the database, so one look at this page tells what works
    let firebase = 'ok';
    try { await b.db.get('srv/ping') } catch (e) { firebase = String(e && e.message || e) }
    return out(200, { webhook: hook, url: self, firebase });
  }
  let body = {};
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}') } catch (e) { return out(400, { ok: false }) }
  if (h['x-telegram-bot-api-secret-token']) {
    if (h['x-telegram-bot-api-secret-token'] !== env.HOOK_SECRET) return out(403, { ok: false });
    await b.update(body); return out(200, { ok: true });
  }
  const user = checkInit(body.init, b.token, Date.now());
  if (!user) return out(403, { ok: false, why: 'Откройте игру из Telegram.' });
  const fn = b.api[body.op];
  if (!fn || (body.op !== 'rating' && !okCode(body.code)) || (body.pids && !(Array.isArray(body.pids) && body.pids.length <= 4 && body.pids.every(okId)))) return out(400, { ok: false });
  try { return out(200, await fn({ user, code: body.code, pids: body.pids, allow: body.allow === true })) } catch (e) { return out(500, { ok: false }) }
}

// tests put a bot with a fake database and Telegram in place
const use = x => { bot = x };
module.exports = { handler, makeBot, checkInit, elo, turnKey, turnOf, total, finished, use };
