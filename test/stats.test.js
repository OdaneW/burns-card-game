/* Stats counted during a game (CT.tally, mode.stats): simulated all-computer
   games of every mode, checked against what actually happened, plus saving,
   restoring and what each player's view carries. Run: node test/stats.test.js */
'use strict';
const path = require('path');
['src/engine/core.js', 'src/engine/session.js',
 'src/modes/burns/rules.js', 'src/modes/burns/bot.js', 'src/modes/donkey/rules.js', 'src/modes/donkey/bot.js',
 'src/modes/bull/rules.js', 'src/modes/bull/bot.js', 'src/modes/stripme/rules.js', 'src/modes/stripme/bot.js']
  .forEach(f => require(path.join(__dirname, '..', f)));
const CT = globalThis.CT;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

const NAMES = ['Ann', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay'];
/* A whole game between computer players, keeping every event (the state only keeps the last few hundred). */
function play(modeId, n, options, seed) {
  const players = NAMES.slice(0, n).map((name, i) => ({ id: 'p' + i, name, isBot: true }));
  const clock = new CT.ManualClock(0);
  const session = new CT.Session({ modeId, players, options, seed, clock, botSeed: seed * 7 + 1 });
  const s = session.state, all = [];
  let seen = 0, ticks = 0;
  const collect = () => { s.events.forEach(e => { if (e.seq > seen) { all.push(e); seen = e.seq; } }); };
  collect();
  while (s.phase !== 'over' && ticks++ < 3000000) { clock.advance(50); session.tick(); collect(); }
  if (s.phase !== 'over') throw new Error(modeId + ' game ' + seed + ' did not finish');
  return { session, s, events: all };
}
const sum = (s, key) => Object.values(s.tally).reduce((a, t) => a + (t[key] || 0), 0);
const of = (s, pid, key) => (s.tally[pid] || {})[key] || 0;

test('every mode lists its stats, and only names the counts it keeps', () => {
  CT.listModes().forEach(m => {
    assert(m.stats && typeof m.stats.count === 'function', m.id + ' counts stats');
    assert(m.stats.show.length >= 3, m.id + ' shows a few');
    m.stats.show.forEach(x => {
      assert(x.key && x.label, m.id + ': a key and a label');
      if (x.rate) assert(m.stats.show.some(y => y.key === x.rate[0]) && m.stats.show.some(y => y.key === x.rate[1]), m.id + ': a rate of counts it keeps');
    });
  });
});

test('Burns: sets won match the sets, and a Flush counts for whoever had it', () => {
  for (let g = 0; g < 12; g++) {
    const { s, events } = play('burns', 4, { flush: 'on' }, 100 + g);
    const sets = events.filter(e => e.type === 'setWon' && e.player);
    eq(sum(s, 'sets'), sets.length, 'game ' + g + ': sets');
    s.players.forEach(p => eq(of(s, p.id, 'sets'), sets.filter(e => e.player === p.id).length, 'game ' + g + ' ' + p.id));
    const flushed = events.filter(e => e.type === 'flush').flatMap(e => e.players);
    eq(sum(s, 'flushWins'), flushed.length, 'game ' + g + ': flushes');
  }
});

test('Real Burns: one player burned a game, and every slap given is a slap taken', () => {
  for (let g = 0; g < 8; g++) {
    const { s, events } = play('burns', 4, { real: 'on' }, 200 + g);
    const res = events.filter(e => e.type === 'penaltyResult');
    if (s.winReason !== 'real') continue;
    eq(sum(s, 'burned'), 1, 'game ' + g + ': burned');
    eq(of(s, s.loser, 'burned'), 1, 'the loser');
    eq(sum(s, 'slapsGiven'), sum(s, 'slapsTaken'), 'game ' + g + ': given = taken');
    eq(of(s, s.loser, 'slapsTaken'), res.reduce((a, e) => a + e.soft + e.hard, 0), 'game ' + g + ': the loser took them all');
  }
});

test('Donkey: letters taken match the final letters, the Donkey is counted, put-downs are real times', () => {
  for (let g = 0; g < 10; g++) {
    const { s, events } = play('donkey', 4, {}, 300 + g);
    s.players.forEach(p => eq(of(s, p.id, 'letters'), p.letters, 'game ' + g + ' ' + p.id + ' letters'));
    eq(sum(s, 'donkeys'), s.players.filter(p => p.letters >= 6).length, 'game ' + g + ': donkeys');
    eq(sum(s, 'fours'), events.filter(e => e.type === 'declare').length, 'game ' + g + ': fours');
    s.players.forEach(p => {
      const times = events.filter(e => e.type === 'react' && e.player === p.id).map(e => e.ms);
      if (times.length) eq(of(s, p.id, 'bestReact'), Math.min(...times), 'game ' + g + ' ' + p.id + ' fastest');
    });
  }
});

test('Bull: every call counted once; right calls are the bluffs caught', () => {
  for (let g = 0; g < 10; g++) {
    const { s, events } = play('bull', 4, {}, 400 + g);
    const calls = events.filter(e => e.type === 'bull');
    eq(sum(s, 'calls'), calls.length, 'game ' + g + ': calls');
    eq(sum(s, 'callsRight'), calls.filter(e => e.lie).length, 'game ' + g + ': right');
    eq(sum(s, 'caught'), sum(s, 'callsRight'), 'game ' + g + ': caught = right calls');
    eq(sum(s, 'piles'), events.filter(e => e.type === 'pickup').length, 'game ' + g + ': piles');
  }
});

test('Strip-Me: every round has a winner and a loser; garments follow the losses', () => {
  for (let g = 0; g < 6; g++) {
    const { s } = play('stripme', 2, { mode: 'strip', losses: '2', timer: '60' }, 500 + g);
    eq(sum(s, 'roundsWon'), s.round, 'game ' + g + ': rounds won');
    eq(sum(s, 'roundsLost'), s.round, 'game ' + g + ': rounds lost');
    s.players.forEach(p => eq(of(s, p.id, 'garmentsLost'), p.lost, 'game ' + g + ' ' + p.id));
    eq(sum(s, 'garmentsTaken'), sum(s, 'garmentsLost'));
  }
  const q = play('stripme', 2, { mode: 'quick', timer: '60' }, 600).s;
  eq([sum(q, 'roundsWon'), sum(q, 'garmentsTaken')], [1, 0], 'Quick Play: one round, no garments');
});

test('a view carries only that player’s own stats, as a copy', () => {
  const { session, s } = play('bull', 3, {}, 700);
  const v = session.view('p1', { events: false });
  eq(v.tally, s.tally.p1 || {});
  v.tally.calls = 999;
  assert(of(s, 'p1', 'calls') !== 999, 'changing the view changes nothing');
  assert(!JSON.stringify(v).includes('"p0":{'), 'nobody else’s');
});

test('saved and restored mid-game: counting carries on, nothing counted twice', () => {
  const players = NAMES.slice(0, 4).map((name, i) => ({ id: 'p' + i, name, isBot: true }));
  const clock = new CT.ManualClock(0);
  const a = new CT.Session({ modeId: 'bull', players, options: {}, seed: 31, clock, botSeed: 9 });
  for (let i = 0; i < 1500; i++) { clock.advance(50); a.tick(); }
  const saved = JSON.parse(JSON.stringify(a.serialize()));
  assert(sum(a.state, 'calls') > 0, 'some calls by now');
  const b = CT.Session.restore(saved);
  eq(JSON.stringify(b.state.tally), JSON.stringify(a.state.tally), 'the same counts after restoring');
  const clockB = new CT.ManualClock(saved.clock);
  b.clock = clockB;
  for (let i = 0; i < 400000 && b.state.phase !== 'over'; i++) { clockB.advance(50); b.tick(); }
  eq(b.state.phase, 'over');
  eq(sum(b.state, 'caught'), sum(b.state, 'callsRight'), 'still consistent to the end');
  assert(sum(b.state, 'calls') >= sum(a.state, 'calls'), 'and still counting');
  // a game saved before there were stats: counting starts now, old events aren't counted
  const old = JSON.parse(JSON.stringify(saved.state));
  delete old.tally; delete old.tallySeq;
  const c = new CT.Session({ modeId: 'bull', state: old, clock: new CT.ManualClock(saved.clock) });
  eq([JSON.stringify(c.state.tally), c.state.tallySeq], ['{}', old.seq], 'nothing from before');
});

test('a mode without stats, or a count that breaks, never stops a game', () => {
  const Bull = CT.getMode('bull');
  const broken = Object.assign({}, Bull, { stats: { count() { throw new Error('oops'); }, show: [] } });
  const players = NAMES.slice(0, 3).map((name, i) => ({ id: 'p' + i, name, isBot: true }));
  const clock = new CT.ManualClock(0);
  const s = new CT.Session({ mode: broken, players, options: {}, seed: 5, clock });
  for (let i = 0; i < 400000 && s.state.phase !== 'over'; i++) { clock.advance(50); s.tick(); }
  eq(s.state.phase, 'over');
  const none = Object.assign({}, Bull, { stats: null });
  const t = new CT.Session({ mode: none, players, options: {}, seed: 5, clock: new CT.ManualClock(0) });
  eq(t.view('p0', { events: false }).tally, {});
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
