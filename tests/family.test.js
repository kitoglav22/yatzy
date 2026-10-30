// One history of finished games for several devices, under a long code, on the fake database (see helpers.js)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

const game = (at, started, a, b, names = ['Женя', 'Аня']) => ({ at, started, players: [{ id: 'a1', name: names[0], total: a, scores: { u1: 3 } }, { id: 'a2', name: names[1], total: b, scores: {} }], winner: a > b ? names[0] : names[1] });
let env, A, B, code;
const w = ms => A.waitForTimeout(ms);
const hist = p => p.evaluate(() => history.map(g => g.players.map(x => x.name + ' ' + x.total).join(', ')).sort());
before(async () => {
  env = await start();
  // runs in the page: the data is written into the script
  const init = o => `localStorage.clear();${Object.entries(o).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(JSON.stringify(v))});`).join('')}`;
  // the second game was played online: the other phone keeps its own copy of it
  A = await env.device('A', init({ 'yatzy.roster': [{ id: 'a1', name: 'Женя' }, { id: 'a2', name: 'Аня' }], 'yatzy.hist': [game(1000, 900, 200, 150), game(2000, 1900, 180, 220)] }), { online: true, hash: '#stats' });
  B = await env.device('B', init({ 'yatzy.hist': [game(2005, 1900, 180, 220), game(3000, 2900, 250, 100)] }), { online: true, hash: '#stats' });
});
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

test('a new shared history gets a long code and this device\'s games', async () => {
  await A.click('#famnew'); await w(300);
  code = (await A.textContent('.famcode')).trim();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const h = env.tree.hist[code.replace(/-/g, '')];
  assert.deepEqual(Object.keys(h.g).sort(), ['1900', '900']);
  assert.match(await A.textContent('#famst'), /Партий в общей истории: 2/);
  assert.equal(await A.evaluate(() => JSON.parse(localStorage.getItem('yatzy.family'))), code.replace(/-/g, ''));
});

test('a wrong code is refused, the right one joins: one online game stays one game', async () => {
  await B.click('#famjoin');
  await B.fill('#famin', 'abc'); await B.click('#famf button'); await w(100);
  assert.match(await B.textContent('#fmsg'), /12 букв/);
  await B.fill('#famin', 'ABCD-EFGH-2345'); await B.click('#famf button'); await w(300);
  assert.match(await B.textContent('#fmsg'), /нет/);
  await B.fill('#famin', code.toLowerCase()); await B.click('#famf button'); await w(400);
  const all = ['Женя 180, Аня 220', 'Женя 200, Аня 150', 'Женя 250, Аня 100'];
  assert.deepEqual(await hist(B), all);
  assert.deepEqual(await hist(A), all);
  assert.match(await B.textContent('#famst'), /Партий в общей истории: 3/);
  // the players come too
  assert.deepEqual(await B.evaluate(() => roster.map(r => r.name).sort()), ['Аня', 'Женя']);
  // the stats show the same everywhere
  assert.equal(await A.textContent('#tally'), await B.textContent('#tally'));
});

test('a game finished, deleted or renamed on one device changes the other', async () => {
  await A.evaluate(() => { game = newGameFor(roster.slice(0, 2)); game.ended = true; game.scores[0].u6 = 24; archive(); });
  await w(300);
  assert.equal((await hist(B)).length, 4);
  assert.ok(await B.evaluate(() => history.some(g => g.players[0].total === 24)));
  const at = await B.evaluate(() => history.find(g => g.started === 2900).at);
  await B.evaluate(at => deleteGame(at), at); await w(300);
  assert.equal((await hist(A)).length, 3);
  assert.ok(!(await A.evaluate(() => history.some(g => g.started === 2900))));
  await A.evaluate(() => renamePlayer('a2', 'Анна')); await w(300);
  assert.ok(await B.evaluate(() => history.every(g => g.players[1].name === 'Анна')));
});

test('turning it off keeps the games here; a link with the code asks first', async () => {
  await B.click('#famleave'); assert.match(await B.textContent('#fmsg'), /останутся/);
  await B.click('#famleave'); await w(100);
  assert.ok(await B.$('#famnew'));
  assert.equal((await hist(B)).length, 3);
  await A.evaluate(() => deleteGame(history[0].at)); await w(300);
  assert.equal((await hist(B)).length, 3, 'no longer follows the shared history');
  await B.goto(env.url + '#hist=' + code); await w(300);
  assert.equal(await B.inputValue('#famin'), code);
  await B.click('#famf button'); await w(400);
  assert.equal((await hist(B)).length, 2);
});
