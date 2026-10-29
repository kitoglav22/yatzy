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

test('on one device the stripe follows the player on turn', async () => {
  await fresh();
  const striped = () => p.$$eval('#table thead th', x => x.slice(1).map(e => e.classList.contains('me')));
  assert.deepEqual(await striped(), [true, false]);
  await p.click('button[data-c="u1"][data-p="0"]'); await p.click('.vals button[data-v="3"]');
  assert.deepEqual(await striped(), [false, true]);
});

test('on a phone the total stays in a bar at the bottom of the screen until the table\'s own row comes up', async () => {
  const ph = await env.device('phone', twoPlayers, { viewport: { width: 390, height: 700 } });
  await ph.evaluate(() => { game = newGameFor(roster); game.dice = false; game.scores[0].u1 = 3; saveGame(); render(); window.scrollTo(0, 0); });
  const bar = () => ph.evaluate(() => { const b = $('totbar'), r = b.getBoundingClientRect(); return b.hidden ? null : { bottom: Math.round(r.bottom), text: b.textContent }; });
  await ph.waitForFunction(() => !$('totbar').hidden);
  assert.deepEqual(await bar(), { bottom: 700, text: 'Итого30' });
  const cols = await ph.evaluate(() => [...document.querySelectorAll('#totbar td')].map((td, k) => Math.round(td.getBoundingClientRect().left - document.querySelectorAll('#table tr.total td')[k].getBoundingClientRect().left)));
  assert.deepEqual(cols, [0, 0, 0], 'the numbers stand under their columns');
  // the bar stays until the real row has come up to exactly where the copy stands, so the swap does not jump
  const gap = () => ph.evaluate(() => { const t = $('totbar').querySelector('tr').getBoundingClientRect(), r = document.querySelector('#table tr.total').getBoundingClientRect(); return { d: r.bottom - t.bottom, h: r.height - t.height }; });
  const g0 = await gap();
  assert.ok(Math.abs(g0.h) <= 1, 'the copy is as tall as the row');
  await ph.evaluate(d => window.scrollBy(0, d), g0.d - 10); await ph.waitForTimeout(100);
  assert.ok(await bar(), 'still there with the row 10px below it');
  await ph.evaluate(() => window.scrollBy(0, 20)); await ph.waitForTimeout(100);
  assert.equal(await bar(), null, 'gone once the row has passed its place');
  await ph.evaluate(() => window.scrollBy(0, -20)); await ph.waitForTimeout(100);
  assert.ok(await bar(), 'back when the row goes down again');
  await ph.evaluate(() => window.scrollTo(0, 99999));
  await ph.waitForFunction(() => $('totbar').hidden);
  await ph.click('#tstats');
  await ph.evaluate(() => window.scrollTo(0, 0)); await ph.waitForTimeout(100);
  assert.equal(await bar(), null, 'no bar on the statistics tab');
  await ph.evaluate(() => render()); await ph.waitForTimeout(100);
  assert.equal(await bar(), null, 'not even after the page redraws');
  await ph.click('#tgame'); await ph.evaluate(() => window.scrollTo(0, 0));
  await ph.waitForFunction(() => !$('totbar').hidden);
  await ph.click('#tstats');
  assert.equal(await bar(), null, 'gone again right away');
  await ph.close();
});

test('correcting a Yatzy of 50 takes the joker with it, undo brings both back', async () => {
  await fresh();
  await p.evaluate(() => { game.scores[0].yatzy = 50; game.scores[0].joker = 100; saveGame(); render(); });
  await p.click('button[data-p="0"][data-c="yatzy"]');
  assert.match(await p.textContent('.sheet'), /джокер тоже сотрётся/);
  await p.click('.vals button[data-v="0"]');
  assert.equal((await state(p)).scores[0].joker, undefined);
  await p.click('#undo');
  const s = await state(p);
  assert.equal(s.scores[0].yatzy, 50); assert.equal(s.scores[0].joker, 100);
});

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
  await p.click('#more'); await p.click('#fin'); await p.click('#fyes');
  assert.match(await p.textContent('#banner'), /досрочно/);
  const early = await p.evaluate(() => history.find(g => g.early));
  assert.ok(early);
  const ach = await p.evaluate(() => computeStats().players.find(x => x.name === 'Аня').ach);
  assert.equal(ach.win.n, 1, 'only the full game counts');
  const anya = await p.evaluate(() => computeStats().players.find(x => x.name === 'Аня'));
  assert.equal(anya.games, 1, 'the early game is not counted at all');
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
  await p.evaluate(async () => { history = []; lsSet('yatzy.hist', history); await toastQ; $('toasts').innerHTML = ''; });
  await p.click('button[data-c="u6"][data-p="0"]'); await p.click('.vals button[data-v="30"]');
  await p.waitForTimeout(700);
  const names = await p.$$eval('.toast b', x => x.map(e => e.textContent));
  assert.ok(names.includes('Пять шестёрок'), names.join());
});

test('an achievement earned before is counted again but does not pop up', async () => {
  const sixes = () => p.evaluate(() => (computeStats().players.find(x => x.name === 'Аня').ach.sixes || { n: 0 }).n);
  // finish the game with five sixes, then play another one with five sixes
  await p.evaluate(() => { ALL.forEach(c => { if (game.scores[0][c.id] == null) game.scores[0][c.id] = c.vals[1]; if (game.scores[1][c.id] == null) game.scores[1][c.id] = c.vals[0]; }); changed(); });
  const n = await sixes();
  assert.ok(n >= 1);
  await fresh();
  await p.evaluate(async () => { await toastQ; $('toasts').innerHTML = ''; });
  await p.click('button[data-c="u6"][data-p="0"]'); await p.click('.vals button[data-v="30"]');
  await p.evaluate(() => { ALL.forEach(c => { if (game.scores[0][c.id] == null) game.scores[0][c.id] = c.vals[1]; if (game.scores[1][c.id] == null) game.scores[1][c.id] = c.vals[0]; }); changed(); });
  await p.waitForTimeout(700);
  const names = await p.$$eval('.toast b', x => x.map(e => e.textContent));
  assert.ok(!names.includes('Пять шестёрок'), names.join());
  assert.equal(await sixes(), n + 1, 'the repeat is counted');
  assert.match(await p.textContent('#banner'), /Пять шестёрок/, 'and listed under the result');
});

test('the picker on the statistics shows one player\'s card and achievements', async () => {
  await p.click('#tstats');
  const cards = () => p.$$eval('.pcard h3', x => x.map(e => e.textContent));
  assert.deepEqual(await cards(), ['Аня', 'Миша']);
  await p.click('.statseg button[data-n="Миша"]');
  assert.deepEqual(await cards(), ['Миша']);
  assert.equal(await p.$$eval('.seg', x => x.length), 1, 'one picker for the card and the achievements');
  assert.ok(await p.$('table.avg th:nth-child(3)'), 'the averages still compare everyone');
  await p.click('.statseg button[data-n=""]');
  assert.deepEqual(await cards(), ['Аня', 'Миша']);
  await p.click('#tgame');
});

test('a sheet on a phone closes when pulled down far enough and springs back otherwise', async () => {
  const ph = await env.device('phone2', twoPlayers, { viewport: { width: 390, height: 700 } });
  const pull = (dy) => ph.evaluate(dy => {
    const el = document.querySelector('.sheet'), r = el.getBoundingClientRect(), x = r.left + 100, y = r.top + 30;
    const t = y => [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })];
    el.dispatchEvent(new TouchEvent('touchstart', { touches: t(y), bubbles: true, cancelable: true }));
    for (let k = 1; k <= 5; k++) el.dispatchEvent(new TouchEvent('touchmove', { touches: t(y + dy * k / 5), bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: t(y + dy), bubbles: true, cancelable: true }));
  }, dy);
  await ph.evaluate(() => sheet.open('<h3>Проба</h3><p>Текст</p><p>Ещё</p>'));
  const h = await ph.evaluate(() => document.querySelector('.sheet').offsetHeight);
  await pull(20); await ph.waitForTimeout(300);
  assert.ok(await ph.$('.sheet'), 'a short pull springs back');
  assert.equal(await ph.evaluate(() => document.querySelector('.sheet').style.transform), '');
  await pull(Math.round(h / 2)); await ph.waitForTimeout(300);
  assert.equal(await ph.$('.sheet'), null, 'a long pull closes it');
  await ph.close();
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

test('a quick double tap does not zoom the page', async () => {
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('td.cell button')).touchAction), 'manipulation');
  assert.match(await p.getAttribute('meta[name="viewport"]', 'content'), /maximum-scale=1,user-scalable=no/);
});

test('a long undo label wraps and the page never gets wider than a phone screen', async () => {
  await p.setViewportSize({ width: 375, height: 700 });
  await p.evaluate(() => { game = newGameFor([{ id: 'a', name: 'Константин Петрович' }, { id: 'b', name: 'Валентина Сергеевна' }]); game.dice = false; game.scores[0].u1 = 3; saveGame(); render(); });
  await p.click('button[data-c="large"][data-p="1"]'); await p.click('.vals button[data-v="0"]');
  assert.match(await p.textContent('#undo'), /Валентина Сергеевна, Большой стрит/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways overflow');
  await p.setViewportSize({ width: 820, height: 1180 });
});
