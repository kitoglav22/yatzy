// The page opened in Telegram on a network that does not reach telegram.org: Telegram's script never loads,
// and the page asks Telegram for full screen itself, through the channel the app gives every Mini App
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

// Telegram's side of the channel: it records what the page asks and answers the requests for room and full screen
const fakeApp = `
window.__sent = [];
window.TelegramWebviewProxy = { postEvent(type, data) {
  __sent.push([type, JSON.parse(data)]);
  const answer = (t, d) => setTimeout(() => window.Telegram.WebView.receiveEvent(t, d));
  if (type === 'web_app_request_safe_area') answer('safe_area_changed', { top: 47, bottom: 34, left: 0, right: 0 });
  if (type === 'web_app_request_content_safe_area') answer('content_safe_area_changed', { top: 46, bottom: 0, left: 0, right: 0 });
  if (type === 'web_app_request_fullscreen') answer('fullscreen_changed', { is_fullscreen: true });
} };`;

let env, p;
before(async () => {
  env = await start();
  const theme = encodeURIComponent(JSON.stringify({ bg_color: '#17212b' }));
  p = await env.device('tg', () => { localStorage.clear(); sessionStorage.clear(); }, {
    hash: `#tgWebAppData=x&tgWebAppPlatform=ios&tgWebAppVersion=8.0&tgWebAppThemeParams=${theme}`,
    setup: async ctx => { await ctx.route('https://telegram.org/js/telegram-web-app.js', r => r.abort()); await ctx.addInitScript(fakeApp); },
  });
  await p.waitForFunction(() => document.documentElement.classList.contains('tgfull'));
});
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

test('without Telegram\'s script the page still opens full screen, clear of Telegram\'s buttons', async () => {
  const sent = await p.evaluate(() => __sent.map(e => e[0]));
  for (const t of ['web_app_ready', 'web_app_expand', 'web_app_setup_swipe_behavior', 'web_app_request_fullscreen']) assert.ok(sent.includes(t), t);
  assert.equal(await p.evaluate(() => document.documentElement.style.getPropertyValue('--tg-top')), '93px');
  assert.equal(await p.evaluate(() => document.documentElement.style.getPropertyValue('--tg-bottom')), '34px');
});

test('it takes Telegram\'s dark theme from the address and paints the header like the page', async () => {
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
  const header = await p.evaluate(() => __sent.find(e => e[0] === 'web_app_set_header_color')[1].color);
  assert.equal(header, await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()));
});
