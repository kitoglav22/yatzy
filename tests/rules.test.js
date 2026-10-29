// House rules: scores for dice, totals and bonus, the joker, fair dice
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, twoPlayers } = require('./helpers');

let env, p;
before(async () => { env = await start(); p = await env.device('ipad', twoPlayers); });
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

test('scores for dice follow the house rules', async () => {
  const got = await p.evaluate(() => {
    const t = (c, d) => scoreFor(c, d);
    return {
      three: [t('three', [3, 3, 3, 2, 1]), t('three', [3, 3, 2, 2, 1])],
      four: [t('four', [5, 5, 5, 5, 2]), t('four', [5, 5, 5, 2, 2])],
      small: [t('small', [1, 2, 3, 4, 6]), t('small', [3, 4, 5, 6, 6]), t('small', [1, 2, 3, 5, 6])],
      large: [t('large', [2, 3, 4, 5, 6]), t('large', [1, 2, 3, 4, 6])],
      house: [t('house', [2, 2, 3, 3, 3]), t('house', [4, 4, 4, 4, 4])],
      yatzy: [t('yatzy', [6, 6, 6, 6, 6]), t('yatzy', [6, 6, 6, 6, 5])],
      u4: t('u4', [4, 4, 1, 4, 2]), chance: t('chance', [1, 2, 3, 4, 5]),
    };
  });
  assert.deepEqual(got, {
    three: [12, 0], four: [22, 0], small: [30, 30, 0], large: [40, 0], house: [25, 0], yatzy: [50, 0], u4: 12, chance: 15,
  });
});

test('upper bonus is 50 from 63 points, the joker adds 100', async () => {
  const t = await p.evaluate(() => {
    game = newGameFor(roster);
    Object.assign(game.scores[0], { u1: 3, u2: 6, u3: 9, u4: 12, u5: 15, u6: 18, yatzy: 50, joker: 100 });
    Object.assign(game.scores[1], { u1: 3, u2: 6, u3: 9, u4: 12, u5: 15, u6: 12 });
    return [totals(0), totals(1)];
  });
  assert.equal(t[0].bonus, 50); assert.equal(t[0].total, 63 + 50 + 50 + 100);
  assert.equal(t[1].bonus, 0); assert.equal(t[1].par, -6);
});

test('the joker can be entered only after a Yatzy of 50', async () => {
  await p.evaluate(() => { game = newGameFor(roster); game.dice = false; saveGame(); render(); });
  await p.click('button[data-c="joker"][data-p="0"]');
  assert.ok(await p.$('.note'), 'a note instead of values');
  await p.click('#cancel');
});

test('dice are fair: every face about 1/6', async () => {
  const c = await p.evaluate(() => { const c = [0, 0, 0, 0, 0, 0, 0]; for (let k = 0; k < 60000; k++) c[rnd6()]++; return c.slice(1); });
  for (const n of c) assert.ok(n > 9400 && n < 10600, `face count ${n}`);
});
