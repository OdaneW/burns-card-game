/* Pass-Roun Donkey rules tests: hand-built scenarios, then hundreds of
   all-computer games checked every tick for card conservation, privacy,
   letters and placings. Run: node test/donkey.test.js */
'use strict';
const path = require('path');
['src/engine/core.js', 'src/engine/session.js', 'src/modes/donkey/rules.js', 'src/modes/donkey/bot.js']
  .forEach(f => require(path.join(__dirname, '..', f)));
const CT = globalThis.CT;
const D = CT.getMode('donkey');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

const card = id => ({ id, rank: id.slice(0, -1), suit: id.slice(-1) });
const ids = cards => cards.map(c => c.id);
const PLAYERS = [0, 1, 2, 3].map(i => ({ id: 'p' + i, name: 'P' + i, isBot: false }));
const FAST = { dealHoldMs: 0, raceDelayMs: 100, raceMs: 1000, roundHoldMs: 200, duelChoiceMs: 1000, duelHoldMs: 200, passMs: 5000 };

/* A game with chosen hands and starter, ready to pass at time 0. */
function rigged({ hands, starter, letters, timing, options } = {}) {
  const s = D.createGame({ players: PLAYERS, options, seed: 11, now: 0, timing: Object.assign({}, FAST, timing) });
  if (hands) s.players.forEach((p, i) => { p.hand = hands[i].map(card); });
  if (letters) s.players.forEach((p, i) => { p.letters = letters[i]; });
  if (starter) s.starter = starter;
  s.events = []; s.seq = 0;
  D.tick(s, 0);   // dealing → passing
  return s;
}
const act = (s, pid, type, payload, now) => D.act(s, pid, type, payload || {}, now || 0);
const P = (s, pid) => s.players.find(p => p.id === pid);

function conservation(s) {
  const all = [];
  s.players.forEach(p => p.hand.forEach(c => all.push(c.id)));
  if (s.declare) s.declare.cards.forEach(c => all.push(c.id));
  assert(all.length === 16, 'card count ' + all.length);
  assert(new Set(all).size === 16, 'duplicate cards');
  all.forEach(id => assert(/^[JQKA][SHCD]$/.test(id), 'not a picture card or ace: ' + id));
}

// Hands with no four of a kind, in seat order.
const H = [['JS', 'QS', 'KS', 'AS'], ['JH', 'QH', 'KH', 'AH'], ['JC', 'QC', 'KC', 'AC'], ['JD', 'QD', 'KD', 'AD']];

console.log('\nScenarios');

test('deal: the sixteen J, Q, K and A cards, four each, and a random starter', () => {
  const s = D.createGame({ players: PLAYERS, seed: 5, now: 0 });
  eq(s.phase, 'dealing');
  s.players.forEach(p => eq(p.hand.length, 4));
  conservation(s);
  assert(PLAYERS.some(p => p.id === s.starter), 'starter is a player');
  eq(s.options, { passTime: '15', reflexes: 'normal' }, 'defaults');
  assert(!D.tick(s, s.timing.dealHoldMs - 1), 'not before the hold ends');
  D.tick(s, s.timing.dealHoldMs);
  eq(s.phase, 'pass'); eq(s.turn, s.starter);
  const starters = new Set();
  for (let seed = 1; seed < 60; seed++) starters.add(D.createGame({ players: PLAYERS, seed, now: 0 }).starter);
  eq(starters.size, 4, 'every seat gets to start sometimes');
});

test('exactly four players', () => {
  let threw = false;
  try { D.createGame({ players: PLAYERS.slice(0, 3), seed: 1 }); } catch (e) { threw = true; }
  assert(threw, 'three players refused');
});

test('pass: only on your turn; the card goes clockwise and only giver and receiver see it', () => {
  const s = rigged({ hands: H, starter: 'p0' });
  eq(act(s, 'p1', 'pass', { cardId: 'JH' }).code, 'turn');
  eq(act(s, 'p0', 'pass', { cardId: 'JH' }).code, 'card');
  assert(act(s, 'p0', 'pass', { cardId: 'AS' }, 10).ok);
  eq(ids(P(s, 'p1').hand), ['JH', 'QH', 'KH', 'AH', 'AS']);
  eq(P(s, 'p0').hand.length, 3); eq(s.turn, 'p1');
  const seen = pid => D.view(s, pid, { sinceSeq: 0 }).events.find(e => e.type === 'pass');
  eq(seen('p0').mine.card.id, 'AS'); eq(seen('p1').mine.card.id, 'AS');
  eq(seen('p2').mine, undefined, 'p2 only sees a card go by');
  eq(seen('p3').mine, undefined);
  conservation(s);
});

test('the card travels round the circle and back to the starter', () => {
  const s = rigged({ hands: H, starter: 'p2' });
  const order = [];
  for (let i = 0; i < 4; i++) {
    const p = P(s, s.turn);
    order.push(p.id);
    assert(act(s, p.id, 'pass', { cardId: p.hand[0].id }, i * 10).ok);
  }
  eq(order, ['p2', 'p3', 'p0', 'p1']);
  eq(s.turn, 'p2'); eq(P(s, 'p2').hand.length, 4); eq(s.passes, 4);
  conservation(s);
});

test('pass timer: an idle player passes a random card', () => {
  const s = rigged({ hands: H, starter: 'p1', timing: { passMs: 1000 } });
  eq(s.turnEndsAt, 1000);
  assert(!D.tick(s, 999));
  assert(D.tick(s, 1000));
  const pass = s.events.find(e => e.type === 'pass');
  assert(pass && pass.auto && pass.from === 'p1' && pass.to === 'p2', 'random card passed on');
  eq(s.events.filter(e => e.type === 'timeout').map(e => e.player), ['p1']);
  eq(s.turn, 'p2'); eq(s.turnEndsAt, 2000, 'the next player gets a fresh limit');
});

test('pass timer: holding four of a kind, the four are put down for you', () => {
  const s = rigged({ hands: [['JS', 'JH', 'JC', 'JD'], ['QS', 'QH', 'KS', 'AS'], ['QC', 'QD', 'KH', 'AH'], ['KC', 'KD', 'AC', 'AD']], starter: 'p0', timing: { passMs: 1000 } });
  D.tick(s, 1000);
  eq(s.phase, 'declared'); eq(s.declare.player, 'p0'); eq(s.declare.rank, 'J');
  assert(s.events.find(e => e.type === 'declare').auto);
});

test('four of a kind: the spare card goes on, the four go down, then the race starts', () => {
  const s = rigged({ hands: [['KD', 'QS', 'JS', 'AS'], ['KS', 'KH', 'KC', 'QD'], ['JC', 'QC', 'AC', 'JD'], ['JH', 'QH', 'AH', 'AD']], starter: 'p0' });
  act(s, 'p0', 'pass', { cardId: 'KD' }, 10);
  const v1 = D.view(s, 'p1');
  assert(v1.canDeclare && v1.myFour === 'K', 'p1 can declare kings');
  assert(!D.view(s, 'p2').canDeclare);
  assert(act(s, 'p1', 'declare', {}, 20).ok);
  eq(s.phase, 'declared');
  eq(ids(s.declare.cards).sort(), ['KC', 'KD', 'KH', 'KS']);
  eq(s.declare.extraTo, 'p2');
  eq(ids(P(s, 'p2').hand), ['JC', 'QC', 'AC', 'JD', 'QD'], 'the spare queen went to p2');
  eq(P(s, 'p1').hand.length, 0);
  eq(D.view(s, 'p3').declare.cards.length, 4, 'the four are face up for everyone');
  eq(act(s, 'p2', 'react', {}, 50).code, 'early');
  eq(act(s, 'p2', 'pass', { cardId: 'JC' }, 50).code, 'phase', 'no more passing');
  D.tick(s, 120);
  eq(s.phase, 'race'); eq(s.race.startAt, 120); eq(s.race.racers, ['p0', 'p2', 'p3']);
  conservation(s);
});

test('a dealt four of a kind can go down at once, out of turn, with no spare', () => {
  const s = rigged({ hands: [['JS', 'QS', 'KS', 'QH'], ['JH', 'KH', 'JC', 'QC'], ['AS', 'AH', 'AC', 'AD'], ['KC', 'JD', 'QD', 'KD']], starter: 'p0' });
  assert(D.view(s, 'p2').canDeclare);
  assert(act(s, 'p2', 'declare', {}, 5).ok);
  eq(s.declare.extraTo, null); eq(s.passes, 0);
});

test('the race: the slowest to put their cards down gets the next letter', () => {
  const s = rigged({ hands: [['KD', 'QS', 'JS', 'AS'], ['KS', 'KH', 'KC', 'QD'], ['JC', 'QC', 'AC', 'JD'], ['JH', 'QH', 'AH', 'AD']], starter: 'p0' });
  act(s, 'p0', 'pass', { cardId: 'KD' }, 10);
  act(s, 'p1', 'declare', {}, 20);
  D.tick(s, 120);
  eq(act(s, 'p1', 'react', {}, 130).code, 'safe', 'the declarer is safe');
  assert(D.view(s, 'p3').canReact);
  eq(act(s, 'p3', 'react', {}, 320).ms, 200);
  eq(act(s, 'p3', 'react', {}, 330).code, 'done');
  eq(act(s, 'p0', 'react', {}, 420).place, 2);
  eq(s.phase, 'race');
  act(s, 'p2', 'react', {}, 700);
  eq(s.phase, 'roundEnd');
  eq(s.result.losers, ['p2']); eq(P(s, 'p2').letters, 1);
  eq(s.result.order.map(o => o.player + ':' + o.ms), ['p3:200', 'p0:300', 'p2:580']);
  D.tick(s, 700 + 200);
  eq(s.phase, 'dealing'); eq(s.round, 2);
  conservation(s);
});

test('race timer: anyone who never reacts counts as last (each of them gets a letter)', () => {
  const s = rigged({ hands: [['JS', 'QS', 'KS', 'QH'], ['JH', 'KH', 'JC', 'QC'], ['AS', 'AH', 'AC', 'AD'], ['KC', 'JD', 'QD', 'KD']], starter: 'p0' });
  act(s, 'p2', 'declare', {}, 0);
  D.tick(s, 100);
  act(s, 'p3', 'react', {}, 400);
  assert(!D.tick(s, 1099));
  D.tick(s, 1100);
  eq(s.phase, 'roundEnd'); eq(s.result.late, ['p0', 'p1']); eq(s.result.losers, ['p0', 'p1']);
  eq(s.players.map(p => p.letters), [1, 1, 0, 0]);
});

test('six letters ends the game; everyone else is placed by letters', () => {
  const s = rigged({ hands: [['JS', 'QS', 'KS', 'QH'], ['JH', 'KH', 'JC', 'QC'], ['AS', 'AH', 'AC', 'AD'], ['KC', 'JD', 'QD', 'KD']], starter: 'p0', letters: [5, 2, 1, 0] });
  act(s, 'p2', 'declare', {}, 0);
  D.tick(s, 100);
  act(s, 'p1', 'react', {}, 300); act(s, 'p3', 'react', {}, 350); act(s, 'p0', 'react', {}, 900);
  eq(P(s, 'p0').letters, 6);
  D.tick(s, 900 + 200);
  eq(s.phase, 'over');
  eq(s.standings, ['p3', 'p2', 'p1', 'p0']); eq(s.winners, ['p3']);
  eq(s.events.find(e => e.type === 'gameEnd').donkeys, ['p0']);
});

/* Finish a round so p0 spells DONKEY, with the given letters going in. */
function endWith(letters) {
  const s = rigged({ hands: [['JS', 'QS', 'KS', 'QH'], ['JH', 'KH', 'JC', 'QC'], ['AS', 'AH', 'AC', 'AD'], ['KC', 'JD', 'QD', 'KD']], starter: 'p0', letters });
  act(s, 'p2', 'declare', {}, 0);
  D.tick(s, 100);
  s.race.racers.filter(pid => pid !== 'p0').forEach((pid, i) => act(s, pid, 'react', {}, 200 + i * 10));
  act(s, 'p0', 'react', {}, 900);
  D.tick(s, 1100);
  return s;
}
function forceCards(s, mine, theirs) {
  const d = s.tiebreak.duel;
  d.cards[d.challenger] = card(mine); d.cards[d.opponent] = card(theirs);
}

test('tie for first between two: a right call knocks the opponent out', () => {
  const s = endWith([5, 2, 4, 2]);   // p1 and p3 tie on 2 letters for 1st and 2nd
  eq(s.phase, 'tiebreak'); eq(s.standings, [null, null, 'p2', 'p0']);
  const d = s.tiebreak.duel;
  eq(d.place, 0); eq(d.step, 'call', 'with two tied there is no one else to pick');
  const other = d.challenger === 'p1' ? 'p3' : 'p1';
  eq(d.opponent, other);
  assert(D.view(s, d.challenger).canCall && !D.view(s, other).canCall);
  forceCards(s, '9S', 'QH');
  // each sees only their own card until the reveal
  eq(D.view(s, d.challenger).tiebreak.duel.myCard.id, s.tiebreak.duel.cards[d.challenger].id);
  eq(D.view(s, d.challenger).tiebreak.duel.cards, null);
  eq(D.view(s, 'p0').tiebreak.duel.myCard, null);
  eq(act(s, other, 'call', { call: 'lower' }, 1200).code, 'turn');
  assert(act(s, d.challenger, 'call', { call: 'lower' }, 1200).right);
  eq(s.standings[1], other); eq(s.tiebreak.duel.result.out, other);
  eq(D.view(s, 'p0').tiebreak.duel.cards[other].id, 'QH', 'revealed to everyone');
  D.tick(s, 1200 + 200);
  eq(s.phase, 'over'); eq(s.standings[0], d.challenger); eq(s.winners, [d.challenger]);
});

test('a wrong call knocks the challenger out; equal ranks only count for "equal"', () => {
  let s = endWith([5, 1, 1, 3]);
  let d = s.tiebreak.duel;
  forceCards(s, '9S', '9H');
  assert(!act(s, d.challenger, 'call', { call: 'higher' }, 1200).right);
  eq(s.standings[1], d.challenger, 'challenger out, takes 2nd');
  s = endWith([5, 1, 1, 3]);
  d = s.tiebreak.duel;
  forceCards(s, '9S', '9H');
  assert(act(s, d.challenger, 'call', { call: 'equal' }, 1200).right);
  eq(s.standings[1], d.opponent);
  s = endWith([5, 1, 1, 3]);
  d = s.tiebreak.duel;
  forceCards(s, 'AS', '2H');
  assert(!act(s, d.challenger, 'call', { call: 'lower' }, 1200).right, 'aces are high');
});

test('three-way tie: the challenger picks; the first out takes the lowest place', () => {
  const s = endWith([5, 1, 1, 1]);
  eq(s.standings, [null, null, null, 'p0']);
  let d = s.tiebreak.duel;
  eq(d.step, 'choose'); eq(d.players.slice().sort(), ['p1', 'p2', 'p3']);
  eq(act(s, d.challenger, 'challenge', { target: 'p0' }, 1200).code, 'target');
  eq(act(s, d.challenger, 'challenge', { target: d.challenger }, 1200).code, 'target');
  const target = d.players.find(pid => pid !== d.challenger);
  assert(act(s, d.challenger, 'challenge', { target }, 1200).ok);
  eq(s.tiebreak.duel.step, 'call');
  forceCards(s, 'KS', '4D');
  act(s, d.challenger, 'call', { call: 'higher' }, 1300);
  eq(s.standings[2], target, 'first out: 3rd');
  D.tick(s, 1300 + 200);
  d = s.tiebreak.duel;
  eq(d.n, 2); eq(d.step, 'call', 'two left, so no pick'); eq(d.players.length, 2);
  forceCards(s, '3S', '7D');
  act(s, d.challenger, 'call', { call: 'higher' }, 1600);
  eq(s.standings[1], d.challenger, 'second out: 2nd');
  D.tick(s, 1600 + 200);
  eq(s.phase, 'over'); eq(s.standings[0], d.opponent);
  eq(new Set(s.standings).size, 4);
});

test('tie-breaker timers: no pick means a random opponent; no call means the likeliest call', () => {
  const s = endWith([5, 1, 1, 1]);
  const t0 = s.tiebreak.duel.endsAt;
  D.tick(s, t0);
  eq(s.tiebreak.duel.step, 'call');
  assert(s.events.some(e => e.type === 'timeout' && e.phase === 'choose'));
  D.tick(s, s.tiebreak.duel.endsAt);
  const duel = s.events.filter(e => e.type === 'duel').pop();
  assert(duel.auto, 'called for the challenger');
  const mine = duel.cards[duel.challenger];
  if (mine.rank === '8') assert(duel.call !== 'equal', 'an 8 is a coin toss between lower and higher');
  else eq(duel.call, D.bestCall(mine, 0));
});

test('the likeliest call: 2 lower, ace higher, 8 a coin toss, never equal', () => {
  eq(D.bestCall(card('2S'), 0.9), 'lower');
  eq(D.bestCall(card('AS'), 0.1), 'higher');
  eq(D.bestCall(card('KD'), 0.5), 'higher');
  eq(D.bestCall(card('5H'), 0.5), 'lower');
  eq(D.bestCall(card('8C'), 0.2), 'lower'); eq(D.bestCall(card('8C'), 0.7), 'higher');
});

test('computer player passes from its loosest rank and keeps its pair', () => {
  const memory = {};
  const v = { round: 1, hand: ['KS', 'KH', 'QD', 'AC', 'JD'].map(card) };
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(D.bot.choosePass(v, memory, Math.random).rank);
  assert(!seen.has('K'), 'never passes a king: ' + [...seen]);
});

/* ---------- simulations ---------------------------------------------------- */

console.log('\nSimulations');

function walkCards(obj, fn) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(x => walkCards(x, fn)); return; }
  if (typeof obj.id === 'string' && typeof obj.rank === 'string' && typeof obj.suit === 'string') { fn(obj); return; }
  for (const k in obj) if (k !== 'events') walkCards(obj[k], fn);
}

function simulate({ seed, reflexes, idle }) {
  const players = PLAYERS.map((p, i) => ({ id: p.id, name: p.name, isBot: !(idle && i === 0) }));
  const clock = new CT.ManualClock(0);
  const sess = new CT.Session({ modeId: 'donkey', players, options: { reflexes, passTime: idle ? '10' : '15' }, seed, clock, botSeed: seed * 13 + 1 });
  const st = () => sess.state;
  const stats = { rounds: 0, passes: [], losses: { p0: 0, p1: 0, p2: 0, p3: 0 }, reactMs: [], ties: 0, duels: 0, timeouts: 0 };
  let know = {}, round = 0, lastLetters = 0, lastSeq = -1;

  const check = () => {
    const s = st();
    if (s.phase !== 'tiebreak' && s.phase !== 'over') conservation(s);
    if (s.seq === lastSeq) return;
    lastSeq = s.seq;
    if (s.round !== round) { round = s.round; know = {}; }
    const total = s.players.reduce((n, p) => n + p.letters, 0);
    assert(total >= lastLetters, 'letters only go up');
    lastLetters = total;
    s.players.forEach(p => {
      assert(p.hand.length <= 5, 'at most five cards in a hand');
      const K = know[p.id] || (know[p.id] = new Set());
      p.hand.forEach(c => K.add(c.id));
      if (s.declare) s.declare.cards.forEach(c => K.add(c.id));
      const d = s.tiebreak && s.tiebreak.duel;
      if (d && d.cards) {
        if (d.cards[p.id]) K.add(d.cards[p.id].id);
        if (d.step === 'reveal') Object.values(d.cards).forEach(c => K.add(c.id));
      }
      const v = sess.view(p.id, { sinceSeq: 0 });
      walkCards(v, c => assert(K.has(c.id), p.id + ' can see ' + c.id + ' (' + s.phase + ')'));
      v.players.forEach(q => assert(q.hand === undefined, 'hands are never in the view'));
      v.events.forEach(e => { if (e.mine && e.type === 'pass') assert(e.from === p.id || e.to === p.id, 'pass secret leaked'); });
    });
  };

  sess.on(() => {
    st().events.forEach(e => {
      if (e._seen) return;
      e._seen = true;
      if (e.type === 'roundEnd') { stats.rounds++; e.losers.forEach(pid => stats.losses[pid]++); stats.passes.push(st().passes); }
      if (e.type === 'react') stats.reactMs.push(e.ms);
      if (e.type === 'tiebreakStart') stats.ties++;
      if (e.type === 'duel') stats.duels++;
      if (e.type === 'timeout') stats.timeouts++;
    });
  });

  check();
  let guard = 0;
  while (st().phase !== 'over') {
    clock.advance(50);
    sess.tick();
    check();
    if (++guard > 200000) throw new Error('game did not finish (seed ' + seed + ')');
  }
  const s = st();
  eq(new Set(s.standings).size, 4, 'standings name every player once');
  for (let i = 1; i < 4; i++) {
    assert(P(s, s.standings[i - 1]).letters <= P(s, s.standings[i]).letters, 'placed by letters');
  }
  assert(P(s, s.standings[3]).letters >= 6, 'the donkey is last');
  eq(s.winners, [s.standings[0]]);
  stats.minutes = clock.now() / 60000;
  return stats;
}

const configs = [
  { reflexes: 'relaxed', games: 150 }, { reflexes: 'normal', games: 150 }, { reflexes: 'sharp', games: 150 },
  { reflexes: 'normal', games: 30, idle: true }
];
const summary = {};
let simFail = 0, total = 0;
const t0 = Date.now();
configs.forEach((cfg, ci) => {
  const key = cfg.reflexes + (cfg.idle ? ' · idle player' : '');
  const agg = { games: 0, rounds: [], passes: [], maxPasses: 0, ties: 0, duels: 0, minutes: [], reactMs: [], idleLosses: 0, losses: 0 };
  for (let g = 0; g < cfg.games; g++) {
    const seed = 900 + ci * 1000 + g;
    total++;
    try {
      const r = simulate({ seed, reflexes: cfg.reflexes, idle: cfg.idle });
      agg.games++;
      agg.rounds.push(r.rounds);
      r.passes.forEach(n => { agg.passes.push(n); agg.maxPasses = Math.max(agg.maxPasses, n); });
      agg.ties += r.ties; agg.duels += r.duels;
      agg.minutes.push(r.minutes);
      agg.reactMs.push(...r.reactMs);
      agg.idleLosses += r.losses.p0; agg.losses += r.rounds;
    } catch (e) {
      simFail++;
      if (simFail < 6) console.log('  ✗ ' + key + ' seed ' + seed + ': ' + e.message);
    }
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const sorted = agg.reactMs.slice().sort((a, b) => a - b);
  summary[key] = {
    games: agg.games,
    avgRounds: avg(agg.rounds).toFixed(1),
    avgPasses: avg(agg.passes).toFixed(1),
    maxPasses: agg.maxPasses,
    tieGames: Math.round(100 * agg.ties / agg.games) + '%',
    duels: (agg.duels / agg.games).toFixed(2),
    reactMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : '-',
    avgMinutes: avg(agg.minutes).toFixed(1),
    p0LostRounds: Math.round(100 * agg.idleLosses / agg.losses) + '%'
  };
});
if (simFail === 0) { passed++; console.log('  ✓ ' + total + ' simulated games finished with every invariant intact (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
else { failed++; console.log('  ✗ ' + simFail + ' simulated games failed'); }
console.table(summary);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
