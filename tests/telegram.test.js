// The page opened as a Telegram Mini App, with Telegram's script replaced by a stand-in
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, twoPlayers } = require('./helpers');

const fakeTelegram = `
window.__tg = { haptics: 0 };
window.Telegram = { WebApp: {
  platform: 'ios', colorScheme: 'dark', version: '8.0', isVersionAtLeast: () => true,
  initDataUnsafe: { user: { first_name: 'Женя', last_name: 'Т' }, start_param: 'k7mpx' },
  _ev: {}, onEvent(n, f) { this._ev[n] = f; }, ready() { __tg.ready = true; }, expand() {},
  setHeaderColor(c) { __tg.header = c; }, setBackgroundColor() {}, setBottomBarColor() {}, disableVerticalSwipes() { __tg.noSwipes = true; },
  HapticFeedback: { impactOccurred() { __tg.haptics++; }, notificationOccurred() { __tg.haptics++; } },
  BackButton: { isVisible: false, show() { this.isVisible = true; }, hide() { this.isVisible = false; }, onClick(f) { this.click = f; } },
  openTelegramLink(u) { __tg.link = u; },
} };`;

let env, p;
before(async () => {
  env = await start();
  p = await env.device('tg', () => { localStorage.clear(); sessionStorage.clear(); }, {
    hash: '#tgWebAppData=x&tgWebAppPlatform=ios&tgWebAppVersion=8.0',
    setup: ctx => ctx.route('https://telegram.org/js/telegram-web-app.js', r => r.fulfill({ contentType: 'text/javascript', body: fakeTelegram })),
  });
  await p.waitForFunction(() => window.__tg && __tg.ready);
});
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

test('takes Telegram\'s theme and paints its header like the page', async () => {
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await p.evaluate(() => __tg.header), await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()));
  assert.ok(await p.evaluate(() => __tg.noSwipes));
});

test('an invitation link opens the room from the start parameter', async () => {
  assert.equal(await p.inputValue('#ncode'), 'K7MPX');
});

test('the back button closes a sheet, then leaves the statistics', async () => {
  const visible = () => p.evaluate(() => Telegram.WebApp.BackButton.isVisible);
  assert.ok(await visible());
  await p.evaluate(() => Telegram.WebApp.BackButton.click());
  assert.equal(await p.evaluate(() => $('sheet').innerHTML), '');
  assert.ok(!(await visible()));
  await p.click('#tstats'); assert.ok(await visible());
  await p.evaluate(() => Telegram.WebApp.BackButton.click());
  assert.ok(await p.evaluate(() => $('vstats').hidden)); assert.ok(!(await visible()));
});

test('the Telegram name is offered for a new player', async () => {
  await p.click('#start0');
  assert.equal(await p.inputValue('#newname'), 'Женя Т');
  await p.evaluate(() => sheet.close());
});

test('dice use Telegram haptics', async () => {
  await p.evaluate(twoPlayers);
  await p.evaluate(() => { roster = JSON.parse(localStorage.getItem('yatzy.roster')); game = newGameFor(roster); game.dice = true; game.roll = newRoll(); saveGame(); render(); });
  await p.click('#roll'); await p.waitForFunction(() => !rolling);
  assert.ok(await p.evaluate(() => __tg.haptics) >= 1);
});
