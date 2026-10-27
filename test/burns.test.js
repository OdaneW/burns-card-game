/* Burns rules tests: hand-built scenarios plus thousands of all-bot games
   checked for card conservation, follow-suit, privacy, draw pauses and timers.
   Run: node test/burns.test.js */
'use strict';
const path = require('path');
['src/engine/core.js', 'src/engine/session.js', 'src/modes/burns/rules.js', 'src/modes/burns/bot.js']
  .forEach(f => require(path.join(__dirname, '..', f)));
const CT = globalThis.CT;
const Burns = CT.getMode('burns');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }

const card = id => ({ id, rank: id.slice(0, -1), suit: id.slice(-1) });
const ids = cards => cards.map(c => c.id);

/* Build a game, then lay out hands / deck / starter by hand.
   deck is listed top-first (first entry is drawn first). */
function rigged({ hands, starter, deck, options, timing }) {
  const players = hands.map((h, i) => ({ id: 'p' + i, name: 'P' + i, isBot: false }));
  const state = Burns.createGame({ players, options, seed: 7, now: 0, timing: Object.assign({ dealHoldMs: 0, revealHoldMs: 100 }, timing) });
  const used = new Set();
  hands.forEach((h, i) => { state.players[i].hand = h.map(card); h.forEach(x => used.add(x)); });
  state.starter = card(starter); used.add(starter);
  const top = (deck || []).map(card); top.forEach(c => used.add(c.id));
  const rest = CT.standardDeck().filter(c => !used.has(c.id));
  // Unlisted cards go to the discard so the deck holds exactly what the test says.
  state.deck = top.slice().reverse();
  state.discard = rest;
  state.events = []; state.seq = 0;   // forget the random deal
  return state;
}

function act(state, pid, type, payload, now) { return Burns.act(state, pid, type, payload, now || 0); }

function conservation(state) {
  const all = [];
  state.players.forEach(p => p.hand.forEach(c => all.push(c.id)));
  state.deck.forEach(c => all.push(c.id));
  state.discard.forEach(c => all.push(c.id));
  state.table.forEach(e => { if (!e.gone) all.push(e.card.id); });
  if (state.starter) all.push(state.starter.id);
  assert(all.length === 52, 'card count ' + all.length);
  assert(new Set(all).size === 52, 'duplicate cards');
}

console.log('\nScenarios');

// Non-Flush starting hands used below (none holds all four suits).
const H0 = ['2S', '3S', '4C', '5D'];   // no hearts
const H1 = ['6H', '7S', '8S', '9D'];   // no clubs
const H2 = ['10H', 'JS', 'QS', 'AD'];  // no clubs

test('defaults: Real Burns off, Flush off, leader’s card face up, 30 seconds to play', () => {
  const s = Burns.createGame({ players: [{ id: 'p0', name: 'A' }, { id: 'p1', name: 'B' }], seed: 1, now: 0 });
  eq(s.options, { real: 'off', flush: 'off', leadCard: 'faceUp', turnTime: '30' });
});

test('Flush rule on: a Flush on the deal wins immediately', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7S', '8H', '9H']], starter: 'KD', deck: ['QC'], options: { flush: 'on' } });
  Burns.tick(s, 0);
  eq(s.phase, 'over'); eq(s.winners, ['p0']); eq(s.winReason, 'flush');
  conservation(s);
});

test('Flush rule on: two Flushes share the win', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7H', '8C', '9D'], ['10S', 'JS', 'QS', 'KS']], starter: 'AD', deck: [], options: { flush: 'on' } });
  Burns.tick(s, 0);
  eq(s.winners, ['p0', 'p1']);
});

test('Flush rule off: a hand with all four suits just plays', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7S', '8H', '9H']], starter: 'KD', deck: ['QC'], options: { flush: 'off' } });
  Burns.tick(s, 0);
  eq(s.phase, 'follow'); assert(!s.winReason, 'nobody has won'); eq(s.suit, 'D');
  eq(s.events.filter(e => /lush/.test(e.type)).length, 0, 'no Flush events');
  assert(Burns.view(s, 'p0').flushRule === false);
  conservation(s);
});

test('a game saved before Flush became a choice keeps the Flush rule', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7S', '8H', '9H']], starter: 'KD', deck: ['QC'] });
  delete s.options.flush;
  Burns.tick(s, 0);
  eq(s.winReason, 'flush');
});

test('no Flush: set 1 follows the starter card’s suit', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KD', deck: ['QC'] });
  Burns.tick(s, 0);
  eq(s.phase, 'follow'); eq(s.setNo, 1); eq(s.suit, 'D'); eq(s.leader, null);
  eq(s.table.map(e => e.via), ['starter']);
  conservation(s);
});

test('must follow suit; holding the suit you may still draw for a better one', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KD', deck: ['QC', 'AD'] });
  Burns.tick(s, 0);
  const v = Burns.view(s, 'p0');
  assert(v.canFollow && v.mayDraw && !v.mustDraw, 'can play or draw');
  eq(act(s, 'p0', 'follow', { cardId: '2S' }).code, 'wrong-suit');
  assert(act(s, 'p0', 'draw', {}, 0).ok, 'drew QC');
  assert(act(s, 'p0', 'draw', {}, 500).matched, 'drew AD');
  assert(act(s, 'p0', 'follow', { cardId: 'AD' }, 600).ok);
  eq(act(s, 'p0', 'follow', { cardId: '5D' }, 700).code, 'done');
  eq(ids(s.players[0].hand), ['2S', '3S', '4C', '5D', 'QC'], 'drawn cards stay in the hand');
});

test('cards stay hidden until everyone has played, then reveal together', () => {
  const s = rigged({ hands: [H0, H1, H2], starter: 'KD', deck: ['QH'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5D' });
  eq(Burns.view(s, 'p1').table.find(e => e.owner === 'p0').card, null, 'p0 card visible to p1 before reveal');
  eq(Burns.view(s, 'p0').table.find(e => e.owner === 'p0').card.id, '5D', 'own card visible');
  act(s, 'p1', 'follow', { cardId: '9D' });
  assert(Burns.view(s, 'p2').table.every(e => e.via === 'starter' || e.card === null), 'hidden for p2');
  act(s, 'p2', 'follow', { cardId: 'AD' });
  eq(s.phase, 'reveal');
  assert(Burns.view(s, 'p0').table.every(e => e.card), 'all revealed');
  eq(s.setResult.player, 'p2'); eq(s.setResult.card.id, 'AD');
});

test('the starter card never wins the set', () => {
  const s = rigged({ hands: [H0, H1], starter: 'AD', deck: ['QH'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5D' });
  act(s, 'p1', 'follow', { cardId: '9D' });
  eq(s.setResult.player, 'p1');
});

test('set winner leads any suit next; the set is put aside', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KD', deck: ['QH'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5D' });
  act(s, 'p1', 'follow', { cardId: '9D' });
  Burns.tick(s, 100);
  eq(s.phase, 'lead'); eq(s.leader, 'p1'); eq(s.setNo, 2);
  eq(act(s, 'p0', 'lead', { cardId: '2S' }).code, 'not-leader');
  eq(act(s, 'p1', 'draw', {}, 100).code, 'not-now', 'the leader does not draw');
  assert(act(s, 'p1', 'lead', { cardId: '6H' }, 100).ok);
  eq(s.suit, 'H'); eq(s.phase, 'follow');
  eq(act(s, 'p1', 'draw', {}, 150).code, 'leader');
  eq(s.discard.filter(c => ['5D', '9D', 'KD'].includes(c.id)).length, 3, 'previous set put aside');
});

test('no suit: draw until one turns up, then play it or keep drawing for a better one', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KH', deck: ['QC', '4H', 'JS', '9H', '2C'] });
  Burns.tick(s, 0);
  eq(act(s, 'p0', 'follow', { cardId: '2S' }).code, 'wrong-suit');
  let v = Burns.view(s, 'p0');
  assert(v.mustDraw && !v.canFollow, 'must draw first');
  const r1 = act(s, 'p0', 'draw', {}, 1000);
  assert(r1.ok && !r1.matched, 'first draw off-suit');
  const spam = act(s, 'p0', 'draw', {}, 1200);
  eq(spam.code, 'cooldown'); assert(spam.retryInMs === 300, 'retry ' + spam.retryInMs);
  const r2 = act(s, 'p0', 'draw', {}, 1500);
  assert(r2.ok && r2.matched, 'second draw matches');
  eq(s.committed.p0, undefined, 'a found card is not played automatically');
  v = Burns.view(s, 'p0');
  assert(v.canFollow && v.mayDraw && !v.mustDraw, 'may play or keep drawing');
  eq(v.playable, ['4H']);
  assert(act(s, 'p0', 'draw', {}, 2000).ok, 'kept drawing (JS)');
  assert(act(s, 'p0', 'draw', {}, 2500).matched, 'found 9H');
  eq(Burns.view(s, 'p0').playable.sort(), ['4H', '9H']);
  assert(act(s, 'p0', 'follow', { cardId: '9H' }, 2600).ok);
  eq(s.table.find(e => e.owner === 'p0').card.id, '9H');
  eq(ids(s.players[0].hand), ['2S', '3S', '4C', '5D', 'QC', '4H', 'JS'], 'every drawn card stays in the hand');
  conservation(s);
});

test('a found card stays private: others only see that a card was drawn', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KH', deck: ['4H', 'QC'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'draw', {}, 0);
  const draws = Burns.view(s, 'p1', { sinceSeq: 0 }).events.filter(e => e.type === 'draw');
  eq(draws.length, 1);
  eq(draws[0].matched, undefined, 'match not public');
  eq(draws[0].mine, undefined, 'card not shown to others');
  eq(Burns.view(s, 'p0', { sinceSeq: 0 }).events.filter(e => e.type === 'draw')[0].mine.matched, true, 'drawer knows');
});

test('several players draw at the same time from one deck', () => {
  const s = rigged({ hands: [H0, ['6S', '7S', '8C', '9D'], H2], starter: 'KH', deck: ['QD', '2H', '9C', '3H'] });
  Burns.tick(s, 0);
  assert(act(s, 'p0', 'draw', {}, 0).ok);                 // QD
  const r = act(s, 'p1', 'draw', {}, 10);                // 2H, no clash with p0's pause
  assert(r.ok && r.matched, 'p1 matched');
  assert(act(s, 'p1', 'follow', { cardId: '2H' }, 20).ok);
  assert(act(s, 'p2', 'follow', { cardId: '10H' }, 20).ok);
  assert(act(s, 'p0', 'draw', {}, 600).ok);               // 9C
  assert(act(s, 'p0', 'draw', {}, 1100).matched);         // 3H
  assert(act(s, 'p0', 'follow', { cardId: '3H' }, 1200).ok);
  eq(s.phase, 'reveal'); eq(s.setResult.player, 'p2');
  conservation(s);
});

test('deck runs out after finding the suit: not stuck, must play it', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KH', deck: ['4H', 'QC'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'draw', {}, 0);       // 4H
  act(s, 'p0', 'draw', {}, 500);     // QC, deck empty
  eq(s.takers, [], 'holds a heart, so not stuck');
  const v = Burns.view(s, 'p0');
  assert(v.canFollow && !v.canDraw, 'can only play now');
  assert(act(s, 'p0', 'follow', { cardId: '4H' }, 600).ok);
});

// p0 holds a heart; p1 and p2 hold none.
const DE0 = ['2H', '3S', '4C', '4S'];
const DE1 = ['6S', '7S', '8C', '9D'];
const DE2 = ['10S', 'JS', 'QC', 'AD'];

test('deck runs out: stuck players pick up a card from the set', () => {
  const s = rigged({ hands: [DE0, DE1, DE2], starter: 'KH', deck: ['QD'] });
  Burns.tick(s, 0);
  assert(act(s, 'p0', 'follow', { cardId: '2H' }, 0).ok);
  assert(act(s, 'p1', 'draw', {}, 0).ok);          // QD; deck empty → p1 and p2 stuck
  eq(s.deck.length, 0);
  eq(s.takers.slice().sort(), ['p1', 'p2']);
  eq(s.phase, 'take', 'take phase begins once everyone else is in');
  eq(s.takeEndsAt, 10000);
  eq(s.turnEndsAt, null, 'set timer stops for the take phase');
  assert(Burns.view(s, 'p1').canTake);
  eq(act(s, 'p0', 'take', { cardId: 'KH' }, 100).code, 'not-taker');
  assert(act(s, 'p2', 'take', { cardId: 'KH' }, 200).ok);     // takes the starter
  eq(act(s, 'p1', 'take', { cardId: 'KH' }, 300).code, 'taken');
  assert(act(s, 'p1', 'take', { cardId: '2H' }, 400).ok);
  eq(s.phase, 'reveal');
  assert(ids(s.players[2].hand).includes('KH') && ids(s.players[1].hand).includes('2H'), 'cards in hands');
  eq(s.setResult.player, 'p0', 'a picked-up card still counts for the player who played it');
  conservation(s);
  Burns.tick(s, 600);
  conservation(s);
  eq(s.discard.filter(c => c.id === '2H' || c.id === 'KH').length, 0, 'picked-up cards are not put aside');
});

test('10-second limit: anyone who hasn’t chosen gets a random card', () => {
  const s = rigged({ hands: [DE0, DE1, DE2], starter: 'KH', deck: ['QD'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '2H' }, 0);
  act(s, 'p1', 'draw', {}, 0);
  assert(act(s, 'p1', 'take', { cardId: 'KH' }, 1000).ok);
  eq(Burns.tick(s, 9999), false, 'not before the deadline');
  eq(Burns.tick(s, 10000), true);
  eq(s.taken.p2, '2H', 'p2 was given the remaining card');
  eq(s.events.filter(e => e.type === 'take' && e.auto).length, 1);
  eq(s.phase, 'reveal');
});

test('stuck as soon as the suit is set when the deck is already empty', () => {
  const s = rigged({ hands: [DE0, DE1, DE2], starter: 'KH', deck: [] });
  Burns.tick(s, 0);
  eq(s.takers.slice().sort(), ['p1', 'p2']);
  act(s, 'p0', 'follow', { cardId: '2H' }, 0);
  eq(s.phase, 'take');
  Burns.tick(s, 10000);
  eq(Object.keys(s.taken).length, 2, 'two cards, two takers');
  conservation(s);
});

test('more stuck players than cards: a random one of them takes it', () => {
  const seen = { p0: 0, p1: 0 };
  for (let seed = 1; seed <= 80; seed++) {
    const s = rigged({ hands: [['2H', '3H', '4C', '5D'], ['6C', '7C', '8C', '9D'], DE2], starter: 'KH', deck: ['8H', '9H'] });
    s.rng = seed * 104729;
    Burns.tick(s, 0);
    act(s, 'p0', 'follow', { cardId: '2H' }, 0);
    act(s, 'p1', 'draw', {}, 0); act(s, 'p1', 'follow', { cardId: '8H' }, 0);
    act(s, 'p2', 'draw', {}, 0); act(s, 'p2', 'follow', { cardId: '9H' }, 0);   // p2 wins, deck empty
    eq(s.setResult.player, 'p2');
    Burns.tick(s, 100);
    act(s, 'p2', 'lead', { cardId: 'JS' }, 100);   // nobody else has spades
    eq(s.takers.slice().sort(), ['p0', 'p1']);
    eq(s.phase, 'take');
    Burns.tick(s, 10100);
    const got = Object.keys(s.taken);
    eq(got.length, 1, 'only one card to take');
    seen[got[0]]++;
    eq(s.setResult.player, 'p2', 'the leader still wins the set');
    conservation(s);
  }
  assert(seen.p0 > 15 && seen.p1 > 15, 'random choice is spread: ' + JSON.stringify(seen));
});

test('the leader’s card: suit only vs face up', () => {
  const mk = leadCard => {
    const s = rigged({ hands: [H0, H1], starter: 'KD', deck: ['QH', 'JH'], options: { leadCard } });
    Burns.tick(s, 0);
    act(s, 'p0', 'follow', { cardId: '5D' }); act(s, 'p1', 'follow', { cardId: '9D' });
    Burns.tick(s, 100);
    act(s, 'p1', 'lead', { cardId: '7S' }, 100);
    return Burns.view(s, 'p0', { sinceSeq: 0 });
  };
  const hidden = mk('suitOnly');
  eq(hidden.suit, 'S'); eq(hidden.table.find(e => e.via === 'lead').card, null);
  const lead = hidden.events.find(e => e.type === 'lead');
  eq(lead.card, null); eq(lead.mine, undefined);
  const shown = mk('faceUp');
  eq(shown.table.find(e => e.via === 'lead').card.id, '7S');
});

test('set timer: an idle leader leads a random card', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KD', deck: ['QH', 'JH'], options: { turnTime: '15' } });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5D' }, 100); act(s, 'p1', 'follow', { cardId: '9D' }, 200);
  Burns.tick(s, 300);                                    // set 2, p1 leads
  eq(s.turnEndsAt, 300 + 15000);
  eq(Burns.tick(s, 15299), false, 'not before time');
  eq(Burns.tick(s, 15300), true);
  eq(s.phase, 'follow');
  const e = s.table.find(x => x.via === 'lead');
  assert(e && e.owner === 'p1' && e.auto, 'random card led for p1');
  eq(s.events.filter(x => x.type === 'timeout').map(x => x.players), [['p1']]);
  eq(s.turnEndsAt, 15300 + 15000, 'followers get a fresh 15 seconds');
  conservation(s);
});

test('set timer: idle followers get a random card of the suit, or draw until one turns up', () => {
  const s = rigged({ hands: [['7S', '3H', '5H', '6S'], H0, ['8S', '9S', '10D', 'JD']], starter: 'KH', deck: ['QC', '7H', 'AH'] });
  Burns.tick(s, 0);
  eq(s.turnEndsAt, 30000, '30 seconds by default');
  Burns.tick(s, 30000);
  eq(s.committed.p0 && s.committed.p1, true);
  assert(['3H', '5H'].includes(s.table.find(e => e.owner === 'p0').card.id), 'p0 played one of their hearts');
  eq(s.table.find(e => e.owner === 'p1').card.id, '7H', 'p1 drew QC then 7H, and 7H was played');
  eq(s.drawn.p1, 2);
  // p2 had no hearts either: drew AH and played it
  eq(s.table.find(e => e.owner === 'p2').card.id, 'AH');
  eq(s.phase, 'reveal'); eq(s.setResult.player, 'p2');
  conservation(s);
});

test('set timer: running out of deck on a forced draw leads to the take phase', () => {
  const s = rigged({ hands: [DE0, DE1, DE2], starter: 'KH', deck: ['QD'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '2H' }, 0);
  Burns.tick(s, 30000);
  eq(s.phase, 'take');
  eq(s.takers.slice().sort(), ['p1', 'p2']);
  conservation(s);
});

test('first to empty their hand wins; a same-set tie goes to the higher card', () => {
  const s = rigged({ hands: [['5H'], ['9H'], ['2S', '3S']], starter: 'KH', deck: ['QC', 'QD', '4H'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5H' }, 0);
  act(s, 'p1', 'follow', { cardId: '9H' }, 0);
  act(s, 'p2', 'draw', {}, 0); act(s, 'p2', 'draw', {}, 500); act(s, 'p2', 'draw', {}, 1000);
  act(s, 'p2', 'follow', { cardId: '4H' }, 1100);
  eq(s.phase, 'over'); eq(s.winReason, 'empty'); eq(s.winners, ['p1']);
  eq(Burns.view(s, 'p0').players[2].hand.length, 4, 'hands are shown at game over');
});

test('leading your last card wins when the set ends', () => {
  const s = rigged({ hands: [['2S', '9C', '4D'], ['6S', '7S', '8C'], ['10S', 'QC']], starter: 'KC', deck: ['5H', '6H'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '9C' }, 0);
  act(s, 'p1', 'follow', { cardId: '8C' }, 0);
  act(s, 'p2', 'follow', { cardId: 'QC' }, 0);
  eq(s.setResult.player, 'p2');
  Burns.tick(s, 100);
  act(s, 'p2', 'lead', { cardId: '10S' }, 100);
  eq(s.phase, 'follow', 'the set is still played out');
  act(s, 'p0', 'follow', { cardId: '2S' }, 200);
  act(s, 'p1', 'follow', { cardId: '7S' }, 200);
  eq(s.phase, 'over'); eq(s.winners, ['p2']);
});

test('views never expose other hands or the deck order', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KD', deck: ['QH', 'JH'] });
  Burns.tick(s, 0);
  const json = JSON.stringify(Burns.view(s, 'p0', { sinceSeq: 0 }));
  ['6H', '7S', '8S', '9D', 'QH', 'JH'].forEach(id => assert(!json.includes('"' + id + '"'), 'leaked ' + id));
});

test('save and restore a session mid-game', () => {
  const players = [{ id: 'p0', name: 'You' }, { id: 'p1', name: 'B', isBot: true }, { id: 'p2', name: 'C', isBot: true }];
  const clock = new CT.ManualClock(0);
  const sess = new CT.Session({ modeId: 'burns', players, seed: 99, clock });
  for (let i = 0; i < 60; i++) { clock.advance(50); sess.tick(); }
  const saved = JSON.parse(JSON.stringify(sess.serialize()));
  const back = CT.Session.restore(saved);
  assert(back, 'restored');
  eq(back.state.seq, sess.state.seq);
  eq(CT.Session.restore(Object.assign({}, saved, { engineVersion: 1 })), null, 'saves from older rules are rejected');
});

/* ---------------------------------------------------------------------------
   Real Burns: play on until one is left holding cards, then the penalty round
   --------------------------------------------------------------------------- */
console.log('\nReal Burns');

const REAL = { real: 'on' };
// Rig the penalty deck: cards listed in the order they'll be turned over.
const penaltyDeck = (s, list) => { s.penalty.deck = list.map(card).reverse(); };
// Run the clock forward in small steps until a condition holds.
function until(s, cond, from, limit) {
  let t = from;
  while (!cond() && t < from + (limit || 120000)) { t += 50; Burns.tick(s, t); }
  assert(cond(), 'condition never met');
  return t;
}

test('emptying your hand makes you safe, and the rest play on', () => {
  const s = rigged({ hands: [['5H'], ['9H', '2S'], ['3H', '4S', '6C']], starter: 'KH', deck: [], options: REAL });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5H' }); act(s, 'p1', 'follow', { cardId: '9H' }); act(s, 'p2', 'follow', { cardId: '3H' });
  eq(s.phase, 'reveal', 'the game goes on'); eq(s.out, ['p0']); eq(s.setResult.player, 'p1');
  const v = Burns.view(s, 'p0');
  eq(v.players[0].out, true); eq(v.players[0].place, 1); eq(v.real, true);
  Burns.tick(s, 200);
  eq(s.phase, 'lead'); eq(s.leader, 'p1');
  eq(act(s, 'p0', 'draw', {}, 300).code, 'not-now', 'an out player has nothing to do');
  act(s, 'p1', 'lead', { cardId: '2S' }, 300);
  eq(act(s, 'p0', 'follow', { cardId: '5H' }, 300).ok, false);
  eq(s.phase, 'follow', 'only players still in owe a card');
  conservation(s);
});

test('a player who is out is offered nothing while the rest play on, even with cards in the deck', () => {
  const s = rigged({ hands: [['5H'], ['9H', '2S'], ['3H', '4S', '6C']], starter: 'KH', deck: ['7C', '8D', 'JS', 'QC'], options: REAL });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5H' }); act(s, 'p1', 'follow', { cardId: '9H' }); act(s, 'p2', 'follow', { cardId: '3H' });
  eq(s.out, ['p0']);
  Burns.tick(s, 200);
  act(s, 'p1', 'lead', { cardId: '2S' }, 300);
  eq(s.phase, 'follow'); assert(s.deck.length > 0, 'cards left to draw');
  const v = Burns.view(s, 'p0');
  eq([v.canFollow, v.canDraw, v.mustDraw, v.mayDraw, v.canTake, v.playable.length], [false, false, false, false, false, 0], 'nothing to do');
  eq(Burns.bot.intent(v), null, 'a computer player that is out waits');
  assert(Burns.view(s, 'p2').mayDraw, 'a player still in may draw');
  eq(act(s, 'p0', 'draw', {}, 400).code, 'out');
});

test('a set winner who goes out passes the lead to the next player still in', () => {
  const s = rigged({ hands: [['AH'], ['2H', '3S'], ['4H', '5S']], starter: 'KH', deck: [], options: REAL });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: 'AH' }); act(s, 'p1', 'follow', { cardId: '2H' }); act(s, 'p2', 'follow', { cardId: '4H' });
  eq(s.setResult.player, 'p0'); eq(s.leadFrom, 'p0'); eq(s.nextLeader, 'p1');
  Burns.tick(s, 200);
  eq(s.phase, 'lead'); eq(s.leader, 'p1');
  eq(Burns.view(s, 'p2').leadFrom, 'p0');
});

test('the last player holding cards loses; then the penalty round, clockwise from the loser', () => {
  const s = rigged({ hands: [['5H'], ['9H', '2S', '7D'], ['3H', '4S']], starter: 'KH', deck: [], options: REAL });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5H' }); act(s, 'p1', 'follow', { cardId: '9H' }); act(s, 'p2', 'follow', { cardId: '3H' });
  Burns.tick(s, 200);
  act(s, 'p1', 'lead', { cardId: '2S' }, 300); act(s, 'p2', 'follow', { cardId: '4S' }, 300);
  eq(s.out, ['p0', 'p2']); eq(s.loser, 'p1'); eq(s.phase, 'lost');
  until(s, () => s.phase === 'penalty', 300);
  eq(s.penalty.order, ['p2', 'p0'], 'winners take turns from the loser’s left');
  eq(s.penalty.step, 'shuffle'); eq(s.penalty.shuffler, 'p2');
  const v = Burns.view(s, 'p1');
  eq(v.canStop, true); eq(Burns.view(s, 'p2').canStop, false);
  conservation(s);
});

test('everyone still in goes out on the same set: the lowest card loses', () => {
  const s = rigged({ hands: [['5H'], ['9H', '2S'], ['3H', '4S']], starter: 'KH', deck: [], options: REAL });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5H' }); act(s, 'p1', 'follow', { cardId: '9H' }); act(s, 'p2', 'follow', { cardId: '3H' });
  Burns.tick(s, 200);
  act(s, 'p1', 'lead', { cardId: '2S' }, 300); act(s, 'p2', 'follow', { cardId: '4S' }, 300);
  eq(s.out, ['p0', 'p2']); eq(s.loser, 'p1', 'the 2 of spades was lowest');
});

test('the penalty round: Stop, a suit, cards turned over, soft and hard slaps', () => {
  const s = rigged({ hands: [['5H'], ['9H', '2S', '7D'], ['3H', '4S']], starter: 'KH', deck: [], options: REAL });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5H' }); act(s, 'p1', 'follow', { cardId: '9H' }); act(s, 'p2', 'follow', { cardId: '3H' });
  Burns.tick(s, 200);
  act(s, 'p1', 'lead', { cardId: '2S' }, 300); act(s, 'p2', 'follow', { cardId: '4S' }, 300);
  let t = until(s, () => s.phase === 'penalty', 300);
  eq(act(s, 'p2', 'stop', {}, t + 2000).code, 'not-loser', 'only the loser calls Stop');
  eq(act(s, 'p1', 'stop', {}, t + 100).code, 'wait', 'not the instant the shuffle starts');
  assert(act(s, 'p1', 'stop', {}, t + 2000).ok, 'stop');
  eq(s.penalty.step, 'suit');
  eq(act(s, 'p1', 'suit', { suit: 'X' }, t + 2100).code, 'bad-suit');
  eq(act(s, 'p0', 'suit', { suit: 'H' }, t + 2100).code, 'not-loser');
  penaltyDeck(s, ['2S', '3D', 'KC', 'QD', '7H', 'AH']);
  assert(act(s, 'p1', 'suit', { suit: 'H' }, t + 2100).ok, 'suit');
  const json = JSON.stringify(Burns.view(s, 'p1'));
  assert(!/"deck":\[\{/.test(json.split('"penalty"')[1] || ''), 'the order still to come stays hidden');
  t = until(s, () => s.penalty.step === 'result', t + 2100);
  eq(ids(s.penalty.drawn), ['2S', '3D', 'KC', 'QD', '7H'], 'stops at the first heart');
  eq([s.penalty.soft, s.penalty.hard, s.penalty.lucky], [2, 2, false], 'black soft, red hard, the heart itself doesn’t count');
  eq(Burns.view(s, 'p2').canNext, true);
  eq(act(s, 'p1', 'next', {}, t + 100).code, 'not-yours', 'the winner says when they’re done');
  assert(act(s, 'p2', 'next', {}, t + 100).ok, 'next');
  eq(s.penalty.shuffler, 'p0'); eq(s.penalty.step, 'shuffle');
  // second winner: a lucky first card
  assert(act(s, 'p1', 'stop', {}, t + 2000).ok);
  penaltyDeck(s, ['KS', '2H']);
  assert(act(s, 'p1', 'suit', { suit: 'S' }, t + 2100).ok);
  t = until(s, () => s.penalty.step === 'result', t + 2100);
  eq([s.penalty.drawn.length, s.penalty.soft, s.penalty.hard, s.penalty.lucky], [1, 0, 0, true], 'first card matches: no slaps');
  assert(act(s, 'p0', 'next', {}, t + 100).ok);
  eq(s.phase, 'over'); eq(s.winReason, 'real'); eq(s.winners, ['p0', 'p2']);
  const over = s.events.filter(e => e.type === 'gameOver')[0];
  eq([over.loser, over.soft, over.hard], ['p1', 2, 2]);
  eq(Burns.view(s, 'p0').penalty.results.map(r => [r.by, r.soft, r.hard, r.lucky]), [['p2', 2, 2, false], ['p0', 0, 0, true]]);
  conservation(s);
});

test('penalty time limits: the shuffle stops, a suit is picked, and the round moves on by itself', () => {
  const s = rigged({ hands: [['5H'], ['9H', '2S', '7D'], ['3H', '4S']], starter: 'KH', deck: [], options: REAL });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5H' }); act(s, 'p1', 'follow', { cardId: '9H' }); act(s, 'p2', 'follow', { cardId: '3H' });
  Burns.tick(s, 200);
  act(s, 'p1', 'lead', { cardId: '2S' }, 300); act(s, 'p2', 'follow', { cardId: '4S' }, 300);
  const t = until(s, () => s.phase === 'penalty', 300);
  until(s, () => s.penalty.step === 'suit', t);
  assert(s.events.some(e => e.type === 'penaltyStop' && e.auto), 'stopped by itself');
  until(s, () => s.penalty.step !== 'suit', t);
  assert(s.events.some(e => e.type === 'penaltySuit' && e.auto), 'suit picked by itself');
  until(s, () => s.phase === 'over', t, 400000);
  eq(s.penalty.results.length, 2);
});

test('Real Burns with the Flush rule: a Flush is safe at once; one player left loses straight away', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7S', '8H', '9H']], starter: 'KD', deck: ['QC'], options: { real: 'on', flush: 'on' } });
  Burns.tick(s, 0);
  eq(s.out, ['p0']); eq(s.players[0].hand.length, 0, 'the Flush is put aside'); eq(s.loser, 'p1'); eq(s.phase, 'lost');
  conservation(s);
  const t = until(s, () => s.phase === 'penalty', 0);
  eq(s.penalty.order, ['p0']);
  until(s, () => s.phase === 'over', t, 400000);
  eq(s.winners, ['p0']);
});

test('Real Burns with the Flush rule: with two or more left, play goes on without the Flush', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7S', '8H', '9H'], ['10S', 'JS', 'QH', 'KH']], starter: 'AH', deck: ['QC'], options: { real: 'on', flush: 'on' } });
  Burns.tick(s, 0);
  eq(s.out, ['p0']); eq(s.phase, 'follow'); eq(s.suit, 'H');
  eq(Burns.view(s, 'p0').canFollow, false);
  act(s, 'p1', 'follow', { cardId: '8H' }); act(s, 'p2', 'follow', { cardId: 'KH' });
  eq(s.phase, 'reveal', 'the set is decided without the Flush player');
});

test('Real Burns with the Flush rule: everyone holds a Flush, so nobody loses', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7H', '8C', '9D']], starter: 'AD', deck: [], options: { real: 'on', flush: 'on' } });
  Burns.tick(s, 0);
  eq(s.phase, 'over'); eq(s.loser, null); eq(s.winners, ['p0', 'p1']); eq(s.winReason, 'flush');
});

/* ---------------------------------------------------------------------------
   Simulations: all-bot games, plus games where one player never acts
   --------------------------------------------------------------------------- */
console.log('\nSimulations');

function walkCards(obj, fn) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(x => walkCards(x, fn)); return; }
  if (typeof obj.id === 'string' && typeof obj.rank === 'string' && typeof obj.suit === 'string') { fn(obj); return; }
  for (const k in obj) walkCards(obj[k], fn);
}

function simulate({ seed, nPlayers, options, spam, idle }) {
  const players = Array.from({ length: nPlayers }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: !(idle && i === 0) }));
  const clock = new CT.ManualClock(0);
  const sess = new CT.Session({ modeId: 'burns', players, options, seed, clock, botSeed: seed * 31 + 7 });
  const st = () => sess.state;
  const knows = {};
  players.forEach(p => { knows[p.id] = new Set(); });
  let lastSeq = -1;
  const lastDraw = {};
  const stats = { sets: 0, takePhases: 0, autoTakes: 0, timeouts: 0, extraDraws: 0, flush: false, maxHand: 0, spamBlocked: 0 };

  const check = () => {
    const s = st();
    conservation(s);
    if (s.seq === lastSeq) return;
    lastSeq = s.seq;
    if (s.table.length) s.table.forEach(e => assert(e.card.suit === s.suit, 'off-suit card on table'));
    // every player's knowledge grows only through legitimate channels
    s.players.forEach(p => {
      const K = knows[p.id];
      p.hand.forEach(c => K.add(c.id));
      s.discard.forEach(c => K.add(c.id));
      if (s.starter) K.add(s.starter.id);
      s.table.forEach(e => {
        if (s.revealed || s.phase === 'over' || e.owner === p.id || e.via === 'starter' || (e.via === 'lead' && s.options.leadCard === 'faceUp')) K.add(e.card.id);
      });
      if (s.phase === 'over') s.players.forEach(q => q.hand.forEach(c => K.add(c.id)));
      const v = sess.view(p.id, { sinceSeq: 0 });
      // the penalty round's cards come from a fresh deck of their own, turned over for everyone
      assert(!v.penalty || !('deck' in v.penalty), 'penalty deck order exposed');
      const game = Object.assign({}, v, { penalty: null, events: v.events.filter(ev => !/^penalty/.test(ev.type)) });
      walkCards(game, c => assert(K.has(c.id), p.id + ' can see ' + c.id + ' without knowing it (phase ' + s.phase + ')'));
      v.events.filter(ev => ev.type === 'draw').forEach(ev => assert(ev.matched === undefined, 'draw result made public'));
      if (s.phase === 'follow') {
        v.table.forEach(e => {
          if (e.owner && e.owner !== p.id && (e.via !== 'lead' || s.options.leadCard === 'suitOnly')) assert(e.card === null, 'hidden card exposed');
        });
      }
      stats.maxHand = Math.max(stats.maxHand, p.hand.length);
    });
  };

  const matchedAt = {};
  sess.on(() => {
    const s = st();
    s.events.forEach(ev => {
      if (ev._audited) return;
      ev._audited = true;
      if (ev.type === 'setStart') { for (const k in matchedAt) delete matchedAt[k]; }
      if (ev.type === 'timeout') stats.timeouts++;
      if (ev.type === 'takeStart') stats.takePhases++;
      if (ev.type === 'take' && ev.auto) stats.autoTakes++;
      if (ev.type !== 'draw') return;
      if (matchedAt[ev.player]) stats.extraDraws++;
      if (ev.secret[ev.player].matched) matchedAt[ev.player] = true;
      if (ev.auto) return;  // time-out draws happen all at once
      if (lastDraw[ev.player] != null) assert(ev.t - lastDraw[ev.player] >= s.timing.drawCooldownMs, 'draws too close');
      lastDraw[ev.player] = ev.t;
      if (spam) {
        const r = Burns.act(s, ev.player, 'draw', {}, clock.now());
        if (r.ok) throw new Error('spam draw accepted');
        if (r.code === 'cooldown') stats.spamBlocked++;
      }
    });
  });

  check();
  let guard = 0;
  while (st().phase !== 'over') {
    clock.advance(50);
    sess.tick();
    check();
    if (++guard > 400000) throw new Error('game did not finish (seed ' + seed + ')');
  }
  stats.sets = st().setNo;
  stats.flush = st().winReason === 'flush';
  stats.time = clock.now();
  if (options.real === 'on') realChecks(st(), stats);
  return stats;
}

/* A finished Real Burns game: everyone but the loser won, each winner had a
   penalty turn, and every turn's slaps match the cards turned over. */
function realChecks(s, stats) {
  if (!s.loser) { assert(s.winReason === 'flush' && s.winners.length === s.players.length, 'no loser only when everyone held a Flush'); return; }
  eq(s.winReason, 'real');
  assert(s.winners.indexOf(s.loser) < 0, 'the loser is not a winner');
  eq(s.winners.slice().sort(), s.players.map(p => p.id).filter(id => id !== s.loser).sort(), 'everyone else wins');
  const P = s.penalty;
  eq(P.results.map(r => r.by), P.order, 'every winner had a turn, in order');
  P.results.forEach(r => {
    const last = r.cards[r.cards.length - 1];
    assert(last.suit === r.suit, 'turning over stops at the chosen suit');
    const before = r.cards.slice(0, -1);
    assert(before.every(c => c.suit !== r.suit), 'no earlier card of the suit');
    eq(r.soft, before.filter(c => c.suit === 'S' || c.suit === 'C').length, 'soft slaps for black cards');
    eq(r.hard, before.filter(c => c.suit === 'H' || c.suit === 'D').length, 'hard slaps for red cards');
    eq(r.lucky, r.cards.length === 1, 'lucky only on a first-card match');
    stats.turns = (stats.turns || 0) + 1;
    stats.soft = (stats.soft || 0) + r.soft;
    stats.hard = (stats.hard || 0) + r.hard;
    stats.lucky = (stats.lucky || 0) + (r.lucky ? 1 : 0);
  });
  stats.lostWithCards = s.players.filter(p => p.id === s.loser)[0].hand.length > 0;
}

const configs = [];
[2, 3, 4, 5, 6].forEach(n => {
  [{ flush: 'off', leadCard: 'faceUp', turnTime: '30' }, { flush: 'on', leadCard: 'suitOnly', turnTime: '15' }].forEach(options => {
    configs.push({ n, options, games: 200 });
  });
  configs.push({ n, options: { flush: 'off', leadCard: 'suitOnly', turnTime: '15' }, games: 40, idle: true });
});

const summary = {};
let simFail = 0, total = 0;
const t0 = Date.now();
configs.forEach(({ n, options, games, idle }, ci) => {
  const key = n + 'p ' + options.leadCard + ' ' + options.turnTime + 's flush ' + options.flush + (idle ? ' · idle player' : '');
  const agg = { games: 0, flush: 0, sets: [], take: 0, timeouts: 0, extra: 0, maxHand: 0, minutes: [], spamBlocked: 0 };
  for (let g = 0; g < games; g++) {
    const seed = 5000 + ci * 1000 + g;
    total++;
    try {
      const r = simulate({ seed, nPlayers: n, options, spam: g % 4 === 0, idle });
      agg.games++;
      if (r.flush) agg.flush++; else { agg.sets.push(r.sets); agg.minutes.push(r.time / 60000); }
      agg.take += r.takePhases; agg.timeouts += r.timeouts; agg.extra += r.extraDraws;
      agg.maxHand = Math.max(agg.maxHand, r.maxHand);
      agg.spamBlocked += r.spamBlocked;
    } catch (e) {
      simFail++;
      if (simFail < 6) console.log('  ✗ ' + key + ' seed ' + seed + ': ' + e.message);
    }
  }
  if (options.flush === 'off' && agg.flush) { simFail++; console.log('  ✗ ' + key + ': a Flush won with the rule off'); }
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0;
  const sorted = agg.sets.slice().sort((a, b) => a - b);
  summary[key] = {
    games: agg.games,
    flushPct: Math.round(100 * agg.flush / agg.games),
    avgSets: avg(agg.sets).toFixed(1),
    p95Sets: sorted[Math.floor(sorted.length * 0.95)] || 0,
    takesPerGame: (agg.take / agg.games).toFixed(2),
    timeoutsPerGame: (agg.timeouts / agg.games).toFixed(2),
    extraDrawsPerGame: (agg.extra / agg.games).toFixed(2),
    avgMinutes: avg(agg.minutes).toFixed(1),
    maxHand: agg.maxHand
  };
});
if (simFail === 0) { passed++; console.log('  ✓ ' + total + ' simulated games finished with every invariant intact (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
else { failed++; console.log('  ✗ ' + simFail + ' simulated games failed'); }
console.table(summary);

/* Real Burns: all-bot games to the last player, and the penalty round. */
const realSummary = {};
let realFail = 0, realTotal = 0;
const t1 = Date.now();
[2, 3, 4, 5, 6].forEach((n, ni) => {
  [{ real: 'on', flush: 'off', leadCard: 'faceUp', turnTime: '30' }, { real: 'on', flush: 'on', leadCard: 'suitOnly', turnTime: '15' }].forEach((options, oi) => {
    const idle = oi === 1 && n >= 4;   // a person who never acts, in some games
    const key = n + 'p flush ' + options.flush + (idle ? ' · idle player' : '');
    const agg = { games: 0, sets: [], minutes: [], turns: 0, soft: 0, hard: 0, lucky: 0, emptyLosers: 0, noLoser: 0 };
    const games = idle ? 12 : 120;
    for (let g = 0; g < games; g++) {
      const seed = 90000 + ni * 1000 + oi * 400 + g;
      realTotal++;
      try {
        const r = simulate({ seed, nPlayers: n, options, spam: g % 5 === 0, idle });
        agg.games++;
        agg.sets.push(r.sets); agg.minutes.push(r.time / 60000);
        agg.turns += r.turns || 0; agg.soft += r.soft || 0; agg.hard += r.hard || 0; agg.lucky += r.lucky || 0;
        if (r.turns && !r.lostWithCards) agg.emptyLosers++;
        if (!r.turns) agg.noLoser++;
      } catch (e) {
        realFail++;
        if (realFail < 6) console.log('  ✗ Real Burns ' + key + ' seed ' + seed + ': ' + e.message);
      }
    }
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0;
    realSummary[key] = {
      games: agg.games,
      avgSets: avg(agg.sets).toFixed(1),
      avgMinutes: avg(agg.minutes).toFixed(1),
      slapsPerTurn: agg.turns ? ((agg.soft + agg.hard) / agg.turns).toFixed(2) : '-',
      softPerTurn: agg.turns ? (agg.soft / agg.turns).toFixed(2) : '-',
      hardPerTurn: agg.turns ? (agg.hard / agg.turns).toFixed(2) : '-',
      luckyPct: agg.turns ? Math.round(100 * agg.lucky / agg.turns) : '-',
      tiedOutLosers: agg.emptyLosers,
      noLoser: agg.noLoser
    };
  });
});
if (realFail === 0) { passed++; console.log('  ✓ ' + realTotal + ' Real Burns games played to a loser and through the penalty round (' + ((Date.now() - t1) / 1000).toFixed(1) + 's)'); }
else { failed++; console.log('  ✗ ' + realFail + ' Real Burns games failed'); }
console.table(realSummary);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
