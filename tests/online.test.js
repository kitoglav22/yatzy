// Online rooms with two and three devices, on a fake room server (see helpers.js)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, state, settle } = require('./helpers');

let env, A, B, C, code;
const w = ms => A.waitForTimeout(ms);
const mine = p => p.evaluate(() => mine(whoseTurn()));
before(async () => {
  env = await start();
  A = await env.device('A', () => {
    localStorage.clear();
    localStorage.setItem('yatzy.roster', JSON.stringify([{ id: 'a1', name: 'Вова' }, { id: 'a2', name: 'Аня' }]));
    localStorage.setItem('yatzy.game', JSON.stringify({ players: [{ id: 'a1', name: 'Вова' }, { id: 'a2', name: 'Аня' }], scores: [{ u1: 3 }, {}], started: 5 }));
  }, { online: true });
  B = await env.device('B', () => localStorage.clear(), { online: true });
});
after(async () => { assert.deepEqual(env.errors, []); await env.stop(); });

test('a room is created and the local game steps aside', async () => {
  await A.click('#onl'); await A.click('#ncreate'); await A.click('#ngo'); await w(300);
  code = await A.textContent('.roomcode');
  assert.match(code, /^[A-Z2-9]{5}$/);
  await A.click('#cancel');
  assert.equal(await A.evaluate(() => game), null);
  assert.match(await A.textContent('#net'), new RegExp(code));
});

test('a friend joins by link; a name already in the room is refused', async () => {
  await B.goto(env.url + '#room=' + code); await w(300);
  assert.equal(await B.inputValue('#ncode'), code);
  await B.click('#njoin button'); await w(300);
  await B.fill('#nname', 'вова'); await B.click('#naddf button'); await B.click('#ngo'); await w(200);
  assert.match(await B.textContent('#nmsg'), /уже есть/);
  await B.click('.pick.on'); await B.fill('#nname', 'Друг'); await B.click('#naddf button'); await B.click('#ngo'); await w(300);
  assert.deepEqual(await A.$$eval('.roster .pick', x => x.map(e => e.textContent)), []);
  await B.click('#cancel');
  await A.click('#nroom');
  assert.equal(await A.$$eval('.roster .pick', x => x.length), 2);
});

test('only the player on turn rolls; the other device sees the roll and the held dice', async () => {
  await A.click('#nstart'); await w(300);
  assert.deepEqual((await state(B)).names, ['Вова', 'Друг']);
  assert.ok(await mine(A)); assert.ok(!(await mine(B)));
  assert.ok(await B.$eval('#roll', b => b.disabled));
  await A.click('#roll'); await settle(A); await w(300); await settle(B);
  assert.deepEqual((await state(B)).roll.dice, (await state(A)).roll.dice);
  await A.click('.die[data-k="0"]'); await w(200);
  assert.equal(await B.$$eval('.die.held', x => x.length), 1);
  assert.equal(await B.$$eval('button.sug', x => x.length), 0);
});

test('on your turn in a room a cell the dice give nothing for can be crossed out', async () => {
  const cid = await A.evaluate(() => ALL.find(c => game.scores[0][c.id] == null && scoreFor(c.id, game.roll.dice) === 0).id);
  assert.ok(!(await A.$eval(`button[data-p="0"][data-c="${cid}"]`, b => b.disabled)));
  assert.ok(await B.$eval(`button[data-p="0"][data-c="${cid}"]`, b => b.disabled), 'not on the other device');
  assert.ok(await A.$eval('button[data-p="1"][data-c="u1"]', b => b.disabled), 'nor someone else\'s cell');
  assert.equal(await A.$eval(`button[data-p="0"][data-c="${cid}"]`, b => b.dataset.s + b.textContent), '0—', 'one tap crosses it out, but no 0 is shown');
});

test('a score travels to the other device, undo only for your own move', async () => {
  await A.click('button.sug'); await w(300);
  const s = await state(B);
  assert.equal(s.turn, 1); assert.equal(Object.keys(s.scores[0]).length, 1);
  assert.ok(await A.$('#undo')); assert.equal(await B.$('#undo'), null);
  const cid = Object.keys(s.scores[0])[0];
  assert.ok(await B.$(`button.flash[data-p="0"][data-c="${cid}"]`), 'the new score flashes on the other device');
  assert.match(await B.textContent('.dnote'), /Вова/);
});

test('your own column comes first and carries a stripe on your device, whoever is on turn', async () => {
  for (const P of [A, B]) {
    const mine = await P.evaluate(() => game.players.find(p => p.dev === DEV).name);
    const got = await P.$$eval('#table thead th', x => x.slice(1).map(e => e.classList.contains('me')));
    assert.deepEqual(got, [true, false]);
    assert.equal(await P.textContent('#table thead th:nth-child(2) .nm'), mine);
    assert.equal(await P.$$eval('#table td.me', x => x.length), (await P.$$eval('#table tbody tr:not(.section)', x => x.length)));
  }
});

test('a reaction floats up on the other screen and does not touch the game', async () => {
  const before = JSON.stringify((await state(A)).scores);
  await B.click('#rbtn'); await B.click('[data-react="1"]'); await w(300);
  assert.match(await A.textContent('.reactfly'), /😂\s*Друг/);
  assert.match(await B.textContent('.reactfly'), /😂/, 'the sender sees it too');
  assert.equal(JSON.stringify((await state(A)).scores), before);
  assert.equal(await B.$('.reacts'), null, 'the picker closes');
  // hostile reaction data is ignored
  env.tamper(code, s => { s.fx = { dev: s.players[1].dev, e: '<img src=x onerror=window.pwned=1>', t: 1 }; }); await w(200);
  assert.equal(await A.evaluate(() => window.pwned), undefined);
});

test('a half-done "leave?" survives the other player\'s rolls', async () => {
  await A.click('#nroom'); await A.click('#nleave');
  await B.click('#roll'); await settle(B); await w(300);
  assert.match(await A.textContent('#nleave'), /Точно/);
  await A.click('#cancel');
});

test('a move that does not reach the room is rolled back', async () => {
  const before = await state(B);
  env.ctl.failNext = 'B';
  await B.click('button.sug'); await w(400);
  assert.match(await B.textContent('#toasts'), /Ход не отправился/);
  const s = await state(B);
  assert.equal(s.turn, before.turn); assert.equal(s.roll.n, before.roll.n);
  await B.click('button.sug'); await w(300);
  assert.equal((await state(A)).turn, 0);
});

test('a move made on a game the room no longer has is not written over it', async () => {
  // the device on turn has a stale view of the room: someone else changed the game in the meantime
  const P = (await mine(A)) ? A : B;
  await P.evaluate(() => { net.base = '{"stale":true}'; });
  const hist = JSON.stringify((await state(P)).scores);
  await P.click('#roll'); await settle(P);
  await w(400);
  assert.match(await P.textContent('#toasts'), /Ход не отправился/);
  assert.equal(JSON.stringify((await state(P)).scores), hist);
  assert.equal((await state(P)).roll.n, 0, 'the roll is taken back');
  await P.evaluate(async () => { await toastQ; $('toasts').innerHTML = ''; });
});

test('damaged or hostile room data is ignored', async () => {
  const before = JSON.stringify((await state(A)).scores);
  for (const f of [
    s => { s.game.scores[0].u1 = '<img src=x onerror=window.pwned=1>'; },
    s => { s.players[0].name = '<b>x</b>'.repeat(5); },
    s => { s.game.roll.dice[0] = '<i>'; },
    s => { s.game.scores[1].hack = 5; },
  ]) {
    const keep = env.rooms[code].state;
    env.tamper(code, f); await w(200);
    assert.equal(JSON.stringify((await state(A)).scores), before);
    env.rooms[code].state = keep;
  }
  assert.equal(await A.evaluate(() => window.pwned), undefined);
});

test('a new device takes over a seat, but only one whose device is away', async () => {
  C = await env.device('C', () => localStorage.clear(), { online: true });
  const join = async () => { await C.click('#onl0'); await C.fill('#ncode', code); await C.click('#njoin button'); await w(300); };
  await join();
  assert.equal(await C.$('[data-seat]'), null, 'both devices are in the room, so no seat is offered');
  await C.click('#cancel');
  env.rooms[code].on[await B.evaluate(() => DEV)] = false;
  await join();
  assert.equal(await C.$$eval('[data-seat]', x => x.length), 1);
  await C.click('[data-seat]'); await w(300);
  assert.ok(await mine(C) || (await state(C)).turn === 0, 'C plays for Друг now');
  assert.ok(await C.evaluate(() => game.players[1].dev === JSON.parse(localStorage.getItem('yatzy.dev'))));
  // C misses the end of the game, the next one starts, C still gets the finished game
  await C.evaluate(() => { window.__netPush = () => {}; });
  await A.evaluate(() => { ALL.forEach(c => { game.scores[0][c.id] ??= 0; game.scores[1][c.id] ??= 0; }); game.roll = newRoll(); changed(); });
  await w(300);
  assert.equal((await state(A)).hist, 1);
  await A.click('#again'); await w(300);
  assert.deepEqual((await state(A)).names, ['Друг', 'Вова'], 'the next game starts with the next player');
  await C.reload(); await w(500);
  assert.equal((await state(C)).hist, 1);
});

test('a seat of another Telegram account is never offered, the same account always is', async () => {
  const r = await A.evaluate(() => { myAcct = 'aaa'; const t = (h, on) => canTake([{ dev: 'x', h }], on); const out = [t('bbb', {}), t('aaa', { x: true }), t(undefined, { x: true }), t(undefined, {})]; myAcct = ''; return out; });
  assert.deepEqual(r, [false, true, false, true]);
});

test('leaving brings the local game back', async () => {
  await A.click('#nroom'); await A.click('#nleave'); await A.click('#nleave'); await w(300);
  const s = await state(A);
  assert.deepEqual(s.names, ['Вова', 'Аня']); assert.equal(s.scores[0].u1, 3);
  assert.equal(await A.evaluate(() => net), null);
  await w(300);
  assert.match(await B.textContent('#net'), /Вова не в сети/);
});

test('a room left mid-game waits under "Мои комнаты" and comes back in one tap', async () => {
  await A.click('#onl');
  assert.match(await A.textContent(`[data-room="${code}"]`), /Друг, Вова/);
  await A.click(`[data-room="${code}"]`); await w(400);
  assert.equal(await A.evaluate(() => net && net.code), code);
  assert.deepEqual((await state(A)).names, ['Друг', 'Вова']);
  assert.equal(await A.$('.sheet'), null, 'the game is on, the sheet is out of the way');
  // a room that is gone drops off the list
  await A.evaluate(c => lsSet('yatzy.rooms', [{ code: 'ZZZZZ', names: ['X'] }]), code);
  await A.click('#nroom');
  assert.equal(await A.$(`[data-room="${code}"]`), null, 'the room you are in is not listed');
  await A.click('[data-room="ZZZZZ"]'); await w(400);
  assert.match(await A.textContent('#nmsg'), /нет/);
  assert.deepEqual(await A.evaluate(() => lsGet('yatzy.rooms')), [{ code, names: ['Друг', 'Вова'] }]);
});

test('a room game ends early only when every device agrees', async () => {
  await A.click(`[data-room="${code}"]`); await w(400);
  await A.click('#nroom'); await A.click('#nstop'); await A.click('#nstop'); await w(400);
  assert.match(await A.textContent('#actions'), /Ждём: Друг/);
  assert.match(await C.textContent('#actions'), /Вова предлагает закончить/);
  assert.equal(await B.$('#syes'), null, 'a device without a seat in this game is not asked');
  // refusing keeps the game going for both
  await C.click('#sno'); await w(400);
  assert.equal(await A.$('#sno'), null); assert.equal(await C.$('#syes'), null);
  assert.ok(!(await state(A)).over);
  await A.click('#nroom'); await A.click('#nstop'); await A.click('#nstop'); await w(400);
  const before = await C.evaluate(() => history.length);
  await C.click('#syes'); await w(500);
  for (const P of [A, C]) {
    assert.ok((await state(P)).over, 'the game is over on every device');
    assert.ok(await P.evaluate(() => history[history.length - 1].early), 'and goes to the history as finished early');
  }
  assert.equal(await C.evaluate(() => history.length), before + 1);
});

test('a seat remembers the Telegram account that sits in it and cannot be taken by another', async () => {
  const room = await C.evaluate(() => net && net.code);
  assert.ok(room);
  await C.evaluate(() => { myAcct = 'acct1'; stampSeat(net.code); }); await w(300);
  const st = JSON.parse(env.rooms[room].state), bdev = await C.evaluate(() => DEV);
  assert.ok(st.players.filter(p => p.dev === bdev).every(p => p.h === 'acct1'));
  const pid = st.players.find(p => p.dev === bdev).id;
  const err = await A.evaluate(([c, pid]) => reclaimSeat(c, pid).then(() => '', e => e.message), [room, pid]);
  assert.match(err, /другим аккаунтом/);
  await C.evaluate(() => { myAcct = ''; });
});
