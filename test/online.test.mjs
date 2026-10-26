/* Online room tests: the server's room logic (server/src/room.js) driven by
   pretend phones, with a controllable clock. Joining and hosting, seats and
   computer players, private views, dropped connections, leaving, playing
   again, and restarting the server mid-game. Run: node test/online.test.mjs */
import { RoomCore, PROTOCOL, cleanName } from '../server/src/room.js';

const CT = globalThis.CT;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

/* A pretend server: messages are recorded, time only moves when we say. */
function makeIo(seed) {
  let a = seed || 7;
  const io = {
    t: 5000000, sent: [], closed: [], saves: 0,
    send(connId, msg) { io.sent.push({ connId, msg: JSON.parse(JSON.stringify(msg)) }); },
    close(connId, code, reason) { io.closed.push({ connId, code, reason }); },
    bind() {},
    now() { return io.t; },
    random() { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; },
    clock(startAt) {
      const c = { base: startAt || 0, since: io.t, running: true };
      c.now = () => c.running ? c.base + (io.t - c.since) : c.base;
      c.pause = () => { if (c.running) { c.base = c.now(); c.running = false; } };
      c.resume = () => { if (!c.running) { c.since = io.t; c.running = true; } };
      return c;
    },
    wake() {},
    persist() { io.saves++; }
  };
  return io;
}

function setup(seed) {
  const io = makeIo(seed);
  const core = new RoomCore(io, null);
  core.create('TEST');
  return { io, core };
}
function join(core, connId, token, name, extra) {
  core.open(connId);
  core.message(connId, Object.assign({ t: 'hello', v: PROTOCOL, token: token, name: name }, extra || {}));
}
const T = n => ('token-' + n + '-xxxxxxxxxxxxxxxx').slice(0, 24);
const to = (io, connId, type) => io.sent.filter(s => s.connId === connId && (!type || s.msg.t === type)).map(s => s.msg);
const last = (io, connId, type) => { const all = to(io, connId, type); return all[all.length - 1]; };
function run(core, io, ms) { for (let t = 0; t < ms; t += 50) { io.t += 50; core.tick(); } }

/* Pretend people play their own seats with the computer player's logic, using only what they're sent. */
function playFor(core, io, connIds, maxMs) {
  const memory = {};
  for (let t = 0; t < maxMs && core.room.phase === 'playing'; t += 50) {
    io.t += 50;
    core.tick();
    connIds.forEach(c => {
      const st = last(io, c, 'state');
      if (!st) return;
      const m = core.member(core.conns.get(c));
      if (!m || !m.pid) return;
      const v = core.session.view(m.pid, { events: false });
      const mode = core.session.mode;
      const intent = mode.bot.intent(v);
      if (!intent || io.random() < 0.6) return;
      const action = mode.bot.decide(v, memory[c] || (memory[c] = {}), () => io.random());
      if (action) core.message(c, { t: 'act', id: t, type: action.type, payload: action.payload });
    });
  }
}

test('names are tidied and kept short', () => {
  eq(cleanName('  Odane   W  '), 'Odane W');
  eq(cleanName('<b>Tess</b>\n'), 'bTess/b');
  eq(cleanName('A very long name indeed'), 'A very long name');
});

test('the creator hosts and picks the game; others join', () => {
  const { io, core } = setup();
  join(core, 'a', T(1), 'Odane', { mode: 'donkey', options: { passTime: '10' } });
  const w = last(io, 'a', 'welcome');
  eq([w.code, w.you, w.protocol], ['TEST', 1, PROTOCOL]);
  assert(w.engines.burns && w.engines.donkey, 'engine versions are sent');
  eq([core.room.mode, core.room.size, core.room.options.passTime, core.room.host], ['donkey', 4, '10', 1]);
  join(core, 'b', T(2), 'Odane');
  const room = last(io, 'a', 'room').room;
  eq(room.members.map(m => m.name), ['Odane', 'Odane 2'], 'the same name gets a number');
  eq(room.host, 1);
  assert(!JSON.stringify(room).includes('token'), 'tokens are never sent to anyone');
});

test('only the host changes the game; the seats follow the mode', () => {
  const { io, core } = setup();
  join(core, 'a', T(1), 'Host', { mode: 'burns', size: 3 });
  join(core, 'b', T(2), 'Guest');
  core.message('b', { t: 'setup', mode: 'donkey' });
  eq(core.room.mode, 'burns');
  assert(last(io, 'b', 'notice').message.includes('host'));
  core.message('a', { t: 'setup', size: 6, options: { flush: 'on' } });
  eq([core.room.size, core.room.options.flush], [6, 'on']);
  core.message('a', { t: 'setup', mode: 'donkey' });
  eq([core.room.mode, core.room.size], ['donkey', 4], 'Donkey always seats four');
  core.message('a', { t: 'setup', mode: 'burns', size: 9 });
  eq(core.room.size, 6, 'never more than the mode allows');
});

test('starting seats people in order and computer players in the rest', () => {
  const { io, core } = setup();
  join(core, 'a', T(1), 'Mia', { mode: 'donkey' });
  join(core, 'b', T(2), 'Kofi');
  core.message('b', { t: 'start' });
  eq(core.room.phase, 'lobby', 'a guest can’t start');
  core.message('a', { t: 'start' });
  eq(core.room.phase, 'playing');
  const players = core.session.state.players;
  eq(players.map(p => p.isBot), [false, false, true, true]);
  eq(players.slice(0, 2).map(p => p.name), ['Mia', 'Kofi']);
  const names = players.map(p => p.name.toLowerCase());
  eq(new Set(names).size, 4, 'computer players never share a name with anyone');
  const sa = last(io, 'a', 'state'), sb = last(io, 'b', 'state');
  eq([sa.view.me, sb.view.me], ['p0', 'p1']);
  assert(sa.reset && sa.fresh, 'a new game starts fresh');
  eq(last(io, 'a', 'room').room.bots.length, 2);
});

test('everyone only ever receives their own cards', () => {
  const { io, core } = setup(11);
  join(core, 'a', T(1), 'A', { mode: 'burns', size: 3 });
  join(core, 'b', T(2), 'B');
  core.message('a', { t: 'start' });
  // every view each phone was sent shows that phone's own hand, as it was at that moment
  let checked = 0;
  const check = () => {
    ['a', 'b'].forEach(c => {
      const m = core.member(core.conns.get(c));
      const st = last(io, c, 'state');
      eq(st.view.me, m.pid);
      eq(st.view.hand.map(x => x.id), core.session.state.players.find(p => p.id === m.pid).hand.map(x => x.id), 'own hand');
      st.view.events.forEach(e => { if (e.secret) throw new Error('a secret was sent'); });
      checked++;
    });
  };
  const memory = {};
  for (let t = 0; t < 200000 && core.room.phase === 'playing'; t += 50) {
    io.t += 50;
    core.tick();
    ['a', 'b'].forEach(c => {
      const m = core.member(core.conns.get(c));
      const v = core.session.view(m.pid, { events: false });
      const action = core.session.mode.bot.intent(v) && io.random() < 0.3 ? core.session.mode.bot.decide(v, memory[c] || (memory[c] = {}), () => io.random()) : null;
      if (action) core.message(c, { t: 'act', id: t, type: action.type, payload: action.payload });
    });
    if (t % 1000 === 0) check();
  }
  eq(core.room.phase, 'over', 'the game finished');
  assert(checked > 20);
  const other = to(io, 'a').map(x => JSON.stringify(x)).join('\n');
  assert(!other.includes(T(2)), 'nobody sees anyone else’s token');
});

test('a whole game of Donkey with two people and two computer players', () => {
  const { io, core } = setup(5);
  join(core, 'a', T(1), 'Odane', { mode: 'donkey' });
  join(core, 'b', T(2), 'Tess');
  core.message('a', { t: 'start' });
  playFor(core, io, ['a', 'b'], 900000);
  eq(core.room.phase, 'over');
  eq(last(io, 'b', 'room').room.phase, 'over', 'everyone hears the game is over');
  eq(last(io, 'a', 'state').view.phase, 'over');
});

test('a dropped connection: the computer plays the seat, and gives it back', () => {
  const { io, core } = setup();
  join(core, 'a', T(1), 'A', { mode: 'donkey' });
  join(core, 'b', T(2), 'B');
  core.message('a', { t: 'start' });
  run(core, io, 500);
  core.disconnect('b');
  const mb = core.member(2);
  run(core, io, 3000);
  assert(!core.player('p1').isBot, 'not straight away');
  run(core, io, 3500);
  assert(core.player('p1').isBot && mb.computer, 'after a few seconds, the computer takes over');
  assert(last(io, 'a', 'room').room.members.find(m => m.id === 2).computer, 'everyone is told');
  join(core, 'b2', T(2), 'B');
  assert(!core.player('p1').isBot && !mb.computer, 'back in their seat');
  const st = to(io, 'b2', 'state')[0];
  assert(st.reset && !st.fresh, 'they get the whole table again');
  eq(st.view.me, 'p1');
});

test('nobody at the table connected: the game waits for them', () => {
  const { io, core } = setup();
  join(core, 'a', T(1), 'A', { mode: 'burns', size: 2 });
  core.message('a', { t: 'start' });
  run(core, io, 1000);
  core.disconnect('a');
  const before = core.session.now();
  run(core, io, 60000);
  eq(core.session.now(), before, 'the game clock stopped');
  join(core, 'a2', T(1), 'A');
  run(core, io, 1000);
  assert(core.session.now() > before, 'and runs again when they’re back');
});

test('the same person on a second device takes over from the first', () => {
  const { io, core } = setup();
  join(core, 'a', T(1), 'A');
  join(core, 'a2', T(1), 'A');
  eq(last(io, 'a', 'error').code, 'replaced');
  assert(io.closed.some(c => c.connId === 'a'));
  eq(core.active().length, 1);
});

test('leaving: in the lobby you’re gone; in a game the computer plays on', () => {
  const { io, core } = setup();
  join(core, 'a', T(1), 'Host', { mode: 'donkey' });
  join(core, 'b', T(2), 'B');
  join(core, 'c', T(3), 'C');
  core.message('c', { t: 'leave' });
  eq(core.active().map(m => m.name), ['Host', 'B']);
  eq(last(io, 'c', 'bye').t, 'bye');
  core.message('a', { t: 'start' });
  core.message('a', { t: 'leave' });
  eq(core.room.host, 2, 'the host hands over');
  assert(core.player('p0').isBot, 'the computer plays out the host’s seat');
  playFor(core, io, ['b'], 900000);
  eq(core.room.phase, 'over');
  core.message('b', { t: 'start' });
  eq(core.room.gameNo, 2, 'the new host plays again');
  eq(core.session.state.players.map(p => p.isBot), [false, true, true, true]);
  eq(core.session.state.players[0].name, 'B');
});

test('play again keeps the room; back to the lobby lets the host change the game', () => {
  const { io, core } = setup(3);
  join(core, 'a', T(1), 'A', { mode: 'donkey' });
  core.message('a', { t: 'start' });
  playFor(core, io, ['a'], 900000);
  eq(core.room.phase, 'over');
  core.message('a', { t: 'lobby' });
  eq([core.room.phase, core.session], ['lobby', null]);
  core.message('a', { t: 'setup', mode: 'burns', size: 2 });
  core.message('a', { t: 'start' });
  eq([core.room.mode, core.session.state.players.length, core.room.gameNo], ['burns', 2, 2]);
});

test('the server can restart mid-game and carry on', () => {
  const { io, core } = setup(9);
  join(core, 'a', T(1), 'A', { mode: 'donkey' });
  join(core, 'b', T(2), 'B');
  core.message('a', { t: 'start' });
  run(core, io, 4000);
  const snap = JSON.parse(JSON.stringify(core.snapshot()));
  const gameTime = snap.session.clock;
  const hands = core.session.state.players.map(p => p.hand.map(c => c.id).join(' '));
  const again = new RoomCore(io, snap);
  eq(again.room.phase, 'playing');
  eq(again.session.state.players.map(p => p.hand.map(c => c.id).join(' ')), hands);
  io.t += 30000;
  eq(again.session.now(), gameTime, 'the clock waits while nobody is back');
  join(again, 'a2', T(1), 'A');
  join(again, 'b2', T(2), 'B');
  eq(last(io, 'a2', 'state').view.me, 'p0');
  playFor(again, io, ['a2', 'b2'], 900000);
  eq(again.room.phase, 'over');
});

test('refusals: old apps, unknown rooms, full rooms, bad tokens', () => {
  const io = makeIo();
  const empty = new RoomCore(io, null);
  empty.open('x');
  eq(last(io, 'x', 'error').code, 'no-room');
  const { io: io2, core } = setup();
  core.open('old');
  core.message('old', { t: 'hello', v: 0, token: T(9), name: 'Old' });
  eq(last(io2, 'old', 'error').code, 'update');
  core.open('bad');
  core.message('bad', { t: 'hello', v: PROTOCOL, token: 'short', name: 'X' });
  eq(last(io2, 'bad', 'error').code, 'bad-hello');
  for (let i = 1; i <= 6; i++) join(core, 'c' + i, T(i), 'P' + i);
  join(core, 'c7', T(7), 'P7');
  eq(last(io2, 'c7', 'error').code, 'full');
  eq(core.active().length, 6);
});

test('a host who has gone quiet hands the room to someone who’s here', () => {
  const { io, core } = setup();
  join(core, 'a', T(1), 'Host');
  join(core, 'b', T(2), 'B');
  core.disconnect('a');
  run(core, io, 30000);
  eq(core.room.host, 1, 'not straight away');
  run(core, io, 20000);
  eq(core.room.host, 2);
  run(core, io, 80000);
  eq(core.active().map(m => m.name), ['B'], 'someone gone two minutes comes off the lobby list');
});

test('Donkey online: the race uses the time each phone measured', () => {
  const { io, core } = setup(21);
  join(core, 'a', T(1), 'A', { mode: 'donkey' });
  core.message('a', { t: 'start' });
  const s = core.session.state;
  // deal a computer player four Kings
  const card = id => ({ id, rank: id.slice(0, -1), suit: id.slice(-1) });
  const rest = s.players.flatMap(p => p.hand).filter(c => c.rank !== 'K');
  s.players[1].hand = ['KS', 'KH', 'KC', 'KD'].map(card);
  [0, 2, 3].forEach((i, k) => { s.players[i].hand = rest.slice(k * 4, k * 4 + 4); });
  for (let t = 0; t < 30000 && s.phase !== 'race'; t += 50) { io.t += 50; core.tick(); }
  eq(s.phase, 'race');
  io.t += 900;
  core.message('a', { t: 'act', id: 1, type: 'react', payload: { ms: 240 } });
  const res = last(io, 'a', 'result');
  eq([res.id, res.res.ok, res.res.ms], [1, true, 240]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
