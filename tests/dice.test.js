// Dice on screen: holding, three rolls, suggested scores, joker, turn order
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, twoPlayers, state, settle } = require('./helpers');

let env, p;
before(async () => {
  env = await start();
  p = await env.device('ipad', twoPlayers);
  await p.evaluate(() => { game = newGameFor(roster); saveGame(); render(); });
  if (!(await p.evaluate(() => game.dice))) await p.click('#dmode');
});
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });
const roll = async () => { await p.click('#roll'); await settle(p); };

test('held dice stay, free dice are rolled again', async () => {
  await roll();
  await p.click('.die[data-k="0"]'); await p.click('.die[data-k="1"]');
  const d1 = (await state(p)).roll.dice;
  assert.equal(await p.$$eval('.die.held', x => x.length), 2);
  assert.equal(await p.$('#sw'), null, 'order cannot change in the middle of a turn');
  await roll();
  const s = await state(p);
  assert.deepEqual(s.roll.dice.slice(0, 2), d1.slice(0, 2)); assert.equal(s.roll.n, 2);
});

test('after the third roll nothing is held and the dice are locked', async () => {
  await roll();
  assert.equal((await state(p)).roll.n, 3);
  assert.equal(await p.$$eval('.die.held', x => x.length), 0);
  assert.equal(await p.$$eval('.die[disabled]', x => x.length), 5);
  assert.ok(await p.$eval('#roll', b => b.disabled));
});

test('every free cell of the player on turn suggests its score, a tap ends the turn', async () => {
  assert.equal(await p.$$eval('button.sug', x => x.length), 13);
  const want = await p.evaluate(() => scoreFor('chance', game.roll.dice));
  await p.click('button.sug[data-c="chance"]');
  const s = await state(p);
  assert.equal(s.scores[0].chance, want); assert.equal(s.turn, 1); assert.equal(s.roll.n, 0);
});

test('undo gives the roll back to the same player', async () => {
  await p.click('#undo');
  const s = await state(p);
  assert.equal(s.scores[0].chance, undefined); assert.equal(s.turn, 0); assert.equal(s.roll.n, 3);
});

test('a second Yatzy gives the joker, then a 0 goes into another cell', async () => {
  await p.evaluate(() => {
    game.scores[0].yatzy = 50; game.scores[1].yatzy = 0;
    game.roll = { dice: [4, 4, 4, 4, 4], held: [false, false, false, false, false], n: 1, jokerTaken: false };
    saveGame(); render();
  });
  assert.equal(await p.$eval('button.sug[data-c="joker"]', b => b.textContent), '100');
  await p.click('button.sug[data-c="joker"]');
  assert.deepEqual(await p.$$eval('button.sug', x => [...new Set(x.map(e => e.textContent))]), ['0']);
  await p.click('button.sug[data-c="u1"]');
  const s = await state(p);
  assert.equal(s.scores[0].joker, 100); assert.equal(s.scores[0].u1, 0); assert.equal(s.turn, 1);
});

test('fits a phone screen without sideways scrolling', async () => {
  await p.setViewportSize({ width: 390, height: 844 });
  await roll();
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390));
});

test('the latest score is named under the dice and each player keeps a dot on their latest cell', async () => {
  await p.evaluate(() => { game = newGameFor(roster); game.dice = true; saveGame(); render(); });
  assert.equal(await p.$('.dnote'), null, 'no moves yet: the first-turn tip shows instead');
  await roll(); await p.click('button.sug[data-c="chance"]');
  assert.match(await p.textContent('.dnote'), /Записано: Аня, Шанс \d+/);
  assert.ok(await p.$('button.last.flash[data-p="0"][data-c="chance"]'));
  await roll(); await p.click('button.sug[data-c="u1"]');
  assert.deepEqual(await p.$$eval('button.last', x => x.map(b => b.dataset.p + b.dataset.c).sort()), ['0chance', '1u1']);
  assert.match(await p.textContent('.dnote'), /Записано: Миша, Единицы (\d+|вычеркнуто)/);
});

test('tapping a combination name explains it, with the full rules one tap away', async () => {
  await p.click('button[data-help="house"]');
  assert.match(await p.textContent('.sheet'), /Запишется 25/);
  await p.click('#hall');
  assert.equal(await p.textContent('.sheet h3'), 'Правила');
  assert.equal(await p.$$eval('.rules dt', x => x.length), 10);
  await p.click('#hok');
  assert.equal(await p.$('.sheet'), null);
  await p.click('button[data-help="all"]');
  assert.ok(await p.$('.rules')); await p.click('#hok');
});

test('on a phone the dice and the roll button share one row', async () => {
  await p.setViewportSize({ width: 375, height: 700 });
  const r = await p.evaluate(() => {
    const b = e => e.getBoundingClientRect(), dies = [...document.querySelectorAll('.die')].map(b), btn = b(document.getElementById('roll'));
    return { tops: dies.map(d => Math.round(d.top)), right: Math.max(...dies.map(d => d.right)), dw: dies[0].width, btn, bar: b(document.querySelector('.dicebar')).height };
  });
  assert.equal(new Set(r.tops.map(t => Math.abs(t - r.tops[0]) < 8)).size, 1, 'dice on one line');
  assert.ok(r.right <= r.btn.left && r.btn.top < r.tops[0] + 40, 'the button to the right of the dice');
  assert.ok(r.bar < 160, `panel height ${r.bar}`);
  assert.ok(Math.abs(r.btn.width - r.dw) < 1 && Math.abs(r.btn.height - r.dw) < 1, `the button is the size of a die: ${r.btn.width} vs ${r.dw}`);
  await p.setViewportSize({ width: 820, height: 1180 });
});
