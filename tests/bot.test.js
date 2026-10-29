// The bot (server/worker.js) with an in-memory database and a fake Telegram: the app's requests wait in req/,
// every run of the worker handles them and the turns that wait for a message
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// the worker is one ES module with only a default export; the tests also reach its inner functions
let W;
before(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'worker.js'), 'utf8');
  W = await import('data:text/javascript,' + encodeURIComponent(src + '\nexport { makeBot, checkInit, elo, total, finished, turnOf, tgHash };'));
});

const TOKEN = '123:abc';
function signed(user, at = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(at), query_id: 'q', user: JSON.stringify(user) });
  const data = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', key).update(data).digest('hex'));
  return p.toString();
}
function fakeDb() {
  const root = {}, reads = [];
  const copy = v => v == null ? null : JSON.parse(JSON.stringify(v));
  const at = p => p.split('/').filter(Boolean).reduce((o, k) => o == null ? null : o[k], root) ?? null;
  const set = (p, v) => {
    const ks = p.split('/'); let o = root;
    for (const k of ks.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
    if (v == null) delete o[ks.at(-1)]; else o[ks.at(-1)] = copy(v);
  };
  const db = { root, reads, set, at, fail: 0,
    get: async p => { reads.push(p); return copy(at(p) ?? null) },
    keys: async p => { reads.push(p + '?shallow'); const v = at(p); return v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).map(k => [k, true])) : null },
    update: async m => { if (db.fail) { db.fail--; throw new Error('Firebase PATCH /: 400') } for (const [p, v] of Object.entries(m)) set(p, v) } };
  return db;
}
const P = [{ id: 'a1', name: 'Женя', dev: 'd1' }, { id: 'b1', name: 'Лёха', dev: 'd2' }];
const full = v => Object.fromEntries(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'three', 'four', 'small', 'large', 'house', 'chance', 'yatzy'].map(c => [c, v]));
const game = (scores, more = {}) => ({ players: P, scores, started: 7, log: [], ...more });
function setup() {
  let t = 1e12, n = 0;
  const db = fakeDb(), sent = [];
  const tg = async (m, b) => { sent.push({ m, ...b }); return b.chat_id === 666 ? { ok: false, error_code: 403 } : { ok: true } };
  const bot = W.makeBot({ db, tg, now: () => t, token: TOKEN });
  const ask = (op, more) => db.set('req/r' + String(++n).padStart(4, '0'), JSON.stringify({ op, ...more }));
  return {
    db, sent, bot, tick: () => bot.tick(), later: ms => { t += ms },
    room: (code, g, on = {}) => db.set('rooms/' + code, { state: JSON.stringify({ players: P, game: g, t }), on }),
    now: () => t,
    change(code, fn) { const r = db.root.rooms[code], s = JSON.parse(r.state); fn(s.game); r.state = JSON.stringify(s) },
    on: (code, dev, v) => db.set(`rooms/${code}/on/${dev}`, v),
    hello: (id, code, pids, allow) => ask('hello', { code, pids, allow, init: signed({ id, first_name: 'T' + id }) }),
    nudge: (id, code) => ask('nudge', { code, init: signed({ id }) }),
    moved: code => ask('moved', { code }),
  };
}

test('Telegram sign-in: a valid signature passes, a forged or stale one does not', async () => {
  const u = { id: 42, first_name: 'Женя' };
  assert.equal((await W.checkInit(signed(u), TOKEN, Date.now())).id, 42);
  assert.equal(await W.checkInit(signed(u).replace('42', '43'), TOKEN, Date.now()), null);
  assert.equal(await W.checkInit(signed(u), 'other', Date.now()), null);
  assert.equal(await W.checkInit(signed(u, 1000), TOKEN, Date.now()), null);
  assert.equal(await W.checkInit('', TOKEN, Date.now()), null);
});

test('rules on the server match the app: turn, totals with bonus, finished', () => {
  const g = game([{ u1: 3 }, {}]);
  assert.equal(W.turnOf(g), 1);
  assert.equal(W.total({ u4: 16, u5: 20, u6: 30, chance: 20, joker: 100 }), 236);
  assert.equal(W.finished(game([full(0), full(0)])), true);
  assert.equal(W.finished(game([{}, {}], { ended: true })), true);
});

test('"your turn" goes only to a player who left the app, once per turn; quiet runs read almost nothing', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}], { log: [{ pid: 'a1', cid: 'u1' }] }), { d2: true });
  x.hello(2, 'ABCDE', ['b1']); x.moved('ABCDE'); await x.tick();
  assert.equal(x.sent.length, 0, 'Лёха is in the app');
  assert.equal(x.db.root.req && Object.keys(x.db.root.req).length, 0, 'the requests are gone');
  x.on('ABCDE', 'd2', false); await x.tick();
  assert.equal(x.sent.length, 0, 'not before five minutes');
  x.later(6 * 60e3); await x.tick();
  assert.equal(x.sent.length, 1);
  assert.equal(x.sent[0].chat_id, 2);
  assert.match(x.sent[0].text, /Твой ход.*Женя: Единицы 3.*Женя 3 : Лёха 0/);
  assert.match(x.sent[0].reply_markup.inline_keyboard[0][0].url, /^https:\/\/t\.me\/k22_yatzy_bot\/play\?startapp=ABCDE$/);
  x.moved('ABCDE'); await x.tick();
  assert.equal(x.sent.length, 1, 'no repeat for the same turn');
  x.db.reads.length = 0; x.later(60e3); await x.tick();
  assert.deepEqual(x.db.reads.sort(), ['req', 'srv'], 'nothing is due: the rooms are not read');
});

test('a player away when the turn comes hears at once; reminders once a day, three at most', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]));
  x.hello(2, 'ABCDE', ['b1']); await x.tick();
  assert.equal(x.sent.length, 1);
  x.later(12 * 3600e3); await x.tick();
  assert.equal(x.sent.length, 1, 'not after half a day');
  for (let d = 0; d < 5; d++) { x.later(24 * 3600e3); await x.tick() }
  assert.equal(x.sent.length, 4, 'one "your turn" and three reminders');
  assert.match(x.sent[1].text, /ждёт твой ход уже 36 ч/);
  x.change('ABCDE', g => { g.scores[1].u1 = 2 }); x.moved('ABCDE'); await x.tick();
  assert.equal(x.sent.length, 4, 'Женя plays without Telegram: nothing to send');
  assert.equal(x.db.at('srv/turn/ABCDE').pid, 'a1', 'the turn record moved on');
});

test('a reminder is not sent for a game that ended without a word to the bot', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]));
  x.hello(2, 'ABCDE', ['b1']); await x.tick();
  x.change('ABCDE', g => { g.ended = true });
  x.later(25 * 3600e3); await x.tick();
  assert.equal(x.sent.length, 1);
  assert.equal(x.db.at('srv/turn/ABCDE'), null);
});

test('a nudge reaches the player on turn, then waits an hour; the app sees who can be nudged', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]), { d2: true });
  x.hello(1, 'ABCDE', ['a1']); x.hello(2, 'ABCDE', ['b1']); await x.tick();
  assert.deepEqual(x.db.at('pub/tg/ABCDE'), { a1: 1, b1: 1 });
  x.nudge(1, 'ABCDE'); await x.tick();
  assert.equal(x.sent.length, 1); assert.match(x.sent[0].text, /Женя ждёт твой ход/); assert.equal(x.sent[0].chat_id, 2);
  x.nudge(1, 'ABCDE'); await x.tick();
  assert.equal(x.sent.length, 1, 'too soon');
  x.later(61 * 60e3); x.nudge(1, 'ABCDE'); await x.tick();
  assert.equal(x.sent.length, 2);
  x.later(61 * 60e3); x.nudge(2, 'ABCDE'); x.nudge(9, 'ABCDE'); x.db.set('req/zz', JSON.stringify({ op: 'nudge', code: 'ABCDE', init: signed({ id: 1 }).replace('hash=', 'hash=0') }));
  await x.tick();
  assert.equal(x.sent.length, 2, 'not to oneself, not from a stranger, not with a forged sign-in');
});

test('a seat belongs to the first Telegram account that claims it', async () => {
  const x = setup();
  x.room('ABCDE', game([{}, {}]), { d1: true, d2: true });
  x.hello(2, 'ABCDE', ['b1']); await x.tick();
  x.hello(9, 'ABCDE', ['b1', 'a1']); x.hello(5, 'ABCDE', ['zz']); x.hello(5, 'QQQQQ', ['a1']); await x.tick();
  assert.deepEqual(x.db.at('srv/seats/ABCDE'), { b1: 2, a1: 9 });
  assert.equal(x.db.at('srv/seats/QQQQQ'), null);
});

test('a blocked bot marks the user and stops writing until they allow it again', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]));
  x.hello(666, 'ABCDE', ['b1']); await x.tick();
  assert.equal(x.db.at('srv/users/666').off, true);
  assert.deepEqual(x.db.at('pub/tg/ABCDE'), { b1: 0 }, 'the app learns the bot cannot write to him');
  x.change('ABCDE', g => { g.scores = [{ u1: 3, u2: 2 }, { u1: 1 }] }); x.moved('ABCDE'); await x.tick();
  assert.equal(x.sent.length, 1, 'skipped');
  x.hello(666, 'ABCDE', ['b1'], true); await x.tick();
  assert.equal(x.db.at('srv/users/666').off, false);
  assert.deepEqual(x.db.at('pub/tg/ABCDE'), { b1: 1 });
});

test('a finished game moves the rating once and tells the players who are away', async () => {
  const x = setup();
  x.room('ABCDE', game([full(5), full(1)]), { d1: true });
  x.hello(1, 'ABCDE', ['a1']); x.hello(2, 'ABCDE', ['b1']); await x.tick();
  assert.deepEqual(x.db.at('srv/elo/1'), { name: 'Женя', r: 1016, g: 1, w: 1 });
  assert.deepEqual(x.db.at('srv/elo/2'), { name: 'Лёха', r: 984, g: 1, w: 0 });
  assert.deepEqual(x.sent.map(m => m.chat_id), [2], 'only Лёха was away');
  assert.match(x.sent[0].text, /Партия окончена.*\n.*Женя \+16, Лёха -16/s);
  assert.deepEqual(x.db.at('pub/rating'), [{ name: 'Женя', r: 1016, g: 1, w: 1, h: await W.tgHash(1) }, { name: 'Лёха', r: 984, g: 1, w: 0, h: await W.tgHash(2) }]);
  assert.match(await W.tgHash(1), /^[0-9a-f]{12}$/);
  x.moved('ABCDE'); await x.tick();
  assert.equal(x.db.at('srv/elo/1').g, 1, 'counted once');
  // a game finished early or with one Telegram player is not rated
  x.room('FGHJK', game([full(5), full(1)], { started: 8, ended: true }));
  x.hello(1, 'FGHJK', ['a1']); x.hello(2, 'FGHJK', ['b1']); await x.tick();
  x.room('KLMNP', game([full(5), full(1)], { started: 9 }));
  x.hello(1, 'KLMNP', ['a1']); await x.tick();
  assert.equal(x.db.at('srv/elo/1').g, 1);
});

test('rooms that are deleted or idle for a month are forgotten; unknown rooms are not read', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]), { d2: true }); x.room('FGHJK', game([{ u1: 3 }, {}]), { d2: true });
  x.hello(2, 'ABCDE', ['b1']); x.hello(2, 'FGHJK', ['b1']); await x.tick();
  delete x.db.root.rooms.ABCDE; x.moved('ABCDE'); await x.tick();
  assert.equal(x.db.at('srv/seats/ABCDE'), null); assert.equal(x.db.at('pub/tg/ABCDE'), null);
  x.later(31 * 24 * 3600e3); x.db.reads.length = 0; x.moved('ZZZZZ'); await x.tick();
  assert.equal(x.db.at('srv/seats/FGHJK'), null); assert.equal(x.db.at('srv/turn/FGHJK'), null);
  assert.ok(!x.db.reads.includes('rooms/ZZZZZ'));
});

test('Elo: an upset pays more, three players share the stake', () => {
  assert.deepEqual(W.elo([1000, 1000], [200, 100]), [16, -16]);
  const [weak] = W.elo([900, 1100], [200, 100]);
  assert.ok(weak > 16);
  assert.deepEqual(W.elo([1000, 1000, 1000], [300, 200, 100]), [16, 0, -16]);
});

test('inline invitations: a new game anywhere, or a call into a known room; /start says hello', async () => {
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
  assert.match(x.sent.at(-1).text, /напишу сюда.*@k22_yatzy_bot/s);
  assert.equal(x.db.at('srv/users/5').off, false);
});

test('the worker: webhook secret, the setup link with a service account sign-in, the cron run', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const env = { BOT_TOKEN: TOKEN, HOOK_SECRET: 'hook', FB_SA: JSON.stringify({ client_email: 'bot@x.iam.gserviceaccount.com', private_key: privateKey }) };
  const calls = [], real = globalThis.fetch, json = v => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), body = opt.body;
    calls.push({ url: u.origin + u.pathname, method: opt.method || 'GET', body });
    if (u.host === 'api.telegram.org') return json(u.pathname.endsWith('/getMe') ? { ok: true, result: { username: 'k22_yatzy_bot', supports_inline_queries: true } } : { ok: true });
    if (u.host === 'oauth2.googleapis.com') {
      const jwt = new URLSearchParams(body).get('assertion').split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), publicKey, Buffer.from(jwt[2], 'base64url'));
      return json(ok && JSON.parse(Buffer.from(jwt[1], 'base64url')).iss === 'bot@x.iam.gserviceaccount.com' ? { access_token: 'AT', expires_in: 3600 } : { error: 'invalid_grant' });
    }
    assert.equal(u.searchParams.get('access_token'), 'AT');
    return json(null);
  };
  try {
    const W2 = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '..', 'server', 'worker.js'), 'utf8') + '\n// copy'));
    const w = W2.default, jobs = [], ctx = { waitUntil: p => jobs.push(p) };
    const post = h => w.fetch(new Request('https://yatzy.x.workers.dev/', { method: 'POST', headers: h, body: JSON.stringify({ inline_query: { id: 'q', query: '' } }) }), env, ctx);
    assert.equal((await post({ 'x-telegram-bot-api-secret-token': 'wrong' })).status, 403);
    assert.equal((await post({ 'x-telegram-bot-api-secret-token': 'hook' })).status, 200);
    await Promise.all(jobs);
    assert.ok(calls.some(c => c.url.endsWith('/answerInlineQuery')));
    assert.equal((await w.fetch(new Request('https://yatzy.x.workers.dev/?setup=nope'), env, ctx)).status, 403, 'a wrong secret does nothing');
    const rep = await (await w.fetch(new Request('https://yatzy.x.workers.dev/?setup=hook'), env, ctx)).json();
    assert.deepEqual(rep, { ok: true, telegram: '@k22_yatzy_bot', webhook: 'подключён: https://yatzy.x.workers.dev/', firebase: 'ok', tick: 'ok, изменений: 1', queue: 'пусто', requests: 'с подписью Telegram: 0, с неверной подписью: 0', known: 'игроков: 0, комнат: 0' });
    const hook = JSON.parse(calls.find(c => c.url.endsWith('/setWebhook')).body);
    assert.deepEqual([hook.url, hook.secret_token], ['https://yatzy.x.workers.dev/', 'hook']);
    assert.deepEqual(JSON.parse(calls.find(c => c.method === 'PATCH').body), { 'pub/bot': true });
    assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1, 'the sign-in is kept between calls');
    jobs.length = 0; const n = calls.length; await w.scheduled({}, env, ctx); await Promise.all(jobs);
    assert.ok(calls.slice(n).some(c => c.url.endsWith('/req.json')), 'the cron run reads the requests');
    const bad = await (await w.fetch(new Request('https://yatzy.x.workers.dev/?setup=hook'), { ...env, FB_SA: 'oops' }, ctx)).json();
    assert.match(bad.error, /FB_SA/);
  } finally { globalThis.fetch = real }
});

test('a broken room is skipped: the other rooms still get their messages', async () => {
  for (const bad of [{ players: P, game: { players: 'x' } }, { players: P, game: game([{ u1: 3, u2: 2 }, {}], { started: 1.5 }) }, { players: [null], game: null }]) {
    const x = setup();
    x.room('ABCDE', game([{ u1: 3 }, {}])); x.room('FGHJK', game([{ u1: 3 }, {}]), { d2: true });
    x.hello(2, 'ABCDE', ['b1']); x.hello(3, 'FGHJK', ['b1']); await x.tick();
    x.db.set('rooms/FGHJK/state', JSON.stringify(bad));
    x.change('ABCDE', g => { g.scores[0].u2 = 2; g.scores[1].u1 = 1 });
    x.moved('FGHJK'); x.moved('ABCDE');
    await x.tick();
    assert.deepEqual(x.sent.map(m => m.chat_id), [2, 2], 'Лёха got both "your turn" in the good room');
    assert.equal(x.db.at('srv/seats/FGHJK'), null, 'the broken room is forgotten');
  }
});

test('a failed write sends nothing, so nothing is sent twice', async () => {
  const x = setup();
  x.room('ABCDE', game([{ u1: 3 }, {}]));
  x.hello(2, 'ABCDE', ['b1']); x.db.fail = 1;
  await assert.rejects(x.tick());
  assert.equal(x.sent.length, 0);
  await x.tick();
  assert.equal(x.sent.length, 1, 'the request was still there');
  await x.tick();
  assert.equal(x.sent.length, 1);
});

test('rooms nobody touched for two months are removed, a few at a time in quiet minutes', async () => {
  const x = setup();
  x.room('AAAAA', game([{}, {}])); x.room('BBBBB', null);
  x.later(61 * 24 * 3600e3);
  x.room('CCCCC', game([{}, {}]));
  x.db.set('rooms/DDDDD', { state: 'not json' });
  await x.tick();
  assert.deepEqual(Object.keys(x.db.root.rooms), ['CCCCC']);
  assert.deepEqual(x.db.at('srv/clean'), { at: x.now(), after: '' });
  x.db.reads.length = 0; x.later(60e3); await x.tick();
  assert.ok(!x.db.reads.includes('rooms?shallow'), 'the next pass waits a day');
});

test('a refused sign-in is noted without its values; push ids tell how old a request is', async () => {
  const x = setup();
  x.room('ABCDE', game([{}, {}]));
  x.db.set('req/zz', JSON.stringify({ op: 'hello', code: 'ABCDE', pids: ['a1'], init: 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=00' }));
  const t = await x.tick();
  assert.equal(t.bad, 1); assert.equal(t.signed, 0);
  assert.deepEqual(x.db.at('srv/diag'), { at: x.now(), op: 'hello', fields: 'auth_date, hash, user', len: 43 });
  assert.equal(t.diag.fields, 'auth_date, hash, user');
  // -Nabc… ids are made by Firebase from the time
  const id = (ms => { let s = ''; for (let i = 0; i < 8; i++) { s = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'[ms % 64] + s; ms = Math.floor(ms / 64) } return s })(1761750000000) + 'abcdefghijkl';
  x.db.set('req/' + id, JSON.stringify({ op: 'moved', code: 'ABCDE' }));
  assert.equal((await x.tick()).oldest, 1761750000000);
});
