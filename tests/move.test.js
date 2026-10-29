// Moving to the site's own address: the old address hands the local data over in the link, the new one takes it in
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

let env, home;
// the old address is 127.0.0.1, the new one localhost: two origins, two separate storages, one server
// a device that has used the old address, and then the release with the new address arrives
async function old(name, init) {
  const p = await env.device(name, init);
  await p.context().addInitScript(h => { if (location.hostname === '127.0.0.1') window.__yatzyHome = h; }, home);
  await p.reload();
  return p;
}
before(async () => { env = await start(); home = env.url.replace('127.0.0.1', 'localhost'); });
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

const game = (at, a, b) => ({ at, players: [{ name: 'Аня', total: a, scores: { u1: 3 } }, { name: 'Миша', total: b, scores: {} }], winner: a > b ? 'Аня' : 'Миша' });
// device() runs init in the page without arguments, so the games go in as source text
const filled = games => `(() => {
  localStorage.clear();
  localStorage.setItem('yatzy.roster', JSON.stringify([{ id: 'a', name: 'Аня' }, { id: 'b', name: 'Миша' }]));
  localStorage.setItem('yatzy.hist', ${JSON.stringify(JSON.stringify(games))});
  localStorage.setItem('yatzy.dev', JSON.stringify('olddevice1'));
})()`;
const seen = p => p.evaluate(() => ({ origin: location.origin, hash: location.hash, hist: history.map(g => g.at), roster: roster.map(r => r.name),
  dev: lsGet('yatzy.dev'), note: $('move') && $('move').textContent }));

test('a filled notebook on the old address offers to move, and the new one gets everything', async () => {
  const games = Array.from({ length: 300 }, (_, k) => game(1000 + k, 200 + k % 50, 180));
  const p = await old('old', filled(games));
  assert.match(await p.textContent('#move'), /переехал на localhost/);
  await p.click('#mvbtn');
  await p.waitForURL(u => u.host.startsWith('localhost') && !u.hash);
  await p.waitForFunction(() => $('move') && /перенесены/.test($('move').textContent));
  const s = await seen(p);
  assert.equal(s.hist.length, 300);
  assert.deepEqual(s.roster, ['Аня', 'Миша']);
  assert.equal(s.dev, 'olddevice1', 'the device keeps its identity in online rooms');
  assert.equal(s.hash, '');
  // a reload does not bring the data in again and the note is gone
  await p.reload();
  assert.equal((await seen(p)).note, null);
});

test('a notebook already used on the new address adds only the games and players it lacks', async () => {
  const p = await old('both', filled([game(1, 100, 90), game(2, 80, 120)]));
  // the same browser has already played one of these games and one other on the new address
  await p.goto(home);
  await p.evaluate(() => {
    localStorage.setItem('yatzy.roster', JSON.stringify([{ id: 'c', name: 'Катя' }, { id: 'a', name: 'Аня' }]));
    localStorage.setItem('yatzy.hist', JSON.stringify([{ at: 2, players: [{ name: 'Аня', total: 80 }, { name: 'Миша', total: 120 }] }, { at: 3, players: [{ name: 'Катя', total: 50 }] }]));
    localStorage.setItem('yatzy.dev', JSON.stringify('newdevice1'));
  });
  await p.goto(env.url);
  await p.click('#mvbtn');
  await p.waitForFunction(() => location.host.startsWith('localhost') && $('move') && /перенесены/.test($('move').textContent));
  const s = await seen(p);
  assert.deepEqual(s.hist.slice().sort(), [1, 2, 3]);
  assert.deepEqual(s.roster, ['Катя', 'Аня', 'Миша']);
  assert.equal(s.dev, 'newdevice1');
});

test('an empty notebook on the old address simply goes to the new one, keeping the link', async () => {
  const p = await old('empty', () => localStorage.clear());
  await p.goto(env.url + '?from=test#stats');
  await p.waitForURL(u => u.host.startsWith('localhost'));
  assert.equal(new URL(p.url()).search, '?from=test');
  assert.equal(new URL(p.url()).hash, '#stats');
});

test('inside Telegram the old address stays as it is', async () => {
  const p = await old('tg', filled([game(1, 100, 90)]));
  await p.evaluate(() => sessionStorage.setItem('yatzy.tg', '1'));
  await p.reload();
  assert.equal(await p.$('#move'), null);
  assert.ok(p.url().includes('127.0.0.1'));
});

test('a broken moving link changes nothing and says how to move by file', async () => {
  const p = await env.device('broken', filled([game(1, 100, 90)]));
  await p.goto(env.url + '?x#move=zAAAA');
  await p.waitForFunction(() => $('move') && /Не удалось/.test($('move').textContent));
  assert.deepEqual((await seen(p)).hist, [1]);
});
