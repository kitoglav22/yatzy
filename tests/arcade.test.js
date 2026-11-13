// The arcade alpha next to the notebook: the site links to it, and the page itself opens (its sources live in yatzy-arcade)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let env, p;
before(async () => { env = await start(); p = await env.device('phone', null, { viewport: { width: 390, height: 780 } }); });
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

test('during a game the arcade is a button on top, next to the players button; without a game it is not there', async () => {
  const a = p.locator('#arcade');
  assert.ok(await a.isHidden(), 'the first page offers the arcade itself');
  await p.evaluate(() => { game = newGameFor([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Миша' }]); render(); });
  assert.ok(await a.isVisible());
  assert.equal(await a.textContent(), 'Аркада');
  assert.equal(await a.getAttribute('href'), 'arcade.html');
  assert.ok(await p.locator('#players').isVisible());
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
  await p.evaluate(() => { game = null; render(); });
  assert.ok(await a.isHidden());
});

test('without a game the first page offers both games: the arcade and the notebook', async () => {
  assert.equal(await p.textContent('.choose h2'), 'Во что играем?');
  assert.equal(await p.getAttribute('#arc0', 'href'), 'arcade.html');
  for (const id of ['#arc0', '#start0', '#onl0']) assert.ok(await p.locator(id).isVisible(), id);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
});

test('the arcade page opens, can be played and leads back to the notebook', async () => {
  await p.click('#arc0');
  await p.waitForURL(/arcade\.html$/);
  assert.equal(await p.title(), 'Аркада Яцзы (альфа)');
  // since arcade 71.13 a new player's first run opens on the table, «Счёты» given, no card to read and no pick
  assert.ok(await p.locator('#overlay').isHidden());
  assert.equal(await p.locator('#amulets button').first().getAttribute('aria-label'), 'Счёты');
  await p.click('#roll');
  await p.locator('.die.blank').first().waitFor({ state: 'detached' });
  // since arcade 71.9 the version and the way back are at the end of «Справка», a button on top of the table
  await p.click('#help');
  await p.locator('#card summary').filter({ hasText: 'Настройки и забег' }).click();
  assert.ok(await p.locator('#seed').isVisible(), 'version and return link are in the settings section');
  assert.match(await p.textContent('#seed'), /v\d+\.\d+$/, 'the version notebook.arcade is shown');
  assert.equal(await p.locator('#tune').count(), 0, 'no balance panel for friends');
  await p.click('#home');
  await p.waitForURL(u => !u.pathname.endsWith('arcade.html'));
  assert.ok(await p.locator('#arc0').isVisible());
});

test('a link from the bot (startapp=arcade_<tag>) opens the arcade in Telegram with the tag, once per visit', async () => {
  const tg = '#tgWebAppData=x&tgWebAppPlatform=ios&tgWebAppVersion=8.0&tgWebAppStartParam=';
  const q = await env.device('tgarc', null, { viewport: { width: 390, height: 780 }, hash: tg + 'none',
    setup: async ctx => {
      await ctx.route('https://telegram.org/js/telegram-web-app.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
      // Telegram's channel: what the pages ask of it, kept through the move to the arcade
      await ctx.addInitScript(() => { window.TelegramWebviewProxy = { postEvent: t => sessionStorage.setItem('asked', (sessionStorage.getItem('asked') || '') + t + ' ') }; });
    } });
  await q.goto(env.url + tg + 'arcade_Dasha'); // only the address after # changes: the page has to load again
  await q.reload();
  // full screen is asked for, and the arcade waits for Telegram to switch, so it does not load during the switch
  assert.match(await q.evaluate(() => sessionStorage.getItem('asked')), /web_app_request_fullscreen/);
  await q.waitForTimeout(400);
  assert.ok(!q.url().includes('arcade.html'), 'still waiting for Telegram');
  await q.evaluate(() => Telegram.WebView.receiveEvent('fullscreen_changed', { is_fullscreen: true }));
  await q.waitForURL(/arcade\.html\?from=dasha#tgWebAppData=x.*&tgWebAppFullscreen=1$/, { timeout: 1000 });
  await q.waitForFunction(() => localStorage.getItem('arcade.from') === 'dasha');
  // the same link again in this visit (the way back from the arcade) stays in the notebook
  await q.goto(env.url + tg + 'arcade_Dasha');
  await q.waitForTimeout(300);
  assert.ok(!q.url().includes('arcade.html'));
  assert.ok(await q.locator('#arc0').isVisible());
  // a plain «arcade» marks the bot's own button; with no answer from Telegram the arcade opens anyway
  await q.evaluate(() => sessionStorage.clear());
  await q.goto(env.url + tg + 'arcade'); // only the address after # changes: the page has to load again
  q.reload().catch(() => {});
  await q.waitForURL(/arcade\.html\?from=tg#/);
});
