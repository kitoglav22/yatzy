// The page opened as a Telegram Mini App, with Telegram's script replaced by a stand-in
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

const fakeTelegram = `
window.__tg = { haptics: 0 };
window.Telegram = { WebApp: {
  platform: 'ios', colorScheme: 'dark', version: '8.0', isVersionAtLeast: () => true,
  initDataUnsafe: { user: { first_name: 'Вова', last_name: 'Т' }, start_param: 'k7mpx' },
  _ev: {}, onEvent(n, f) { this._ev[n] = f; }, ready() { __tg.ready = true; }, expand() {},
  setHeaderColor(c) { __tg.header = c; }, setBackgroundColor() {}, setBottomBarColor() {}, disableVerticalSwipes() { __tg.noSwipes = true; },
  HapticFeedback: { impactOccurred() { __tg.haptics++; }, notificationOccurred() { __tg.haptics++; } },
  BackButton: { isVisible: false, show() { this.isVisible = true; }, hide() { this.isVisible = false; }, onClick(f) { this.click = f; } },
  openTelegramLink(u) { __tg.link = u; },
  isFullscreen: false, safeAreaInset: { top: 47, bottom: 34 }, contentSafeAreaInset: { top: 46, bottom: 0 },
  requestFullscreen() { this.isFullscreen = true; (this._ev.fullscreenChanged || (() => {}))(); },
  checkHomeScreenStatus(cb) { cb('missed'); }, addToHomeScreen() { __tg.home = true; },
  CloudStorage: {
    data: { g1000: JSON.stringify({ at: 1000, players: [{ name: 'Облако', total: 200, scores: { u1: 3 } }, { name: 'Миша', total: 150, scores: {} }], winner: 'Облако' }),
      g2000: '{"broken"', d3000: '1', g3000: JSON.stringify({ at: 3000, players: [{ name: 'Удалённая', total: 1 }] }),
      roster: JSON.stringify([{ id: 'cl', name: 'Облако' }]) },
    getKeys(cb) { setTimeout(() => cb(null, Object.keys(this.data))); },
    getItem(k, cb) { setTimeout(() => cb(null, this.data[k] ?? '')); },
    getItems(ks, cb) { setTimeout(() => cb(null, Object.fromEntries(ks.map(k => [k, this.data[k] ?? ''])))); },
    setItem(k, v, cb) { this.data[k] = v; setTimeout(() => cb && cb(null, true)); },
    removeItem(k, cb) { delete this.data[k]; setTimeout(() => cb && cb(null, true)); },
    removeItems(ks, cb) { ks.forEach(k => delete this.data[k]); setTimeout(() => cb && cb(null, true)); },
  },
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
  assert.equal(await p.inputValue('#newname'), 'Вова Т');
  await p.evaluate(() => sheet.close());
});

test('dice use Telegram haptics', async () => {
  await p.evaluate(() => { game = newGameFor([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Миша' }]); game.dice = true; game.roll = newRoll(); saveGame(); render(); });
  await p.click('#roll'); await p.waitForFunction(() => !rolling);
  assert.ok(await p.evaluate(() => __tg.haptics) >= 1);
});

test('an invitation is shared as a link to the bot that opens the room', async () => {
  await p.evaluate(() => shareRoom('K7MPX'));
  const link = new URL(await p.evaluate(() => __tg.link));
  assert.equal(link.origin + link.pathname, 'https://t.me/share/url');
  assert.equal(link.searchParams.get('url'), 'https://t.me/k22_yatzy_bot/play?startapp=K7MPX');
});

test('opens full screen and keeps the page clear of Telegram\'s buttons', async () => {
  assert.ok(await p.evaluate(() => document.documentElement.classList.contains('tgfull')));
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.wrap')).paddingTop), '113px');
  assert.equal(await p.evaluate(() => getComputedStyle($('dice')).top), '93px', 'the dice stick below Telegram\'s buttons');
  assert.equal(await p.evaluate(() => getComputedStyle(document.body, '::before').height), '93px');
  assert.ok(await p.evaluate(() => { const c = getComputedStyle($('dice')); return c.backgroundImage.includes('linear-gradient') && c.backgroundSize === '100% 50%' && c.boxShadow.includes('-12px'); }), 'nothing shows through the panel corners');
});

test('history and players come from the Telegram cloud, damaged and deleted games are skipped', async () => {
  await p.waitForFunction(() => /в облаке Telegram/.test(tgCloudInfo));
  const h = await p.evaluate(() => history.map(g => g.at));
  assert.ok(h.includes(1000)); assert.ok(!h.includes(3000));
  assert.ok(await p.evaluate(() => roster.some(r => r.name === 'Облако')));
});

test('a finished game goes up to the cloud, a deleted one leaves a marker', async () => {
  const at = await p.evaluate(() => {
    game = newGameFor([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Миша' }]); game.dice = false;
    ALL.forEach(c => { game.scores[0][c.id] = c.vals[1]; game.scores[1][c.id] = c.vals[0]; });
    changed(); return game.savedAt;
  });
  await p.waitForFunction(at => !!Telegram.WebApp.CloudStorage.data['g' + at], at);
  await p.evaluate(at => deleteGame(at), at);
  await p.waitForFunction(at => !Telegram.WebApp.CloudStorage.data['g' + at] && Telegram.WebApp.CloudStorage.data['d' + at], at);
});

test('with every game in the Telegram cloud there is no backup reminder', async () => {
  await p.evaluate(() => {
    localStorage.removeItem('yatzy.backupAt');
    for (let k = 0; k < 5; k++) { game = newGameFor([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Миша' }]); ALL.forEach(c => { game.scores[0][c.id] = c.vals[1]; game.scores[1][c.id] = c.vals[0]; }); game.started += k; archive(); }
    render();
  });
  assert.equal(await p.textContent('#remind'), '');
  // a game the cloud refused brings it back
  await p.evaluate(() => { const cs = Telegram.WebApp.CloudStorage; cs.ok = cs.setItem; cs.setItem = (k, v, cb) => setTimeout(() => cb('STORAGE_KEY_LIMIT')); store.addGame({ at: 9, players: [] }); });
  await p.waitForFunction(() => /Сохраните копию/.test($('remind').textContent));
  await p.evaluate(() => { const cs = Telegram.WebApp.CloudStorage; cs.setItem = cs.ok; cloudKeeps = true; render(); });
});

test('the result of a game is shared to a chat with a link to the bot', async () => {
  await p.click('#shareres');
  const link = new URL(await p.evaluate(() => __tg.link));
  assert.equal(link.searchParams.get('url'), 'https://t.me/k22_yatzy_bot/play');
  assert.match(link.searchParams.get('text'), /^Яцзы, победа: .+, \d+ : \d+\..* Сыграем\?$/);
});

test('an icon on the home screen can be added from the statistics tab', async () => {
  await p.click('#tstats');
  await p.click('#tgadd');
  assert.ok(await p.evaluate(() => __tg.home));
  await p.click('#tgame');
});
