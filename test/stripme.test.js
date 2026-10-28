/* Strip-Me rules tests: hand-built scenarios, then all-computer games checked
   every tick for card conservation and privacy, in Strip Mode and Quick Play.
   Run: node test/stripme.test.js */
'use strict';
const path = require('path');
['src/engine/core.js', 'src/engine/session.js', 'src/modes/stripme/rules.js', 'src/modes/stripme/bot.js']
  .forEach(f => require(path.join(__dirname, '..', f)));
const CT = globalThis.CT;
const S = CT.getMode('stripme');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

const card = id => ({ id, rank: id.slice(0, -1), suit: id.slice(-1) });
const ids = cards => cards.map(c => c.id);
const PLAYERS = [{ id: 'p0', name: 'You', isBot: false }, { id: 'p1', name: 'Mia', isBot: false }];
const FAST = { dealHoldMs: 0, pickupHoldMs: 300, roundHoldMs: 500, turnMs: 5000 };
const P = (s, pid) => s.players.find(p => p.id === pid);
const act = (s, pid, type, now) => S.act(s, pid, type, {}, now || 0);
const play = (s, pid, now) => { const r = act(s, pid, 'play', now); if (!r.ok) throw new Error(pid + ' could not play: ' + r.message); return r; };
const last = s => s.events[s.events.length - 1];

/* A game with chosen decks (top card first) and p0 to start, at time 0. */
function rigged({ decks, options, timing } = {}) {
  const s = S.createGame({ players: PLAYERS, options, seed: 3, now: 0, timing: Object.assign({}, FAST, timing) });
  if (decks) s.players.forEach((p, i) => { p.deck = decks[i].map(card); });
  s.starter = 'p0';
  s.events = []; s.seq = 0;
  S.tick(s, 0);   // dealing → play
  return s;
}
function conservation(s) {
  const all = [];
  s.players.forEach(p => p.deck.forEach(c => all.push(c.id)));
  s.pile.forEach(c => all.push(c.id));
  if (all.length !== 52 || new Set(all).size !== 52) throw new Error('cards not conserved: ' + all.length + ' / ' + new Set(all).size);
}

test('two players, the deck split 26 and 26 face down', () => {
  const s = S.createGame({ players: PLAYERS, seed: 9, now: 0 });
  eq(s.players.map(p => p.deck.length), [26, 26]);
  conservation(s);
  eq(s.options, { mode: 'strip', losses: '3', timer: 'off' }, 'defaults: Strip Mode, three losses, no round timer');
  eq(s.phase, 'dealing');
  let threw = 0;
  [1, 3].forEach(n => { try { S.createGame({ players: PLAYERS.concat([{ id: 'p2', name: 'X' }]).slice(0, n), seed: 1 }); } catch (e) { threw++; } });
  eq(threw, 2, 'exactly two players');
  S.tick(s, 1400);
  eq([s.phase, s.turn], ['play', s.starter]);
});

test('turns alternate; only the player whose turn it is can play', () => {
  const s = rigged({ decks: [['2S', '3S', '4S'], ['5H', '6H', '7H']] });
  eq(act(s, 'p1', 'play').code, 'turn');
  play(s, 'p0', 10);
  eq([s.turn, s.pile.map(c => c.id), P(s, 'p0').deck.length], ['p1', ['2S'], 2]);
  eq([last(s).type, last(s).card.id, last(s).left], ['play', '2S', 2]);
  play(s, 'p1', 20);
  eq(s.turn, 'p0');
});

test('an Action Card makes the other player pay: Jack 1, Queen 2, King 3, Ace 4', () => {
  [['J', 1], ['Q', 2], ['K', 3], ['A', 4]].forEach(([r, n]) => {
    const s = rigged({ decks: [[r + 'S', '2S', '3S'], ['5H', '6H', '7H', '8H', '9H', '10H']] });
    play(s, 'p0', 10);
    eq([s.turn, s.owe, s.demand.n, last(s).demand], ['p1', n, n, n], r);
  });
});

test('paying in full without an Action Card: the payer takes the pile under their deck, and the other starts again', () => {
  const s = rigged({ decks: [['QS', '2S', '3S'], ['5H', '6H', '7H', '8H']] });
  play(s, 'p0', 10);                 // a Queen: Mia pays two
  play(s, 'p1', 20);
  eq([s.turn, s.owe], ['p1', 1], 'still paying: Mia again');
  play(s, 'p1', 30);
  eq([s.phase, s.taker, s.turn], ['pickup', 'p1', null], 'paid in full');
  eq(last(s).type, 'paid');
  eq(act(s, 'p0', 'play', 40).code, 'phase', 'nobody plays while the pile is taken');
  S.tick(s, 30 + 300);
  eq(s.phase, 'play');
  eq(ids(P(s, 'p1').deck), ['7H', '8H', 'QS', '5H', '6H'], 'the pile goes underneath, in the order it was played');
  eq([s.pile.length, s.turn, s.owe, s.demand], [0, 'p0', 0, null], 'the player who made her pay starts again');
  eq(last(s).type, 'pickup');
});

test('an Action Card while paying cancels the rest: now the other player pays for it', () => {
  const s = rigged({ decks: [['AS', '2S', '3S', '4S', '5S'], ['5H', 'KH', '7H', '8H']] });
  play(s, 'p0', 10);                 // an Ace: Mia owes four
  play(s, 'p1', 20);                 // 5♥: three to go
  play(s, 'p1', 30);                 // K♥: cancelled, now You owe three
  eq([s.turn, s.owe, s.demand.by, s.demand.rank, last(s).cancelled], ['p0', 3, 'p1', 'K', 3]);
  play(s, 'p0', 40); play(s, 'p0', 50); play(s, 'p0', 60);
  eq([s.phase, s.taker], ['pickup', 'p0'], 'three number cards: You take the pile');
  S.tick(s, 400);
  eq([P(s, 'p0').deck.length, s.turn], [1 + 6, 'p1'], 'one card left plus the six on the pile; Mia starts');
});

test('turning over your last card wins the round, even in the middle of paying', () => {
  const s = rigged({ decks: [['KS', '2S'], ['5H', '6H', '7H', '8H']] });
  play(s, 'p0', 10);                 // King: Mia owes three
  const t = rigged({ decks: [['QS', '2S', '9S'], ['5H']] });
  play(t, 'p0', 10);                 // Queen: Mia owes two but has one card
  play(t, 'p1', 20);
  eq([t.phase, t.result.winner, t.result.loser, last(t).type], ['roundOver', 'p1', 'p0', 'roundEnd'], 'her last card wins it');
  eq(t.events.filter(e => e.type === 'play').slice(-1)[0].last, true);
  const u = rigged({ decks: [['2S', 'JS'], ['5H', '6H', '7H']] });
  play(u, 'p0', 10); play(u, 'p1', 20); play(u, 'p0', 30);   // You turn over your last card, a Jack
  eq([u.phase, u.result.winner], ['roundOver', 'p0'], 'an Action Card as your last card still wins');
});

test('Strip Mode: the loser loses a garment, the next round is dealt afresh and the loser starts', () => {
  const s = rigged({ decks: [['2S'], ['5H', '6H']], options: { losses: '2' } });
  play(s, 'p0', 10);                 // You empty your deck
  eq([s.result.loser, s.result.garment, P(s, 'p1').lost, s.phase], ['p1', 1, 1, 'roundOver']);
  S.tick(s, 10 + 500);
  eq([s.phase, s.round, s.starter], ['dealing', 2, 'p1']);
  eq(s.players.map(p => p.deck.length), [26, 26]);
  conservation(s);
  S.tick(s, 510);
  eq(s.turn, 'p1');
  const v = S.view(s, 'p0', { events: false });
  eq([v.garments, v.players.map(p => p.left)], [2, [2, 1]]);
  // Mia loses again: two losses, game over
  s.players[0].deck = [card('3S'), card('4S')]; s.players[1].deck = [card('9H')];
  play(s, 'p1', 600);                // Mia empties her deck this time: You lose a garment
  eq([s.phase, P(s, 'p0').lost], ['roundOver', 1]);
  S.tick(s, 1100); S.tick(s, 1100);
  s.players[0].deck = [card('3S')]; s.players[1].deck = [card('9H'), card('8H')];
  s.turn = 'p0';
  play(s, 'p0', 1200);
  eq([s.phase, s.winners, last(s).type], ['over', ['p0'], 'gameOver'], 'Mia has lost both garments');
});

test('Quick Play: one round decides the game, no garments', () => {
  const s = rigged({ decks: [['2S'], ['5H', '6H']], options: { mode: 'quick' } });
  const v = S.view(s, 'p0', { events: false });
  eq([v.strip, v.garments, v.players[0].left], [false, 0, null]);
  play(s, 'p0', 10);
  eq([s.phase, s.winners, s.result.garment], ['over', ['p0'], 0]);
});

test('shuffle: on your turn, once before each card, never someone else’s deck', () => {
  const s = rigged({ decks: [['2S', '3S', '4S', '5S', '6S', '7S'], ['5H', '6H', '7H']] });
  eq(act(s, 'p1', 'shuffle').code, 'turn');
  const before = ids(P(s, 'p0').deck).sort();
  assert(act(s, 'p0', 'shuffle', 5).ok);
  eq(ids(P(s, 'p0').deck).sort(), before, 'the same cards');
  eq(act(s, 'p0', 'shuffle', 6).code, 'again', 'once a turn');
  eq(S.view(s, 'p0', { events: false }).canShuffle, false);
  play(s, 'p0', 10); play(s, 'p1', 20);
  assert(S.view(s, 'p0', { events: false }).canShuffle, 'a new turn: may shuffle again');
  const t = rigged({ decks: [['2S'], ['5H']] });
  eq(act(t, 'p0', 'shuffle').code, 'few', 'one card: nothing to shuffle');
});

test('time runs out: a card is turned over for you, then quickly until you play again', () => {
  const s = rigged({ decks: [['2S', '3S', '4S', '5S'], ['5H', '6H', '7H', '8H']], timing: { idleMs: 800 } });
  assert(!S.tick(s, 4999));
  S.tick(s, 5000);
  eq(s.events.slice(-2).map(e => e.type), ['timeout', 'play']);
  eq([s.pile.map(c => c.id), s.turn, s.events[s.events.length - 1].auto], [['2S'], 'p1', true]);
  eq(S.view(s, 'p1', { events: false }).players[0].idle, true, 'everyone can see You are on autopilot');
  play(s, 'p1', 5100);
  eq(s.turnEndsAt, 5100 + 800, 'your next card goes quickly');
  S.tick(s, 5900);
  eq([s.pile.length, s.events.filter(e => e.type === 'timeout').length], [3, 1], 'no second notice');
  play(s, 'p1', 6000);
  play(s, 'p0', 6100);
  eq([s.idle.p0, s.turnEndsAt], [undefined, 6100 + 5000], 'You played yourself: the full time again');
});

test('views: card counts only, never the order or contents of a deck', () => {
  const s = rigged({ decks: [['2S', '3S', '4S'], ['5H', '6H', '7H']] });
  play(s, 'p0', 10);
  const v = S.view(s, 'p1', { sinceSeq: 0 });
  eq(v.players.map(p => p.count), [2, 3]);
  eq(v.pileTop.map(c => c.id), ['2S'], 'the pile is face up');
  ['3S', '4S', '5H', '6H', '7H'].forEach(id => eq(JSON.stringify(v).indexOf('"' + id + '"'), -1, id + ' stays hidden'));
  eq([v.canPlay, v.canShuffle], [true, true]);
});

/* ---------- the round timer ---------- */

test('round timer: when time is up, whoever has more cards loses the round', () => {
  const s = rigged({ decks: [['2S', '3S', '4S'], ['5H', '6H', '7H', '8H', '9H']], options: { timer: '60' } });
  eq([s.roundEndsAt, s.turnEndsAt], [60000, 3000], 'a minute for the round, three seconds a card');
  const v = S.view(s, 'p0', { events: false });
  eq([v.timed, v.roundMs, v.roundEndsAt, v.overtime, v.timing.turnMs], [true, 60000, 60000, false, 3000]);
  play(s, 'p0', 1000);
  assert(!S.tick(s, 1500), 'nothing due yet');
  S.tick(s, 60000);
  const up = s.events.find(e => e.type === 'timeUp');
  eq([up.loser, up.counts], ['p1', { p0: 2, p1: 5 }], 'Mia has more cards');
  eq([s.phase, s.result.winner, s.result.loser, s.result.how, P(s, 'p1').lost], ['roundOver', 'p0', 'p1', 'time', 1]);
  eq([last(s).type, last(s).how, last(s).counts], ['roundEnd', 'time', { p0: 2, p1: 5 }]);
  eq([s.roundEndsAt, s.overtime], [null, false], 'the clock stops');
});

test('round timer: level when time is up, so play on, and whoever takes the pile next loses', () => {
  // (a long limit a card here, so only the round's clock matters)
  const s = rigged({ decks: [['QS', '2S', '3S'], ['5H', '6H', '7H']], options: { timer: '60' }, timing: { timedTurnMs: 100000 } });
  S.tick(s, 60000);
  eq([s.phase, s.overtime, last(s).type, last(s).level], ['play', true, 'timeUp', true], 'three each: sudden death');
  assert(!S.tick(s, 60001), 'no second notice');
  eq(S.view(s, 'p1', { events: false }).overtime, true, 'everyone can see it');
  play(s, 'p0', 60010);              // a Queen: Mia pays two
  play(s, 'p1', 60020); play(s, 'p1', 60030);
  eq(s.phase, 'pickup');
  S.tick(s, 60030 + 300);
  eq([s.phase, s.result.loser, s.result.how, s.result.overtime, s.result.counts], ['roundOver', 'p1', 'time', true, { p0: 2, p1: 4 }],
    'Mia took the pile: more cards, so she loses');
  // running out of cards in sudden death still wins
  const t = rigged({ decks: [['2S', '3S'], ['5H', '6H']], options: { timer: '60' }, timing: { timedTurnMs: 100000 } });
  S.tick(t, 60000);
  play(t, 'p0', 60010); play(t, 'p1', 60020); play(t, 'p0', 60030);
  eq([t.phase, t.result.winner, t.result.how], ['roundOver', 'p0', 'out']);
});

test('round timer: time up while the pile is being taken, so it goes to the taker before counting', () => {
  const s = rigged({ decks: [['KS', '2S', '3S', '4S'], ['5H', '6H', '7H', '8H', '9H']], options: { timer: '60' } });
  play(s, 'p0', 59000);              // a King: Mia pays three
  play(s, 'p1', 59700); play(s, 'p1', 59800); play(s, 'p1', 59900);
  eq(s.phase, 'pickup');
  assert(!S.tick(s, 60000), 'time is up, but the pile is still on its way');
  S.tick(s, 59900 + 300);
  eq(s.events.slice(-3).map(e => e.type), ['pickup', 'timeUp', 'roundEnd']);
  eq([s.result.loser, s.result.counts], ['p1', { p0: 3, p1: 6 }], 'two cards plus the four from the pile');
});

test('round timer: in Quick Play, time up decides the game; with the timer off, a round has no end time', () => {
  const s = rigged({ decks: [['2S', '3S', '4S', '5S'], ['5H', '6H']], options: { mode: 'quick', timer: '120' } });
  S.tick(s, 120000);
  eq([s.phase, s.winners, s.result.how], ['over', ['p1'], 'time'], 'You had more cards');
  const t = rigged({ decks: [['2S', '3S'], ['5H', '6H']] });
  eq([t.roundEndsAt, t.turnEndsAt, S.view(t, 'p0', { events: false }).timed], [null, 5000, false]);
  play(t, 'p0', 10); play(t, 'p1', 20);
  S.tick(t, 600000);
  eq(t.events.some(e => e.type === 'timeUp'), false, 'no clock');
});

test('round timer: every round gets a fresh clock, starting with its first card', () => {
  const s = rigged({ decks: [['2S'], ['5H', '6H']], options: { timer: '60', losses: '3' } });
  play(s, 'p0', 10);                 // You empty your deck
  eq([s.phase, s.roundEndsAt], ['roundOver', null]);
  S.tick(s, 10 + 500);
  eq([s.phase, s.round, s.roundEndsAt], ['dealing', 2, null], 'no clock while the cards are dealt');
  S.tick(s, 600);
  eq([s.phase, s.roundEndsAt, s.overtime], ['play', 600 + 60000, false]);
});

/* ---------- simulated games ---------- */

function simulate(seed, options, idle) {
  const players = PLAYERS.map((p, i) => Object.assign({}, p, { isBot: !(idle && i === 0) }));
  const clock = new CT.ManualClock(0);
  const session = new CT.Session({ modeId: 'stripme', players, options, seed, clock, botSeed: seed * 31 + 7 });
  const s = session.state;
  let ticks = 0, roundCards = [], hows = [];
  while (s.phase !== 'over' && ticks < 2000000) {
    clock.advance(50);
    session.tick();
    ticks++;
    if (s.phase === 'roundOver' && s.result && roundCards.length < s.round) { roundCards.push(s.result.plays); hows.push(s.result.how); }
    if (ticks % 25 === 0) {
      if (s.phase !== 'roundOver' && s.phase !== 'over') conservation(s);
      const v = session.view('p0', { events: false });
      const deckIds = new Set();
      s.players.forEach(p => p.deck.forEach(c => deckIds.add(c.id)));
      const seen = JSON.stringify(v);
      deckIds.forEach(id => { if (seen.includes('"' + id + '"')) throw new Error('a deck card leaked: ' + id); });
    }
  }
  if (s.phase !== 'over') throw new Error('game ' + seed + ' did not finish');
  if (s.result) { roundCards.push(s.result.plays); hows.push(s.result.how); }
  const loser = s.players.find(p => p.id !== s.winners[0]);
  const allowed = options.mode === 'quick' ? 1 : Number(options.losses);
  if (loser.lost !== allowed) throw new Error('the loser lost ' + loser.lost + ' rounds, not ' + allowed);
  if (s.players.find(p => p.id === s.winners[0]).lost >= allowed) throw new Error('the winner lost too many');
  return { rounds: s.round, cards: roundCards, hows, minutes: clock.now() / 60000, winner: s.winners[0],
    pickups: s.events.filter(e => e.type === 'pickup').length, shuffles: s.events.filter(e => e.type === 'shuffle').length };
}

const table = [];
[['Strip Mode · 2 losses', { mode: 'strip', losses: '2' }, 60], ['Strip Mode · 3 losses', { mode: 'strip', losses: '3' }, 60],
 ['Strip Mode · 5 losses', { mode: 'strip', losses: '5' }, 30], ['Quick Play', { mode: 'quick' }, 100],
 ['Quick Play · one idle player', { mode: 'quick' }, 6, true],
 ['Strip Mode · 3 losses · 1-minute rounds', { mode: 'strip', losses: '3', timer: '60' }, 40],
 ['Strip Mode · 3 losses · 3-minute rounds', { mode: 'strip', losses: '3', timer: '180' }, 30],
 ['Quick Play · 2-minute round', { mode: 'quick', timer: '120' }, 60],
 ['Quick Play · 1-minute round · one idle player', { mode: 'quick', timer: '60' }, 6, true]].forEach(([label, options, games, idle]) => {
  test('simulated games: ' + label + ' (' + games + ' games, every 25th tick checked)', () => {
    const rs = [];
    for (let g = 0; g < games; g++) rs.push(simulate(500 + g * 13, options, idle));
    const cards = [].concat(...rs.map(r => r.cards)).sort((a, b) => a - b);
    const q = f => cards[Math.floor(f * (cards.length - 1))];
    table.push({ table: label, games, rounds: (rs.reduce((a, r) => a + r.rounds, 0) / rs.length).toFixed(1),
      'cards per round (median)': q(0.5), '90%': q(0.9), longest: cards[cards.length - 1],
      'minutes per game': (rs.reduce((a, r) => a + r.minutes, 0) / rs.length).toFixed(1),
      'rounds ended by the clock': options.timer ? Math.round(100 * [].concat(...rs.map(r => r.hows)).filter(h => h === 'time').length / cards.length) + '%' : '',
      'p0 wins': rs.filter(r => r.winner === 'p0').length });
  });
});

console.log('');
if (table.length) console.table(table);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
