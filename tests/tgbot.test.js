// The app talking to the bot: two Telegram devices in one online room, the bot server replaced by a recorder
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, settle } = require('./helpers');

const fakeTelegram = (id, startParam) => `
window.__tg = {};
window.Telegram = { WebApp: {
  platform: 'android', colorScheme: 'light', version: '8.0', isVersionAtLeast: () => true,
  initData: 'user=${id}&hash=x', initDataUnsafe: { user: { id: ${id}, first_name: 'T${id}' }, start_param: '${startParam}' },
  onEvent() {}, ready() { __tg.ready = true; }, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}, disableVerticalSwipes() {},
  HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
  BackButton: { show() {}, hide() {}, onClick() {} }, openTelegramLink(u) { __tg.link = u; },
  requestWriteAccess(cb) { __tg.asked = (__tg.asked || 0) + 1; cb(true); },
  switchInlineQuery(q, types) { __tg.inline = [q, types]; },
  isFullscreen: false, requestFullscreen() {}, checkHomeScreenStatus(cb) { cb('unsupported'); },
} };`;

let env, A, B;
const calls = [];
const w = ms => A.waitForTimeout(ms);
const device = (name, id, sp) => env.device(name, () => { localStorage.clear(); sessionStorage.clear(); }, {
  online: true, hash: '#tgWebAppData=x&tgWebAppPlatform=android&tgWebAppVersion=8.0',
  setup: async ctx => {
    await ctx.addInitScript(() => { window.__yatzyBot = 'https://bot.test/fn'; });
    await ctx.route('https://telegram.org/js/telegram-web-app.js', r => r.fulfill({ contentType: 'text/javascript', body: fakeTelegram(id, sp) }));
    await ctx.route('https://bot.test/fn', r => {
      const b = JSON.parse(r.request().postData()); calls.push({ from: name, ...b });
      const json = b.op === 'nudge' ? { ok: true, wait: 30 } : b.op === 'rating' ? { ok: true, list: [{ name: 'Лёха', r: 1016, g: 1, w: 1, me: name === 'B' }, { name: 'Женя', r: 984, g: 1, w: 0, me: name === 'A' }] } : { ok: true };
      r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(json) });
    });
  },
});
const ops = (who, op) => calls.filter(c => c.from === who && c.op === op);

before(async () => { env = await start(); });
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

test('an invitation from a chat creates its room for the first one to open it', async () => {
  A = await device('A', 1, 'new-qrstu');
  await A.waitForSelector('#nname');
  assert.match(await A.textContent('.sheet h3'), /Новая комната QRSTU/);
  await A.fill('#nname', 'Женя'); await A.click('#naddf button'); await A.click('#ngo'); await w(400);
  assert.equal(await A.evaluate(() => net && net.code), 'QRSTU');
  const h = ops('A', 'hello')[0];
  assert.equal(h.code, 'QRSTU'); assert.equal(h.allow, true); assert.equal(h.init, 'user=1&hash=x'); assert.equal(h.pids.length, 1);
  assert.equal(await A.evaluate(() => __tg.asked), 1, 'Telegram asked once if the bot may write');
});

test('the same invitation lets the friend join that room', async () => {
  B = await device('B', 2, 'NEW-QRSTU');
  await B.waitForSelector('#nname');
  assert.match(await B.textContent('.sheet h3'), /Вход в комнату QRSTU/);
  await B.fill('#nname', 'Лёха'); await B.click('#naddf button'); await B.click('#ngo'); await w(400);
  assert.equal(await B.evaluate(() => net && net.code), 'QRSTU');
  assert.equal(ops('B', 'hello')[0].code, 'QRSTU');
});

test('a new game and every move are reported to the bot', async () => {
  await B.evaluate(() => sheet.close()); await A.evaluate(() => sheet.close());
  await A.click('#nroom'); await A.click('#nstart'); await w(400);
  assert.equal(ops('A', 'moved').length, 1, 'the game started');
  const first = await A.evaluate(() => mine(whoseTurn())) ? A : B, other = first === A ? B : A;
  await first.click('#roll'); await settle(first); await first.click('button.sug'); await w(400);
  assert.equal(calls.filter(c => c.op === 'moved').length, 2);
  assert.equal(calls.filter(c => c.op === 'moved').at(-1).from, first === A ? 'A' : 'B');
  // the one who waits can nudge; the one on turn cannot
  assert.equal(await other.$('#nudge'), null);
  await first.click('#nudge'); await w(300);
  assert.equal(ops(first === A ? 'A' : 'B', 'nudge')[0].code, 'QRSTU');
  assert.match(await first.textContent('#toasts'), /Напомнил/);
});

test('the invite button sends the bot\'s card with the room code; the rating shows on the stats tab', async () => {
  await A.click('#nroom'); await A.click('#nshare');
  assert.deepEqual(await A.evaluate(() => __tg.inline), ['QRSTU', ['users', 'groups']]);
  await A.click('#cancel');
  await A.click('#tstats'); await w(200);
  assert.deepEqual(await A.$$eval('#tgrating li', x => x.map(e => e.className)), ['', 'me']);
  assert.match(await A.textContent('#tgrating'), /1\. Лёха1016/);
});

test('switching away tells the room this player is not in the app', async () => {
  const dev = await B.evaluate(() => DEV);
  await B.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await w(200);
  assert.equal(env.rooms.QRSTU.on[dev], false);
  await B.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await w(200);
  assert.equal(env.rooms.QRSTU.on[dev], true);
});
