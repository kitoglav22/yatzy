// The bot server (server/index.js) with an in-memory database and a fake Telegram
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const S = require('../server/index.js');

const TOKEN = '123:abc';
function signed(user, at = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(at), query_id: 'q', user: JSON.stringify(user) });
  const data = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', key).update(data).digest('hex'));
  return p.toString();
}
function fakeDb() {
  const root = {};
  const walk = (p, make) => { let o = root; const ks = p.split('/'); for (const k of ks.slice(0, -1)) { if (o[k] == null) { if (!make) return [null]; o[k] = {} } o = o[k] } return [o, ks.at(-1)] };
  const copy = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  return {
    root,
    get: async p => { const [o, k] = walk(p); return o ? copy(o[k]) : null },
    put: async (p, v) => { const [o, k] = walk(p, true); o[k] = copy(v) },
    patch: async (p, v) => { const [o, k] = walk(p, true); o[k] = { ...(o[k] || {}), ...copy(v) } },
    del: async p => { const [o, k] = walk(p); if (o) delete o[k] },
    claim: async p => { const [o, k] = walk(p, true); if (o[k] != null) return false; o[k] = true; return true },
  };
}
const P = [{ id: 'a1', name: 'Женя', dev: 'd1' }, { id: 'b1', name: 'Лёха', dev: 'd2' }];
const full = v => Object.fromEntries(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'three', 'four', 'small', 'large', 'house', 'chance', 'yatzy'].map(c => [c, v]));
function setup() {
  let t = 1e12;
  const db = fakeDb(), sent = [], rooms = {};
  const tg = async (m, b) => { sent.push({ m, ...b }); return b.chat_id === 666 ? { ok: false, error_code: 403 } : { ok: true } };
  const bot = S.makeBot({ db, tg, now: () => t, token: TOKEN, appLink: 'https://t.me/k22_yatzy_bot/play', roomState: async c => rooms[c] || null });
  const room = (code, game) => { rooms[code] = { players: P, game }; };
  return { db, sent, rooms, bot, room, later: ms => { t += ms } };
}
const game = (scores, more = {}) => ({ players: P, scores, started: 7, log: [], ...more });

test('Telegram sign-in: a valid signature passes, a forged or stale one does not', () => {
  const u = { id: 42, first_name: 'Женя' };
  assert.equal(S.checkInit(signed(u), TOKEN, Date.now()).id, 42);
  assert.equal(S.checkInit(signed(u).replace('42', '43'), TOKEN, Date.now()), null);
  assert.equal(S.checkInit(signed(u), 'other', Date.now()), null);
  assert.equal(S.checkInit(signed(u, 1000), TOKEN, Date.now()), null);
  assert.equal(S.checkInit('', TOKEN, Date.now()), null);
});

test('rules on the server match the app: turn, totals with bonus, finished', () => {
  const g = game([{ u1: 3 }, {}]);
  assert.equal(S.turnOf(g), 1);
  assert.equal(S.total({ u4: 16, u5: 20, u6: 30, chance: 20, joker: 100 }), 236);
  assert.equal(S.finished(game([full(0), full(0)])), true);
  assert.equal(S.finished(game([{}, {}], { ended: true })), true);
});

test('"your turn" goes only to a player who is away, once per turn', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}], { log: [{ pid: 'a1', cid: 'u1' }] }));
  await x.bot.api.hello({ user: { id: 2, first_name: 'Лёха' }, code: 'ABCDE', pids: ['b1'] });
  await x.db.put('rooms/ABCDE/on/d2', true);
  await x.bot.api.moved({ code: 'ABCDE' });
  assert.equal(x.sent.length, 0, 'Лёха is in the app');
  await x.db.put('rooms/ABCDE/on/d2', false);
  await x.bot.tick();
  assert.equal(x.sent.length, 0, 'not before five minutes');
  x.later(6 * 60e3); await x.bot.tick();
  assert.equal(x.sent.length, 1);
  assert.equal(x.sent[0].chat_id, 2);
  assert.match(x.sent[0].text, /Твой ход.*Женя: Единицы 3.*Женя 3 : Лёха 0/);
  assert.match(x.sent[0].reply_markup.inline_keyboard[0][0].url, /startapp=ABCDE$/);
  await x.bot.api.moved({ code: 'ABCDE' }); await x.bot.tick();
  assert.equal(x.sent.length, 1, 'no repeat for the same turn');
});

test('reminders: once a day, three at most, and they stop when the turn is taken', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]));
  await x.bot.api.hello({ user: { id: 2 }, code: 'ABCDE', pids: ['b1'] });
  await x.bot.api.moved({ code: 'ABCDE' });
  assert.equal(x.sent.length, 1);
  x.later(12 * 3600e3); await x.bot.tick();
  assert.equal(x.sent.length, 1, 'not after half a day');
  for (let d = 0; d < 5; d++) { x.later(24 * 3600e3); await x.bot.tick() }
  assert.equal(x.sent.length, 4, 'one "your turn" and three reminders');
  assert.match(x.sent[1].text, /ждёт твой ход уже 36 ч/);
  x.rooms.ABCDE.game.scores[1].u1 = 2; await x.bot.tick();
  assert.equal(x.sent.length, 4, 'Женя plays without Telegram: nothing to send');
  assert.equal((await x.db.get('srv/turn/ABCDE')).pid, 'a1', 'the turn record moved on');
});

test('a nudge reaches the player on turn, then waits half an hour', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]));
  await x.bot.api.hello({ user: { id: 1 }, code: 'ABCDE', pids: ['a1'] });
  await x.bot.api.hello({ user: { id: 2 }, code: 'ABCDE', pids: ['b1'] });
  let r = await x.bot.api.nudge({ user: { id: 1 }, code: 'ABCDE' });
  assert.ok(r.ok); assert.match(x.sent.at(-1).text, /Женя ждёт твой ход/); assert.equal(x.sent.at(-1).chat_id, 2);
  r = await x.bot.api.nudge({ user: { id: 1 }, code: 'ABCDE' });
  assert.equal(r.ok, false); assert.equal(r.wait, 30);
  x.later(31 * 60e3);
  assert.ok((await x.bot.api.nudge({ user: { id: 1 }, code: 'ABCDE' })).ok);
  assert.match((await x.bot.api.nudge({ user: { id: 2 }, code: 'ABCDE' })).why, /ваш ход/);
  assert.match((await x.bot.api.nudge({ user: { id: 9 }, code: 'ABCDE' })).why, /не играете/);
});

test('a seat belongs to the first Telegram account that claims it', async () => {
  const x = setup();
  x.room('ABCDE', game([{}, {}]));
  await x.bot.api.hello({ user: { id: 2 }, code: 'ABCDE', pids: ['b1'] });
  await x.bot.api.hello({ user: { id: 9 }, code: 'ABCDE', pids: ['b1', 'a1'] });
  assert.deepEqual(await x.db.get('srv/seats/ABCDE'), { b1: 2, a1: 9 });
});

test('a blocked bot marks the user and stops writing until they allow it again', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]));
  await x.bot.api.hello({ user: { id: 666 }, code: 'ABCDE', pids: ['b1'] });
  await x.bot.api.moved({ code: 'ABCDE' });
  assert.equal((await x.db.get('srv/users/666')).off, true);
  x.rooms.ABCDE.game.scores = [{ u1: 3, u2: 2 }, { u1: 1 }];
  await x.bot.api.moved({ code: 'ABCDE' });
  assert.equal(x.sent.length, 1, 'skipped');
  await x.bot.api.hello({ user: { id: 666 }, code: 'ABCDE', pids: ['b1'], allow: true });
  assert.equal((await x.db.get('srv/users/666')).off, false);
});

test('a finished game moves the rating once and tells the players who are away', async () => {
  const x = setup();
  x.room('ABCDE', game([full(5), full(1)]));
  await x.bot.api.hello({ user: { id: 1 }, code: 'ABCDE', pids: ['a1'] });
  await x.bot.api.hello({ user: { id: 2 }, code: 'ABCDE', pids: ['b1'] });
  await x.db.put('rooms/ABCDE/on/d1', true);
  assert.equal((await x.bot.api.moved({ code: 'ABCDE' })).rated, true);
  assert.equal((await x.bot.api.moved({ code: 'ABCDE' })).rated, false, 'counted once');
  assert.deepEqual(await x.db.get('srv/elo/1'), { name: 'Женя', r: 1016, g: 1, w: 1 });
  assert.deepEqual(await x.db.get('srv/elo/2'), { name: 'Лёха', r: 984, g: 1, w: 0 });
  assert.deepEqual(x.sent.map(m => m.chat_id), [2], 'only Лёха was away');
  assert.match(x.sent[0].text, /Партия окончена.*\n.*Женя \+16, Лёха -16/s);
  const list = (await x.bot.api.rating({ user: { id: 2 } })).list;
  assert.deepEqual(list.map(e => [e.name, e.r, e.me]), [['Женя', 1016, false], ['Лёха', 984, true]]);
  // a game finished early or with one Telegram player is not rated
  x.room('FGHJK', game([full(5), full(1)], { started: 8, ended: true }));
  await x.bot.api.hello({ user: { id: 1 }, code: 'FGHJK', pids: ['a1'] });
  await x.bot.api.hello({ user: { id: 2 }, code: 'FGHJK', pids: ['b1'] });
  assert.equal((await x.bot.api.moved({ code: 'FGHJK' })).rated, false);
});

test('Elo: an upset pays more, three players share the stake', () => {
  assert.deepEqual(S.elo([1000, 1000], [200, 100]), [16, -16]);
  const [weak] = S.elo([900, 1100], [200, 100]);
  assert.ok(weak > 16);
  assert.deepEqual(S.elo([1000, 1000, 1000], [300, 200, 100]), [16, 0, -16]);
});

test('inline invitations: a new game anywhere, or a call into a known room', async () => {
  const x = setup();
  await x.bot.update({ inline_query: { id: 'iq', query: '' } });
  let r = x.sent.at(-1);
  assert.equal(r.m, 'answerInlineQuery'); assert.equal(r.results.length, 1);
  assert.match(r.results[0].reply_markup.inline_keyboard[0][0].url, /startapp=NEW-[A-HJ-NP-Z2-9]{5}$/);
  await x.bot.update({ inline_query: { id: 'iq', query: 'abcde' } });
  r = x.sent.at(-1);
  assert.equal(r.results.length, 2);
  assert.match(r.results[0].reply_markup.inline_keyboard[0][0].url, /startapp=ABCDE$/);
  await x.bot.update({ message: { from: { id: 5, first_name: 'Аня' }, text: '/start' } });
  assert.match(x.sent.at(-1).text, /напишу сюда/);
  assert.equal((await x.db.get('srv/users/5')).off, false);
});

test('the function: CORS, Telegram sign-in required, webhook secret checked', async () => {
  const x = setup();
  process.env.HOOK_SECRET = 'hook';
  S.use({ ...x.bot, token: TOKEN, tg: async () => ({ ok: true }) });
  const call = (body, headers = {}) => S.handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) }, { functionName: 'f1' });
  assert.equal((await S.handler({ httpMethod: 'OPTIONS', headers: {} }, {})).statusCode, 204);
  assert.equal((await call({ op: 'rating', init: 'x' })).statusCode, 403);
  const ok = await call({ op: 'rating', init: signed({ id: 1 }) });
  assert.equal(ok.statusCode, 200); assert.equal(ok.headers['Access-Control-Allow-Origin'], 'https://kitoglav22.github.io');
  assert.equal((await call({ op: 'moved', code: '<bad>', init: signed({ id: 1 }) })).statusCode, 400);
  assert.equal((await call({ op: 'nope', code: 'ABCDE', init: signed({ id: 1 }) })).statusCode, 400);
  assert.equal((await call({}, { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' })).statusCode, 403);
  assert.equal((await call({ inline_query: { id: 'q', query: '' } }, { 'X-Telegram-Bot-Api-Secret-Token': 'hook' })).statusCode, 200);
  assert.equal(x.sent.at(-1).m, 'answerInlineQuery');
  assert.equal((await S.handler({ messages: [{}] }, {})).statusCode, 200, 'timer');
  S.use({ ...x.bot, token: TOKEN, db: x.db, tg: async (m, b) => (x.sent.push({ m, ...b }), { ok: true }) });
  const set = JSON.parse((await S.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { setup: 'hook' } }, { functionName: 'f1' })).body);
  assert.deepEqual([set.webhook, set.url, set.firebase], [{ ok: true }, 'https://functions.yandexcloud.net/f1', 'ok']);
  assert.equal(x.sent.find(m => m.m === 'setWebhook').secret_token, 'hook');
  assert.equal((await S.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { setup: 'nope' } }, {})).statusCode, 403, 'a wrong secret does nothing');
});
