/* Bull rules tests: hand-built scenarios, then hundreds of all-computer
   games checked every tick for card conservation and privacy.
   Run: node test/bull.test.js */
'use strict';
const path = require('path');
['src/engine/core.js', 'src/engine/session.js', 'src/modes/bull/rules.js', 'src/modes/bull/bot.js']
  .forEach(f => require(path.join(__dirname, '..', f)));
const CT = globalThis.CT;
const B = CT.getMode('bull');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

const card = id => ({ id, rank: id.slice(0, -1), suit: id.slice(-1) });
const players = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: false }));
const FAST = { dealHoldMs: 0, revealMs: 500, lastCallExtraMs: 500, bullMs: 1000, turnMs: 10000 };
const P = (s, pid) => s.players.find(p => p.id === pid);
const act = (s, pid, type, payload, now) => B.act(s, pid, type, payload || {}, now || 0);

/* A game with chosen hands, p0 to start with Aces at time 0. */
function rigged({ hands, n, timing, options } = {}) {
  const s = B.createGame({ players: players(n || (hands ? hands.length : 4)), options, seed: 5, now: 0, timing: Object.assign({}, FAST, timing) });
  if (hands) s.players.forEach((p, i) => { p.hand = hands[i].map(card); });
  s.starter = 'p0';
  s.events = []; s.seq = 0;
  B.tick(s, 0);   // dealing → play
  return s;
}
function conservation(s) {
  const all = [];
  s.players.forEach(p => p.hand.forEach(c => all.push(c.id)));
  s.pile.forEach(pl => pl.cards.forEach(c => all.push(c.id)));
  if (all.length !== 52 || new Set(all).size !== 52) throw new Error('cards not conserved: ' + all.length + ' / ' + new Set(all).size);
}

const H4 = [
  ['AS', 'AH', '2C', '5D', '9S'],
  ['2S', '2H', '3C', 'KD', '8H'],
  ['3S', '3H', '4C', 'QD', '7C'],
  ['4S', '4H', '5C', 'JD', '6C']
];

test('the whole deck is dealt out, one card at a time from whoever starts', () => {
  [3, 4, 5, 6].forEach(n => {
    const s = B.createGame({ players: players(n), seed: 7 + n, now: 0 });
    const sizes = s.players.map(p => p.hand.length);
    eq(sizes.reduce((a, b) => a + b, 0), 52, n + ' players: all 52 cards');
    assert(Math.max(...sizes) - Math.min(...sizes) <= 1, 'hands differ by at most one card');
    const start = s.players.findIndex(p => p.id === s.starter);
    assert(s.players[start].hand.length === Math.max(...sizes), 'the starter is dealt first');
    const deal = s.events[0];
    eq(deal.type, 'deal');
    eq(deal.order[0], s.starter);
    s.players.forEach(p => assert(deal.secret[p.id].hand.length === p.hand.length, 'each player is shown their own hand'));
  });
  let threw = 0;
  [2, 7].forEach(n => { try { B.createGame({ players: players(n), seed: 1 }); } catch (e) { threw++; } });
  eq(threw, 2, 'three to six players');
});

test('the starter opens with Aces after the deal', () => {
  const s = B.createGame({ players: players(4), seed: 3, now: 0 });
  eq(s.phase, 'dealing');
  assert(!B.tick(s, 1000));
  B.tick(s, 2000);
  eq([s.phase, s.turn, s.rank], ['play', s.starter, 0]);
  eq(B.view(s, s.starter, { events: false }).rank, 'A');
});

test('a turn: one to four of your own cards, face down, claimed as the rank in sequence', () => {
  const s = rigged({ hands: H4 });
  eq(act(s, 'p1', 'play', { cardIds: ['2S'] }).code, 'turn', 'only the player whose turn it is');
  eq(act(s, 'p0', 'play', { cardIds: [] }).code, 'none');
  eq(act(s, 'p0', 'play', { cardIds: ['AS', 'AH', '2C', '5D', '9S'] }).code, 'many', 'at most four');
  eq(act(s, 'p0', 'play', { cardIds: ['KD'] }).code, 'card', 'only cards in your hand');
  const res = act(s, 'p0', 'play', { cardIds: ['AS', 'AH'] }, 100);
  eq([res.ok, res.n, res.rank], [true, 2, 'A']);
  eq(P(s, 'p0').hand.map(c => c.id), ['2C', '5D', '9S']);
  eq([s.turn, s.rank, s.pile.length], ['p1', 1, 1], 'next player clockwise, next rank');
  eq(s.last, { by: 'p0', rank: 0, n: 2, at: 100, no: 1 });
  const e = s.events[s.events.length - 1];
  eq([e.type, e.player, e.rank, e.n], ['play', 'p0', 'A', 2]);
  eq(e.secret.p0.cards.map(c => c.id), ['AS', 'AH'], 'only the player knows what went down');
});

test('everyone gets a moment to call Bull before the next player may play', () => {
  const s = rigged({ hands: H4 });
  act(s, 'p0', 'play', { cardIds: ['AS'] }, 0);
  const early = act(s, 'p1', 'play', { cardIds: ['2S'] }, 400);
  eq([early.code, early.retryInMs], ['wait', 600]);
  assert(act(s, 'p1', 'play', { cardIds: ['2S'] }, 1000).ok);
  eq(s.turnEndsAt, 12000, 'the next turn’s clock starts once the moment is over');
});

test('Bull on a lie: the liar picks up the whole pile', () => {
  const s = rigged({ hands: H4 });
  act(s, 'p0', 'play', { cardIds: ['AS'] }, 0);
  act(s, 'p1', 'play', { cardIds: ['2S', '8H'] }, 1500);   // claims two 2s; the 8 is a lie
  const res = act(s, 'p3', 'bull', {}, 1800);                // anyone can call, not only the next player
  eq([res.ok, res.lie], [true, true]);
  eq(s.phase, 'reveal');
  const e = s.events[s.events.length - 1];
  eq([e.type, e.challenger, e.accused, e.lie, e.taker, e.count], ['bull', 'p3', 'p1', true, 'p1', 3]);
  eq(e.cards.map(c => c.id), ['2S', '8H'], 'the called cards are shown to everyone');
  eq(act(s, 'p0', 'bull', {}, 1900).code, 'phase', 'one call at a time');
  B.tick(s, 1800 + 500);
  eq(s.phase, 'play');
  eq(P(s, 'p1').hand.length, 3 + 3, 'p1 had 3 cards left and picked up all 3 on the pile');
  eq(s.pile, []);
  eq([s.turn, s.rank], ['p2', 2], 'p2 still plays, and the sequence carries on with 3s');
});

test('Bull on the truth: whoever called picks up the pile', () => {
  const s = rigged({ hands: H4 });
  act(s, 'p0', 'play', { cardIds: ['AS', 'AH'] }, 0);
  const res = act(s, 'p2', 'bull', {}, 300);
  eq(res.lie, false);
  B.tick(s, 300 + 500);
  eq(P(s, 'p2').hand.length, 5 + 2);
  eq([s.turn, s.phase], ['p1', 'play'], 'p1 plays 2s next');
  eq(s.openAt, 800, 'and may play straight away: there’s nothing left to call');
});

test('only the last play can be called, and only until the next player plays', () => {
  const s = rigged({ hands: H4 });
  eq(act(s, 'p1', 'bull', {}, 0).code, 'nothing', 'nothing played yet');
  act(s, 'p0', 'play', { cardIds: ['9S'] }, 0);              // a lie: claims an Ace
  eq(act(s, 'p0', 'bull', {}, 100).code, 'self', 'not your own play');
  act(s, 'p1', 'play', { cardIds: ['2S'] }, 1000);           // the window on p0's play closes
  const res = act(s, 'p2', 'bull', {}, 1100);
  eq([res.ok, res.lie], [true, false], 'the call is on p1’s honest 2, not p0’s bluff');
});

test('last cards: one last chance to call Bull, then they win', () => {
  const s = rigged({ hands: [['AS'], ['2S', '3C'], ['3S', '4C'], ['4S', '5C']] });
  act(s, 'p0', 'play', { cardIds: ['AS'] }, 0);
  eq(s.phase, 'lastcall');
  eq(act(s, 'p1', 'play', { cardIds: ['2S'] }, 1200).code, 'phase', 'nobody plays during the last call');
  assert(!B.tick(s, 1499));
  B.tick(s, 1500);
  eq([s.phase, s.winners], ['over', ['p0']]);
});

test('last cards called: a bluff picks up the pile and plays on; the truth wins', () => {
  const bluff = rigged({ hands: [['KS'], ['2S', '3C'], ['3S', '4C'], ['4S', '5C']] });
  act(bluff, 'p0', 'play', { cardIds: ['KS'] }, 0);
  assert(act(bluff, 'p3', 'bull', {}, 400).lie);
  B.tick(bluff, 900);
  eq([bluff.phase, P(bluff, 'p0').hand.length, bluff.turn], ['play', 1, 'p1'], 'caught: back in the game');
  const honest = rigged({ hands: [['AS'], ['2S', '3C'], ['3S', '4C'], ['4S', '5C']] });
  act(honest, 'p0', 'play', { cardIds: ['AS'] }, 0);
  assert(!act(honest, 'p2', 'bull', {}, 400).lie);
  B.tick(honest, 900);
  eq([honest.phase, honest.winners, P(honest, 'p2').hand.length], ['over', ['p0'], 3]);
});

test('time runs out: one card is played for you, a true one if you have it', () => {
  const s = rigged({ hands: H4 });
  B.tick(s, 9999);
  eq(s.turn, 'p0');
  B.tick(s, 10000);
  eq(s.events.slice(-2).map(e => e.type), ['timeout', 'play']);
  assert(['AS', 'AH'].indexOf(s.pile[0].cards[0].id) >= 0, 'an Ace went down');
  const t = rigged({ hands: [['9S', '5D'], ['2S'], ['3S'], ['4S']] });
  B.tick(t, 10000);
  eq(t.pile[0].cards.length, 1, 'no Aces: a random card instead');
});

test('views: your own hand, everyone’s card counts, never the pile’s cards', () => {
  const s = rigged({ hands: H4 });
  act(s, 'p0', 'play', { cardIds: ['AS', '9S'] }, 0);
  const v = B.view(s, 'p1', { sinceSeq: 0 });
  eq(v.hand.map(c => c.id), H4[1]);
  eq(v.players.map(p => p.handCount), [3, 5, 5, 5]);
  eq([v.pileCount, v.last.rank, v.last.n, v.canBull, v.canPlay], [2, 'A', 2, true, true]);
  eq(JSON.stringify(v).indexOf('9S'), -1, 'p1 can’t see what p0 put down');
  v.events.forEach(e => assert(!e.secret, 'secrets are never passed on'));
  const mine = B.view(s, 'p0', { sinceSeq: 0 }).events.filter(e => e.type === 'play')[0];
  eq(mine.mine.cards.map(c => c.id), ['AS', '9S'], 'but the player sees their own');
});

test('the picker-up sees the cards they take; nobody else does', () => {
  const s = rigged({ hands: H4 });
  act(s, 'p0', 'play', { cardIds: ['AS', '5D'] }, 0);
  act(s, 'p1', 'play', { cardIds: ['2S'] }, 1000);
  act(s, 'p2', 'bull', {}, 1200);   // p1 told the truth
  B.tick(s, 1700);
  const pick = s.events.filter(e => e.type === 'pickup')[0];
  eq(pick.secret.p2.cards.map(c => c.id).sort(), ['2S', '5D', 'AS']);
  const other = B.view(s, 'p3', { sinceSeq: 0 }).events.filter(e => e.type === 'pickup')[0];
  eq([other.count, other.mine], [3, undefined]);
  eq(JSON.stringify(B.view(s, 'p3', { sinceSeq: 0 })).indexOf('5D'), -1, 'the uncalled cards stay secret');
});

test('the computer player calls a claim it knows can’t be true', () => {
  const s = rigged({ hands: [['AS', 'AH', 'AD', '2C'], ['AC', '2S', '3C'], ['3S', '4C'], ['4S', '5C']] });
  act(s, 'p1', 'play', { cardIds: ['3C'] }, 0);    // not p1's turn: fails
  act(s, 'p0', 'play', { cardIds: ['2C', 'AS'] }, 0);   // p0 claims two Aces...
  const v = B.view(s, 'p1', { events: false });
  // p1 holds the 4th Ace, so two Aces isn't impossible; give p1 three to make it impossible
  s.players[1].hand.push(card('AD'));
  s.players[0].hand = s.players[0].hand.filter(c => c.id !== 'AD');
  assert(B.bot.wantsBull(B.view(s, 'p1', { events: false })), 'two claimed + two held > four');
  assert(v.canBull);
});

/* ---------- the "lies" rule choice: bluffs nobody calls ---------- */

const SHOWN = { lies: 'shown' };

test('bluffs nobody calls stay secret by default', () => {
  const s = rigged({ hands: H4 });
  eq(s.options.lies, 'secret');
  act(s, 'p0', 'play', { cardIds: ['9S'] }, 0);              // a bluff: claims an Ace
  act(s, 'p1', 'play', { cardIds: ['2S'] }, 1000);           // too late to call it now
  eq(s.events.filter(e => e.type === 'lieExposed').length, 0);
  const v = B.view(s, 'p2', { sinceSeq: 0 });
  eq([v.exposure, v.exposedCards], [null, []]);
  eq(JSON.stringify(v).indexOf('9S'), -1, 'nobody else ever sees it');
});

test('revealed: once the next player plays, an uncalled bluff is turned over for everyone', () => {
  const s = rigged({ hands: H4, options: SHOWN });
  act(s, 'p0', 'play', { cardIds: ['AS', '9S'] }, 0);        // two "Aces": one is a 9
  eq(s.events.filter(e => e.type === 'lieExposed').length, 0, 'still callable: nothing shown yet');
  act(s, 'p1', 'play', { cardIds: ['2S'] }, 1000);
  const e = s.events.filter(x => x.type === 'lieExposed')[0];
  eq([e.player, e.rank, e.n, e.no, e.final, e.cards.map(c => c.id)], ['p0', 'A', 2, 1, false, ['AS', '9S']]);
  assert(!e.secret, 'everyone sees it');
  const v = B.view(s, 'p3', { sinceSeq: 0 });
  eq([v.exposure.by, v.exposure.cards.map(c => c.id), v.exposedCards.map(c => c.id)], ['p0', ['AS', '9S'], ['AS', '9S']]);
  eq(v.pileCount, 3, 'nobody picks anything up');
  act(s, 'p2', 'play', { cardIds: ['3S'] }, 2000);           // p1's honest 2 is never shown
  eq(s.events.filter(x => x.type === 'lieExposed').length, 1);
  eq(JSON.stringify(B.view(s, 'p3', { events: false }).exposedCards).indexOf('2S'), -1);
});

test('revealed: a bluff that is called is shown by the call, not again', () => {
  const s = rigged({ hands: H4, options: SHOWN });
  act(s, 'p0', 'play', { cardIds: ['9S'] }, 0);
  act(s, 'p2', 'bull', {}, 300);
  B.tick(s, 800);
  act(s, 'p1', 'play', { cardIds: ['2S'] }, 900);
  eq(s.events.filter(e => e.type === 'lieExposed').length, 0);
});

test('revealed: winning with a bluff nobody called is shown at the end', () => {
  const s = rigged({ hands: [['KS'], ['2S', '3C'], ['3S', '4C'], ['4S', '5C']], options: SHOWN });
  act(s, 'p0', 'play', { cardIds: ['KS'] }, 0);              // their last card, claimed as an Ace
  B.tick(s, 1500);
  const types = s.events.slice(-2).map(e => e.type);
  eq(types, ['lieExposed', 'gameOver']);
  eq([s.events[s.events.length - 2].final, s.winners], [true, ['p0']], 'they still win: nobody called it');
  eq(B.view(s, 'p1', { events: false }).exposure.final, true);
});

test('the computer player counts revealed bluffs it has seen', () => {
  // p3 holds two Kings and saw a third revealed in a bluff, so "two Kings" can't be true
  const claimTwoKings = options => {
    const s = rigged({ hands: [['9S', '7C'], ['KH', '5C', '6D'], ['3S', '4C'], ['KD', 'KC', '6H']], options });
    s.pile = [{ by: 'p0', rank: 0, cards: [card('KS')], no: 1, exposed: options && options.lies === 'shown' }];
    s.plays = 1; s.rank = 12; s.turn = 'p1'; s.last = null; s.openAt = 0;
    act(s, 'p1', 'play', { cardIds: ['KH', '5C'] }, 0);
    return B.view(s, 'p3', { events: false });
  };
  eq(B.bot.lieChance(claimTwoKings(SHOWN)), 1, 'two held + one revealed: at most one King left');
  assert(B.bot.lieChance(claimTwoKings()) < 1, 'without the reveal it can’t be sure');
});

/* ---------- simulated games ---------- */

function simulate(n, skill, seed, idle, options) {
  const ps = players(n).map((p, i) => Object.assign(p, { isBot: !(idle && i === 0) }));
  const clock = new CT.ManualClock(0);
  const session = new CT.Session({ modeId: 'bull', players: ps, options: Object.assign({ bots: skill, turnTime: '15', bullTime: '2' }, options), seed, clock });
  const s = session.state;
  let ticks = 0, maxPile = 0;
  while (s.phase !== 'over' && ticks < 200000) {
    clock.advance(50);
    session.tick();
    ticks++;
    if (ticks % 20 === 0) {
      conservation(s);
      maxPile = Math.max(maxPile, s.pile.reduce((a, pl) => a + pl.cards.length, 0));
      // privacy: nobody's view holds anyone else's cards
      s.players.forEach(p => {
        const v = session.view(p.id, { events: false });
        const others = new Set();
        s.players.forEach(q => { if (q.id !== p.id) q.hand.forEach(c => others.add(c.id)); });
        v.hand.forEach(c => { if (others.has(c.id)) throw new Error('a hand leaked'); });
        if (v.reveal) return;
        // the pile's cards are only known to whoever put them there (or to all, once a bluff is revealed)
        const seen = JSON.stringify(Object.assign({}, v, { exposure: null }));
        s.pile.forEach(pl => {
          if (pl.by === p.id) return;
          pl.cards.forEach(c => {
            if (!seen.includes('"' + c.id + '"')) return;
            if (!pl.exposed || !v.exposedCards.some(x => x.id === c.id)) throw new Error('the pile leaked');
          });
          if (pl.exposed && pl.cards.every(c => c.rank === B.ranks[pl.rank])) throw new Error('an honest play was revealed');
        });
      });
    }
  }
  if (s.phase !== 'over') throw new Error('game ' + seed + ' did not finish');
  const ev = s.events;
  if (options && options.lies === 'shown') {
    // every uncalled bluff is revealed: count them against the plays that were lies and never called
    const exposed = ev.filter(e => e.type === 'lieExposed').length;
    if (!exposed && s.plays > 30) throw new Error('game ' + seed + ': no bluff was ever revealed');
  }
  return {
    plays: s.plays, minutes: clock.now() / 60000, calls: ev.filter(e => e.type === 'bull').length,
    caught: ev.filter(e => e.type === 'bull' && e.lie).length, maxPile, winner: s.winners[0],
    lastCalls: ev.filter(e => e.type === 'lastCall').length, revealed: ev.filter(e => e.type === 'lieExposed').length
  };
}

const table = [];
[['3 players · normal', 3, 'normal', 60], ['4 players · normal', 4, 'normal', 80], ['5 players · normal', 5, 'normal', 60], ['6 players · normal', 6, 'normal', 60],
 ['4 players · trusting', 4, 'easy', 50], ['4 players · suspicious', 4, 'sharp', 50], ['4 · one idle player', 4, 'normal', 30, true],
 ['4 · bluffs revealed', 4, 'normal', 60, false, SHOWN], ['6 · bluffs revealed', 6, 'sharp', 40, false, SHOWN]].forEach(([label, n, skill, games, idle, options]) => {
  test('simulated games: ' + label + ' (' + games + ' games, every 20th tick checked)', () => {
    const rs = [];
    for (let g = 0; g < games; g++) rs.push(simulate(n, skill, 1000 + g * 7 + n, idle, options));
    const avg = k => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    const idleWins = idle ? rs.filter(r => r.winner === 'p0').length : null;
    table.push({ table: label, games, plays: avg('plays').toFixed(0), minutes: avg('minutes').toFixed(1), calls: avg('calls').toFixed(1),
      'lies caught': (100 * rs.reduce((a, r) => a + r.caught, 0) / Math.max(1, rs.reduce((a, r) => a + r.calls, 0))).toFixed(0) + '%',
      'biggest pile': Math.max(...rs.map(r => r.maxPile)), 'last calls': avg('lastCalls').toFixed(1), 'idle wins': idleWins == null ? '' : idleWins,
      revealed: options ? avg('revealed').toFixed(1) : '' });
  });
});

console.log('');
if (table.length) console.table(table);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
