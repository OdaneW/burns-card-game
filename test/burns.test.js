/* Burns rules tests: hand-built scenarios plus thousands of all-bot games
   checked for card conservation, follow-suit, privacy, cooldowns and timers.
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

test('a Flush on the deal wins immediately', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7S', '8H', '9H']], starter: 'KD', deck: ['QC'] });
  Burns.tick(s, 0);
  eq(s.phase, 'over'); eq(s.winners, ['p0']); eq(s.winReason, 'flush');
  conservation(s);
});

test('two Flushes share the win', () => {
  const s = rigged({ hands: [['2S', '3H', '4C', '5D'], ['6S', '7H', '8C', '9D'], ['10S', 'JS', 'QS', 'KS']], starter: 'AD', deck: [] });
  Burns.tick(s, 0);
  eq(s.winners, ['p0', 'p1']);
});

test('no Flush: set 1 follows the starter card’s suit', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KD', deck: ['QC'] });
  Burns.tick(s, 0);
  eq(s.phase, 'follow'); eq(s.setNo, 1); eq(s.suit, 'D'); eq(s.leader, null);
  eq(s.table.map(e => e.via), ['starter']);
  conservation(s);
});

test('must follow suit; cannot draw while holding the suit', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KD', deck: ['QC'] });
  Burns.tick(s, 0);
  eq(act(s, 'p0', 'draw').code, 'has-suit');
  eq(act(s, 'p0', 'follow', { cardId: '2S' }).code, 'wrong-suit');
  assert(act(s, 'p0', 'follow', { cardId: '5D' }).ok);
  eq(act(s, 'p0', 'follow', { cardId: '4C' }).code, 'done');
});

test('cards stay hidden until everyone has played, then reveal together', () => {
  const s = rigged({ hands: [H0, H1, H2], starter: 'KD', deck: ['QH'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5D' });
  const v1 = Burns.view(s, 'p1');
  eq(v1.table.find(e => e.owner === 'p0').card, null, 'p0 card visible to p1 before reveal');
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
  assert(act(s, 'p1', 'lead', { cardId: '6H' }, 100).ok);
  eq(s.suit, 'H'); eq(s.phase, 'follow');
  eq(s.discard.filter(c => ['5D', '9D', 'KD'].includes(c.id)).length, 3, 'previous set put aside');
});

test('no suit: draw until one turns up, then it is played; pause between draws', () => {
  const s = rigged({ hands: [H0, H1], starter: 'KH', deck: ['QC', '4H', 'JS'] });
  Burns.tick(s, 0);
  eq(act(s, 'p0', 'follow', { cardId: '2S' }).code, 'wrong-suit');
  const r1 = act(s, 'p0', 'draw', {}, 1000);
  assert(r1.ok && !r1.matched, 'first draw off-suit');
  eq(ids(s.players[0].hand), ['2S', '3S', '4C', '5D', 'QC']);
  const spam = act(s, 'p0', 'draw', {}, 1200);
  eq(spam.code, 'cooldown'); assert(spam.retryInMs === 300, 'retry ' + spam.retryInMs);
  const r2 = act(s, 'p0', 'draw', {}, 1500);
  assert(r2.ok && r2.matched, 'second draw matches');
  assert(s.committed.p0, 'committed');
  eq(s.table.find(e => e.owner === 'p0').card.id, '4H');
  eq(s.table.find(e => e.owner === 'p0').via, 'draw');
  assert(s.voids.p0.includes('H'), 'known to be out of hearts');
  conservation(s);
});

test('several players draw at the same time from one deck', () => {
  const s = rigged({ hands: [H0, ['6S', '7S', '8C', '9D'], H2], starter: 'KH', deck: ['QD', '2H', '9C', '3H'] });
  Burns.tick(s, 0);
  assert(act(s, 'p0', 'draw', {}, 0).ok);                 // QD
  const r = act(s, 'p1', 'draw', {}, 10);                // 2H, no clash with p0's pause
  assert(r.ok && r.matched, 'p1 matched');
  assert(act(s, 'p2', 'follow', { cardId: '10H' }, 20).ok);
  assert(act(s, 'p0', 'draw', {}, 600).ok);               // 9C
  const r3 = act(s, 'p0', 'draw', {}, 1100);             // 3H
  assert(r3.ok && r3.matched, 'p0 matched');
  eq(s.phase, 'reveal'); eq(s.setResult.player, 'p2');
  conservation(s);
});

// p0 holds a heart; p1 and p2 hold none.
const DE0 = ['2H', '3S', '4C', '4S'];
const DE1 = ['6S', '7S', '8C', '9D'];
const DE2 = ['10S', 'JS', 'QC', 'AD'];

test('deck runs out: stuck players pick up a card from the set (Pick up)', () => {
  const s = rigged({ hands: [DE0, DE1, DE2], starter: 'KH', deck: ['QD'] });
  Burns.tick(s, 0);
  assert(act(s, 'p0', 'follow', { cardId: '2H' }, 0).ok);
  assert(act(s, 'p1', 'draw', {}, 0).ok);          // QD; deck empty → p1 and p2 stuck
  eq(s.deck.length, 0);
  eq(s.takers.slice().sort(), ['p1', 'p2']);
  eq(s.phase, 'take', 'take phase begins once everyone else is in');
  eq(s.takeEndsAt, 10000);
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
    act(s, 'p1', 'draw', {}, 0);   // 8H
    act(s, 'p2', 'draw', {}, 0);   // 9H → p2 wins the set, deck empty
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

test('Take and play: the taken card counts for the taker', () => {
  const s = rigged({ hands: [DE0, DE1, ['10H', 'JS', 'QC', 'QS']], starter: '3H', deck: ['QD'], options: { deckEmpty: 'takeAndPlay' } });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '2H' }, 0);
  act(s, 'p2', 'follow', { cardId: '10H' }, 0);
  act(s, 'p1', 'draw', {}, 0);   // QD → deck empty, p1 stuck
  eq(s.phase, 'take');
  assert(act(s, 'p1', 'take', { cardId: '10H' }, 500).ok);
  eq(s.phase, 'reveal');
  eq(s.setResult.player, 'p1', 'taker wins with the taken 10H');
  eq(s.players[1].hand.length, 5, 'taker’s hand unchanged by the take');
  Burns.tick(s, 600);
  conservation(s);
  assert(s.discard.some(c => c.id === '10H'), 'taken card is put aside with the set');
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

test('first to empty their hand wins; a same-set tie goes to the higher card', () => {
  const s = rigged({ hands: [['5H'], ['9H'], ['2S', '3S']], starter: 'KH', deck: ['QC', 'QD', '4H'] });
  Burns.tick(s, 0);
  act(s, 'p0', 'follow', { cardId: '5H' }, 0);
  act(s, 'p1', 'follow', { cardId: '9H' }, 0);
  act(s, 'p2', 'draw', {}, 0); act(s, 'p2', 'draw', {}, 500); act(s, 'p2', 'draw', {}, 1000);
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
  eq(CT.Session.restore(Object.assign({}, saved, { engineVersion: 999 })), null, 'incompatible save rejected');
});

/* ---------------------------------------------------------------------------
   All-bot simulations
   --------------------------------------------------------------------------- */
console.log('\nSimulations');

function walkCards(obj, fn) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach(x => walkCards(x, fn)); return; }
  if (typeof obj.id === 'string' && typeof obj.rank === 'string' && typeof obj.suit === 'string') { fn(obj); return; }
  for (const k in obj) walkCards(obj[k], fn);
}

function simulate({ seed, nPlayers, options, spam }) {
  const players = Array.from({ length: nPlayers }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true }));
  const clock = new CT.ManualClock(0);
  const sess = new CT.Session({ modeId: 'burns', players, options, seed, clock, botSeed: seed * 31 + 7 });
  const st = () => sess.state;
  const knows = {};
  players.forEach(p => { knows[p.id] = new Set(); });
  let lastSeq = -1;
  const lastDraw = {};
  const stats = { sets: 0, takePhases: 0, autoTakes: 0, draws: 0, flush: false, maxHand: 0, spamBlocked: 0 };

  const check = () => {
    const s = st();
    conservation(s);
    if (s.seq === lastSeq) return;
    lastSeq = s.seq;
    // follow-suit on the table
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
      walkCards(v, c => assert(K.has(c.id), p.id + ' can see ' + c.id + ' without knowing it (phase ' + s.phase + ')'));
      if (s.phase === 'follow') {
        v.table.forEach(e => {
          if (e.owner && e.owner !== p.id && (e.via !== 'lead' || s.options.leadCard === 'suitOnly')) assert(e.card === null, 'hidden card exposed');
        });
      }
      stats.maxHand = Math.max(stats.maxHand, p.hand.length);
    });
  };

  sess.on(() => {
    const s = st();
    const e = s.events[s.events.length - 1];
    // cooldown audit: scan new draw events
    s.events.forEach(ev => {
      if (ev.type !== 'draw' || ev._audited) return;
      ev._audited = true;
      stats.draws++;
      if (lastDraw[ev.player] != null) assert(ev.t - lastDraw[ev.player] >= s.timing.drawCooldownMs, 'draws too close');
      lastDraw[ev.player] = ev.t;
      if (spam) {
        const r = Burns.act(s, ev.player, 'draw', {}, clock.now());
        if (r.ok) {
          // allowed only if the player was no longer drawing
          throw new Error('spam draw accepted');
        }
        if (r.code === 'cooldown') stats.spamBlocked++;
      }
    });
    if (e && e.type === 'takeStart') stats.takePhases++;
    if (e && e.type === 'take' && e.auto) stats.autoTakes++;
  });

  check();
  let guard = 0;
  while (st().phase !== 'over') {
    clock.advance(50);
    sess.tick();
    check();
    if (++guard > 200000) throw new Error('game did not finish (seed ' + seed + ')');
  }
  stats.sets = st().setNo;
  stats.flush = st().winReason === 'flush';
  stats.time = clock.now();
  stats.winners = st().winners;
  return stats;
}

const configs = [];
[2, 3, 4, 5, 6].forEach(n => {
  [{ deckEmpty: 'pickUp', leadCard: 'suitOnly' }, { deckEmpty: 'takeAndPlay', leadCard: 'faceUp' }, { deckEmpty: 'pickUp', leadCard: 'faceUp' }, { deckEmpty: 'takeAndPlay', leadCard: 'suitOnly' }]
    .forEach(options => configs.push({ n, options }));
});

const summary = {};
let simFail = 0;
const t0 = Date.now();
configs.forEach(({ n, options }, ci) => {
  const games = 120;
  const key = n + 'p ' + options.deckEmpty + '/' + options.leadCard;
  const agg = { games: 0, flush: 0, sets: [], take: 0, auto: 0, maxHand: 0, minutes: [], spamBlocked: 0 };
  for (let g = 0; g < games; g++) {
    const seed = 1000 + ci * 1000 + g;
    try {
      const r = simulate({ seed, nPlayers: n, options, spam: g % 4 === 0 });
      agg.games++;
      if (r.flush) agg.flush++; else agg.sets.push(r.sets);
      agg.take += r.takePhases; agg.auto += r.autoTakes; agg.maxHand = Math.max(agg.maxHand, r.maxHand);
      if (!r.flush) agg.minutes.push(r.time / 60000);
      agg.spamBlocked += r.spamBlocked;
    } catch (e) {
      simFail++;
      if (simFail < 6) console.log('  ✗ ' + key + ' seed ' + seed + ': ' + e.message);
    }
  }
  const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0;
  const sorted = agg.sets.slice().sort((a, b) => a - b);
  summary[key] = {
    games: agg.games,
    flushPct: Math.round(100 * agg.flush / agg.games),
    avgSets: avg(agg.sets).toFixed(1),
    p95Sets: sorted[Math.floor(sorted.length * 0.95)] || 0,
    takePhasesPerGame: (agg.take / agg.games).toFixed(2),
    avgMinutes: avg(agg.minutes).toFixed(1),
    maxHand: agg.maxHand,
    spamBlocked: agg.spamBlocked
  };
});
if (simFail === 0) { passed++; console.log('  ✓ ' + configs.length * 120 + ' all-bot games finished with every invariant intact (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
else { failed++; console.log('  ✗ ' + simFail + ' simulated games failed'); }
console.table(summary);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
