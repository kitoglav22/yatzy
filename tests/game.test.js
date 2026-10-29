// Entering scores by hand: end of game, undo, early finish, past games, achievements, backup
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, twoPlayers, state } = require('./helpers');

let env, p;
before(async () => { env = await start(); p = await env.device('ipad', twoPlayers); });
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });
const fresh = () => p.evaluate(() => { game = newGameFor(roster); game.dice = false; game.roll = null; saveGame(); render(); });

test('the last cell ends the game, undo reopens it and takes it out of the history', async () => {
  await fresh();
  await p.evaluate(() => {
    ALL.forEach(c => { game.scores[0][c.id] = c.vals[c.vals.length - 1]; if (c.id !== 'yatzy') game.scores[1][c.id] = c.vals[1]; });
    saveGame(); render();
  });
  await p.click('button[data-c="yatzy"][data-p="1"]'); await p.click('.vals button[data-v="0"]');
  let s = await state(p);
  assert.equal(s.hist, 1); assert.ok(s.saved && s.over);
  assert.match(await p.textContent('#banner'), /Победа: Аня/);
  await p.click('#undo');
  s = await state(p);
  assert.equal(s.hist, 0); assert.ok(!s.saved && !s.over);
  await p.click('button[data-c="yatzy"][data-p="1"]'); await p.click('.vals button[data-v="50"]');
  assert.equal((await state(p)).hist, 1);
});

test('a game finished early goes to the history without achievements', async () => {
  await p.click('#again'); await p.click('#go');
  await p.click('button[data-c="u1"][data-p="0"]'); await p.click('.vals button[data-v="3"]');
  await p.click('#fin'); await p.click('#fyes');
  assert.match(await p.textContent('#banner'), /досрочно/);
  const early = await p.evaluate(() => history.find(g => g.early));
  assert.ok(early);
  const ach = await p.evaluate(() => computeStats().players.find(x => x.name === 'Аня').ach);
  assert.equal(ach.win.n, 1, 'only the full game counts');
});

test('a past game opens and is deleted after a second tap', async () => {
  await p.click('#tstats'); await p.click('#hist li[data-at]');
  await p.click('#gdel'); assert.match(await p.textContent('#gdel'), /Точно/);
  await p.click('#gdel');
  assert.equal((await state(p)).hist, 1);
  await p.click('#tgame');
});

test('achievements that depend on a single cell pop up during the game', async () => {
  await fresh();
  await p.evaluate(async () => { await toastQ; $('toasts').innerHTML = ''; });
  await p.click('button[data-c="u6"][data-p="0"]'); await p.click('.vals button[data-v="30"]');
  await p.waitForTimeout(700);
  const names = await p.$$eval('.toast b', x => x.map(e => e.textContent));
  assert.ok(names.includes('Пять шестёрок'), names.join());
});

test('names with quotes and tags are shown as text', async () => {
  await p.evaluate(() => { roster = [{ id: 'q', name: 'Ко"т <b>' }, { id: 'w', name: "О'Нил" }]; saveRoster(); game = newGameFor(roster); game.dice = false; saveGame(); render(); });
  const labels = await p.$$eval('[aria-label^="Переименовать"]', x => x.map(e => e.getAttribute('aria-label')));
  assert.deepEqual(labels, ['Переименовать Ко"т <b>', "Переименовать О'Нил"]);
  assert.equal(await p.$('th b'), null);
  await p.evaluate(() => { roster = [{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Миша' }]; saveRoster(); });
});

test('backup goes to yatzy-backup.json and restoring skips broken entries', async () => {
  await p.click('#tstats');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('#exp')]);
  assert.equal(d.suggestedFilename(), 'yatzy-backup.json');
  assert.match(await p.textContent('#blast'), /Последняя копия/);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yatzy-')), 'b.json');
  fs.writeFileSync(file, JSON.stringify({ history: [
    { at: 1, players: [{ name: 'X', total: 100, scores: { u1: 3 } }], winner: 'X' },
    { at: 2 }, null, { at: 3, players: 'no' }, { at: 4, players: [{ name: 'Y', total: 5, scores: { u1: '<img>' } }] },
  ], roster: [null, { id: 'z', name: 'Z' }] }));
  const before = (await state(p)).hist;
  await p.setInputFiles('#imp', file); await p.waitForTimeout(300);
  assert.equal((await state(p)).hist, before + 1);
  assert.ok(await p.evaluate(() => roster.some(r => r.name === 'Z')));
  await p.click('#tgame');
});

test('after five games without a backup a reminder shows up', async () => {
  await p.evaluate(() => {
    localStorage.removeItem('yatzy.backupAt');
    for (let k = 0; k < 5; k++) { game = newGameFor(roster); ALL.forEach(c => { game.scores[0][c.id] = c.vals[1]; game.scores[1][c.id] = c.vals[0]; }); archive(); }
    game = newGameFor(roster); render();
  });
  assert.match(await p.textContent('#remind'), /Сохраните копию/);
});

test('on a phone a short name lines up with a two-line one and the turn tags share a line', async () => {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => { game = newGameFor([{ id: 'a', name: 'ЛЕХА' }, { id: 'b', name: 'Константин Константинопольский' }]); game.dice = false; saveGame(); render(); });
  const box = sel => p.$$eval(sel, x => x.map(e => { const r = e.getBoundingClientRect(); return { mid: r.top + r.height / 2, bottom: r.bottom, h: r.height }; }));
  const [a, b] = await box('th .nm'), [ta, tb] = await box('th .tag');
  assert.ok(b.h > a.h * 1.5, 'the long name wraps');
  assert.ok(Math.abs(a.mid - b.mid) < 2, `names centred together: ${a.mid} vs ${b.mid}`);
  assert.ok(Math.abs(ta.bottom - tb.bottom) < 1, 'tags on one line');
  await p.setViewportSize({ width: 820, height: 1180 });
});
