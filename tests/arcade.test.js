// The arcade alpha next to the notebook: the site links to it, and the page itself opens (its sources live in yatzy-arcade)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let env, p;
before(async () => { env = await start(); p = await env.device('phone', null, { viewport: { width: 390, height: 780 } }); });
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

test('the site has a link to the arcade alpha, and it fits on a phone next to the players button', async () => {
  const a = p.locator('#arcade');
  assert.ok(await a.isVisible());
  assert.equal(await a.textContent(), 'Аркада (альфа)');
  assert.equal(await a.getAttribute('href'), 'arcade.html');
  assert.ok(await p.locator('#players').isVisible());
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
});

test('the arcade page opens, can be played and leads back to the notebook', async () => {
  await p.click('#arcade');
  await p.waitForURL(/arcade\.html$/);
  assert.equal(await p.title(), 'Аркада Яцзы (альфа)');
  assert.match(await p.textContent('#seed'), /v\d+\.\d+$/, 'the version notebook.arcade is shown');
  await p.click('#card button.alt'); // the run opens with a free amulet pick: skip it
  await p.click('#roll');
  assert.equal(await p.locator('.die.blank').count(), 0);
  assert.ok(await p.locator('#tune').isHidden(), 'no balance panel for friends');
  await p.click('#home');
  await p.waitForURL(u => !u.pathname.endsWith('arcade.html'));
  assert.ok(await p.locator('#arcade').isVisible());
});
