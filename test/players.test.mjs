/* Players and friends on the server (server/src/players.js): profiles and
   friend codes, adding and removing friends both ways, stats kept tidy,
   limits; and the codes rooms show for each person in them.
   Run: node test/players.test.mjs */
import { Directory, idFor, codeFor, cleanCode, cleanStats, FRIENDS_MAX } from '../server/src/players.js';
import { RoomCore } from '../server/src/room.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

/* Storage as the Durable Object gives it, in memory; values are copied in and out as they'd be stored. */
function memory() {
  const m = new Map();
  const copy = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  return {
    map: m,
    async get(k) { return copy(m.get(k)); },
    async getMany(keys) { const out = new Map(); keys.forEach(k => { if (m.has(k)) out.set(k, copy(m.get(k))); }); return out; },
    async put(k, v) { m.set(k, copy(v)); }
  };
}
const T = n => ('token-' + n + '-xxxxxxxxxxxxxxxxxxxxxxxx').slice(0, 30);
function setup() {
  let t = 1000000;
  const store = memory();
  const dir = new Directory(store, () => t);
  return { dir, store, tick: ms => { t += ms; } };
}

await test('friend codes: eight characters, the same for the same phone, unlike anyone else’s', async () => {
  const a = codeFor(idFor(T(1))), b = codeFor(idFor(T(1))), c = codeFor(idFor(T(2)));
  assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(a), a);
  eq(a, b);
  assert(a !== c);
  eq(idFor(T(1)).length, 64, 'the id is a full hash');
  assert(!idFor(T(1)).includes(T(1)), 'nothing of the token in it');
  eq(cleanCode(' k7pq-2mxd '), 'K7PQ2MXD');
  eq(codeFor('ffffffffff'), '99999999', 'all ones: the last character');
  eq(codeFor('0000000000'), 'AAAAAAAA', 'all zeros: the first');
});

await test('a player: made on first contact, named, with tidy stats', async () => {
  const { dir } = setup();
  eq((await dir.handle('short', {})).status, 401, 'a token that isn’t one');
  let r = await dir.handle(T(1), {});
  eq([r.status, r.body.you.name, r.body.friends], [200, 'Player', []]);
  eq(r.body.you.code, codeFor(idFor(T(1))));
  r = await dir.handle(T(1), { name: '  Odane <b>  the‮ great ', stats: {
    burns: { played: 10, won: 4, sets: 31, bad: -2, nan: NaN, big: 1e12, text: 'x', online: { played: 3, won: 1, junk: 'y' } },
    'Not A Mode': { played: 1 },
    bull: 'nope'
  } });
  eq(r.body.you.name, 'Odane b the grea', 'tidied and kept short');
  const r2 = await dir.handle(T(2), { add: r.body.you.code });
  eq(r2.body.friends[0].stats, { burns: { played: 10, won: 4, sets: 31, online: { played: 3, won: 1 } } }, 'what the friend sees');
  eq(cleanStats({ xx: { a: 1.23456 } }), { xx: { a: 1.23 } });
  eq(cleanStats({ burns: { played: 1, filler: 'x'.repeat(20000) } }), { burns: { played: 1 } });
});

await test('adding a friend by code: on both lists at once; again, or with a dash and lower case, is the same', async () => {
  const { dir } = setup();
  const a = (await dir.handle(T(1), { name: 'Odane' })).body.you;
  const b = (await dir.handle(T(2), { name: 'Tess' })).body.you;
  let r = await dir.handle(T(1), { add: b.code.toLowerCase().slice(0, 4) + '-' + b.code.slice(4).toLowerCase() });
  eq([r.body.added, r.body.friends.map(f => f.name), r.body.error], [{ code: b.code, name: 'Tess' }, ['Tess'], undefined]);
  r = await dir.handle(T(2), {});
  eq(r.body.friends.map(f => f.code), [a.code], 'Tess sees Odane too');
  r = await dir.handle(T(1), { add: b.code });
  eq(r.body.friends.length, 1, 'no double');
  r = await dir.handle(T(2), { add: a.code });
  eq([r.body.friends.length, r.body.added.name], [1, 'Odane'], 'adding back changes nothing');
});

await test('codes that don’t work: your own, nobody’s, too short', async () => {
  const { dir } = setup();
  const a = (await dir.handle(T(1), {})).body.you;
  let r = await dir.handle(T(1), { add: a.code });
  eq([r.status, r.body.error], [200, 'self']);
  assert(/your own/.test(r.body.message));
  r = await dir.handle(T(1), { add: 'ZZZZ2222' });
  eq(r.body.error, 'no-player');
  r = await dir.handle(T(1), { add: 'ABC' });
  eq(r.body.error, 'no-player');
  eq(r.body.friends, [], 'and the rest of the answer as usual');
});

await test('removing a friend takes both of you off each other’s list', async () => {
  const { dir } = setup();
  const b = (await dir.handle(T(2), { name: 'Tess' })).body.you;
  const c = (await dir.handle(T(3), { name: 'Ravi' })).body.you;
  await dir.handle(T(1), { add: b.code });
  await dir.handle(T(1), { add: c.code });
  let r = await dir.handle(T(1), { remove: b.code });
  eq(r.body.friends.map(f => f.name), ['Ravi']);
  eq((await dir.handle(T(2), {})).body.friends, [], 'gone from Tess’s list too');
  eq((await dir.handle(T(3), {})).body.friends.length, 1, 'Ravi still has a friend');
  r = await dir.handle(T(1), { remove: 'ZZZZ2222' });
  eq(r.body.friends.length, 1, 'removing nobody: nothing changes');
});

await test('friends see each other’s latest name and stats, newest first by name', async () => {
  const { dir, tick } = setup();
  const b = (await dir.handle(T(2), { name: 'Tess' })).body.you;
  const c = (await dir.handle(T(3), { name: 'Abe' })).body.you;
  await dir.handle(T(1), { add: b.code });
  await dir.handle(T(1), { add: c.code });
  tick(5000);
  await dir.handle(T(2), { name: 'Tess B', stats: { bull: { played: 2, won: 2 } } });
  const r = await dir.handle(T(1), {});
  eq(r.body.friends.map(f => f.name), ['Abe', 'Tess B'], 'by name');
  eq(r.body.friends[1].stats, { bull: { played: 2, won: 2 } });
  assert(r.body.friends[1].updated > r.body.friends[0].updated, 'when they last changed');
});

await test('limits: a hundred friends each, and not too many requests at once', async () => {
  const { dir, tick } = setup();
  const me = T('me');
  for (let i = 0; i < FRIENDS_MAX; i++) {
    const code = (await dir.handle(T('f' + i), {})).body.you.code;
    tick(2000);
    const r = await dir.handle(me, { add: code });
    assert(!r.body.error, 'friend ' + i + ': ' + r.body.error);
  }
  const extra = (await dir.handle(T('extra'), {})).body.you.code;
  tick(2000);
  eq((await dir.handle(me, { add: extra })).body.error, 'full');
  tick(2000);
  eq((await dir.handle(T('extra'), { add: (await dir.handle(me, {})).body.you.code })).body.error, 'their-full');
  // forty requests a minute from one player
  const { dir: d2 } = setup();
  let last;
  for (let i = 0; i < 41; i++) last = await d2.handle(T(9), {});
  eq([last.status, last.body.error], [429, 'busy']);
});

await test('two players whose codes would be the same: the second gets a longer one', async () => {
  const { dir, store } = setup();
  const id = idFor(T(1));
  await store.put('c:' + codeFor(id), 'someone-else');
  const r = await dir.handle(T(1), {});
  eq(r.body.you.code, codeFor(id, 10));
  const r2 = await dir.handle(T(2), { add: codeFor(id, 10) });
  eq(r2.body.added.code, codeFor(id, 10), 'and can be added with it');
});

await test('rooms show each person’s friend code (the same one), never their token', async () => {
  const io = {
    t: 1, sent: [], send(c, m) { io.sent.push({ c, m: JSON.parse(JSON.stringify(m)) }); }, close() {}, bind() {}, now() { return io.t; },
    random() { return 0.5; }, clock() { return { now: () => 0, pause() {}, resume() {} }; }, wake() {}, persist() {}
  };
  const core = new RoomCore(io, null);
  core.create('TEST');
  const all = { burns: 3, donkey: 1, bull: 2, stripme: 2 };
  [[1, 'Odane'], [2, 'Tess']].forEach(([n, name], i) => {
    core.open('c' + n);
    core.message('c' + n, Object.assign({ t: 'hello', v: 1, token: T(n), name, engines: all }, i ? {} : { mode: 'bull' }));
  });
  const room = io.sent.filter(s => s.m.t === 'room').pop().m.room;
  eq(room.members.map(m => m.code), [codeFor(idFor(T(1))), codeFor(idFor(T(2)))]);
  assert(!JSON.stringify(io.sent).includes(T(1)), 'no token goes out');
  // a room saved before friend codes: the code is worked out when they come back
  const snap = JSON.parse(JSON.stringify(core.snapshot()));
  snap.room.members.forEach(m => { delete m.code; });
  const again = new RoomCore(io, snap);
  again.open('c9');
  again.message('c9', { t: 'hello', v: 1, token: T(1), name: 'Odane', engines: all });
  const after = io.sent.filter(s => s.m.t === 'room').pop().m.room;
  eq(after.members.find(m => m.name === 'Odane').code, codeFor(idFor(T(1))));
});

await test('“I’ve added you as a friend” goes to that person only, and not too often', async () => {
  const io = {
    t: 1, sent: [], send(c, m) { io.sent.push({ c, m: JSON.parse(JSON.stringify(m)) }); }, close() {}, bind() {}, now() { return io.t; },
    random() { return 0.5; }, clock() { return { now: () => 0, pause() {}, resume() {} }; }, wake() {}, persist() {}
  };
  const core = new RoomCore(io, null);
  core.create('TEST');
  const all = { burns: 3, donkey: 1, bull: 2, stripme: 2 };
  [[1, 'Odane'], [2, 'Tess'], [3, 'Ravi']].forEach(([n, name], i) => {
    core.open('c' + n);
    core.message('c' + n, Object.assign({ t: 'hello', v: 1, token: T(n), name, engines: all }, i ? {} : { mode: 'bull' }));
  });
  const ids = io.sent.filter(s => s.m.t === 'room').pop().m.room.members.map(m => m.id);
  const told = () => io.sent.filter(s => s.m.t === 'friend').map(s => s.c + ':' + s.m.from + ':' + s.m.name);
  io.sent = [];
  core.message('c1', { t: 'friend', to: ids[1] });
  eq(told(), ['c2:' + ids[0] + ':Odane'], 'Tess is told, nobody else');
  core.message('c1', { t: 'friend', to: ids[2] });
  eq(told().length, 1, 'a second one straight after: no');
  io.t += 1000;
  core.message('c1', { t: 'friend', to: ids[2] });
  core.message('c1', { t: 'friend', to: ids[0] });
  core.message('c1', { t: 'friend', to: 999 });
  io.t += 1000;
  core.message('c1', { t: 'friend', to: ids[0] });
  eq(told(), ['c2:' + ids[0] + ':Odane', 'c3:' + ids[0] + ':Odane'], 'then Ravi; never yourself or someone not here');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
