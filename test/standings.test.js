/* Each phone's record of its games and the friends leaderboard
   (src/engine/standings.js). Run: node test/standings.test.js */
'use strict';
const path = require('path');
['src/engine/core.js', 'src/engine/session.js', 'src/engine/standings.js',
 'src/modes/burns/rules.js', 'src/modes/burns/bot.js', 'src/modes/donkey/rules.js', 'src/modes/donkey/bot.js',
 'src/modes/bull/rules.js', 'src/modes/bull/bot.js', 'src/modes/stripme/rules.js', 'src/modes/stripme/bot.js']
  .forEach(f => require(path.join(__dirname, '..', f)));
const CT = globalThis.CT;
const S = CT.Standings;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

const Bull = CT.getMode('bull'), Donkey = CT.getMode('donkey'), Burns = CT.getMode('burns');

test('a game into a record: games, wins, streaks, and the game’s counts added up', () => {
  const rec = {};
  S.addGame(rec, true, { calls: 3, callsRight: 2, piles: 1 }, Bull);
  S.addGame(rec, true, { calls: 1, caught: 1 }, Bull);
  S.addGame(rec, false, {}, Bull);
  S.addGame(rec, true, { calls: 2, callsRight: 2 }, Bull);
  eq(rec, { played: 4, won: 3, streak: 1, bestStreak: 2, callsRight: 4, calls: 6, piles: 1, caught: 1 });
  assert(!('callRate' in rec), 'a rate is worked out when shown, never kept');
});

test('the fastest put-down keeps the best time; a game without one changes nothing', () => {
  const rec = {};
  S.addGame(rec, false, { bestReact: 640, letters: 2 }, Donkey);
  S.addGame(rec, false, { bestReact: 410 }, Donkey);
  S.addGame(rec, true, { bestReact: 900 }, Donkey);
  S.addGame(rec, true, {}, Donkey);
  eq([rec.bestReact, rec.letters, rec.won, rec.bestStreak], [410, 2, 2, 2]);
});

test('online games are also kept on their own; an old record (wins and Flushes only) carries on', () => {
  const all = { burns: { played: 7, won: 3, flushWins: 1 } };
  S.record(all, Burns, true, { sets: 4, flushWins: 1 }, false, 100);
  S.record(all, Burns, false, { sets: 1 }, true, 200);
  eq(all.burns, { played: 9, won: 4, flushWins: 2, streak: 0, bestStreak: 1, sets: 5, last: 200,
    online: { played: 1, won: 0, streak: 0, bestStreak: 0, sets: 1 } });
});

test('every game together: games and wins added, the best streak in any one game; online only too', () => {
  const all = {
    burns: { played: 10, won: 4, bestStreak: 3, online: { played: 2, won: 2, bestStreak: 2 } },
    bull: { played: 5, won: 1, bestStreak: 1 },
    retired: { played: 99, won: 99 }          // a game this version doesn't have
  };
  eq(S.recordFor(all, 'all', false), { played: 15, won: 5, bestStreak: 3 });
  eq(S.recordFor(all, 'all', true), { played: 2, won: 2, bestStreak: 2 });
  eq(S.recordFor(all, 'bull', true), {}, 'no online Bull yet');
  eq(S.recordFor(undefined, 'burns', false), {});
});

test('what each game ranks by: wins, win %, games, best streak, then its own', () => {
  eq(S.metrics('all').map(m => m.id), ['won', 'rate', 'played', 'bestStreak']);
  eq(S.metrics('burns').map(m => m.id), ['won', 'rate', 'played', 'bestStreak', 'sets', 'flushWins', 'slapsGiven']);
  eq(S.metrics('donkey').map(m => m.id).slice(4), ['fours', 'bestReact']);
  eq(S.metrics('bull').map(m => m.id).slice(4), ['callsRight', 'callRate']);
  eq(S.metrics('stripme').map(m => m.id).slice(4), ['roundsWon', 'garmentsTaken']);
  CT.listModes().forEach(mode => S.metrics(mode.id).forEach(m => assert(m.label && m.help && m.fmt, mode.id + ' ' + m.id)));
  const rate = S.metrics('bull').find(m => m.id === 'rate');
  eq([rate.get({ played: 4, won: 4 }), rate.get({ played: 5, won: 2 })], [null, 0.4], 'from 5 games');
  eq(rate.fmt(0.4), '40%');
  const calls = S.metrics('bull').find(m => m.id === 'callRate');
  eq([calls.get({ calls: 4, callsRight: 4 }), calls.get({ calls: 8, callsRight: 6 })], [null, 0.75], 'from 5 calls');
  const fast = S.metrics('donkey').find(m => m.id === 'bestReact');
  eq([fast.low, fast.fmt(412), fast.get({ played: 3 })], [true, '0.41 s', null]);
});

test('the leaderboard: best first, equal values share a place, anyone not counted yet goes last', () => {
  const people = [
    { name: 'Tess', stats: { bull: { played: 6, won: 3 } } },
    { name: 'You', me: true, stats: { bull: { played: 9, won: 3 } } },
    { name: 'Abe', stats: { bull: { played: 2, won: 2 } } },
    { name: 'Ravi', stats: {} }
  ];
  let b = S.standings(people, 'bull', 'won', false);
  eq(b.rows.map(r => [r.person.name, r.value, r.rank]), [['You', 3, 1], ['Tess', 3, 1], ['Abe', 2, 3], ['Ravi', null, null]]);
  b = S.standings(people, 'bull', 'rate', false);
  eq(b.rows.map(r => [r.person.name, r.rank]), [['Tess', 1], ['You', 2], ['Abe', null], ['Ravi', null]], 'win %: Abe needs 5 games');
  eq(S.summary(b.rows[2].rec, b.metric, b.rows[2].value, false), 'Win % after 5 games · 2 so far');
  eq(S.summary(b.rows[3].rec, b.metric, b.rows[3].value, true), 'No online games yet');
  eq(S.summary(b.rows[0].rec, b.metric, b.rows[0].value, false), '6 games · 3 wins');
  b = S.standings(people, 'bull', 'nonsense', false);
  eq(b.metric.id, 'won', 'an unknown metric: wins');
});

test('smaller is better for the fastest put-down', () => {
  const people = [
    { name: 'A', stats: { donkey: { played: 1, bestReact: 700 } } },
    { name: 'B', stats: { donkey: { played: 1, bestReact: 380 } } },
    { name: 'C', stats: { donkey: { played: 1 } } }
  ];
  const b = S.standings(people, 'donkey', 'bestReact', false);
  eq(b.rows.map(r => r.person.name + ':' + r.rank), ['B:1', 'A:2', 'C:null']);
  eq(S.summary(b.rows[2].rec, b.metric, b.rows[2].value, false), 'None yet');
  const rate = S.standings([{ name: 'A', stats: { bull: { played: 3, calls: 9, callsRight: 6 } } }], 'bull', 'callRate', false);
  eq(S.summary(rate.rows[0].rec, rate.metric, rate.rows[0].value, false), '6 of 9 bull calls');
});

test('the side-by-side comparison has everything: the current streak, and what isn’t ranked', () => {
  const d = S.details('bull');
  eq(d.map(m => m.id), ['won', 'rate', 'played', 'streak', 'bestStreak', 'callsRight', 'callRate', 'calls', 'caught', 'piles']);
  eq(d.filter(m => m.neutral).map(m => m.id), ['played', 'calls']);
  eq(d.filter(m => m.low).map(m => m.id), ['caught', 'piles']);
  const all = S.details('all');
  eq(all.map(m => m.id).slice(5), CT.listModes().map(m => 'wins-' + m.id));
  const mine = { bull: { played: 4, won: 1, online: { played: 1, won: 0 } } };
  eq(all.find(m => m.id === 'wins-bull').get({}, mine, false), 1);
  eq(all.find(m => m.id === 'wins-bull').get({}, mine, true), 0, 'online only');
  eq(all.find(m => m.id === 'wins-burns').get({}, mine, false), null);
});

test('a real game: what the player’s view says they did is what goes in their record', () => {
  const players = ['Ann', 'Ben', 'Cal', 'Dee'].map((name, i) => ({ id: 'p' + i, name, isBot: true }));
  const clock = new CT.ManualClock(0);
  const session = new CT.Session({ modeId: 'donkey', players, options: {}, seed: 77, clock, botSeed: 5 });
  for (let i = 0; i < 3000000 && session.state.phase !== 'over'; i++) { clock.advance(50); session.tick(); }
  const v = session.view('p2', { events: false });
  const all = {};
  S.record(all, Donkey, (v.winners || []).indexOf('p2') >= 0, v.tally, false, 1);
  const me = session.state.players.find(p => p.id === 'p2');
  eq(all.donkey.letters || 0, me.letters, 'letters');
  eq(all.donkey.played, 1);
  if (v.tally.bestReact != null) eq(all.donkey.bestReact, v.tally.bestReact);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
