/* Plays Burns through the real UI in headless Chromium at phone size,
   tapping cards and the deck like a person would, and saves screenshots.
   Usage: node test/ui-run.js <outDir> [scenario]  */
'use strict';
const fs = require('fs');
const path = require('path');
// Needs Playwright with Chromium: npm i -D playwright && npx playwright install chromium
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const OUT = process.argv[2] || '/tmp/shots';
const SCENARIO = process.argv[3] || 'phone';
const FONTS = path.join(__dirname, '..', 'src', 'assets', 'fonts');
fs.mkdirSync(OUT, { recursive: true });

// Emulate the artifact page skeleton; local font files stand in for Google Fonts.
const page = fs.readFileSync(path.join(__dirname, '..', 'dist', 'burns.html'), 'utf8');
const wrapper = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>
<style>
@font-face{font-family:'Bungee';src:url('file://${FONTS}/bungee-latin-400-normal.woff2') format('woff2')}
@font-face{font-family:'Young Serif';src:url('file://${FONTS}/young-serif-latin-400-normal.woff2') format('woff2')}
@font-face{font-family:'Bricolage Grotesque';src:url('file://${FONTS}/bricolage-grotesque-latin-wght-normal.woff2') format('woff2-variations');font-weight:200 800}
</style></head><body>${page}</body></html>`;
const wrapperPath = path.join(OUT, 'index.html');
fs.writeFileSync(wrapperPath, wrapper);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ deviceScaleFactor: 2, isMobile: true, hasTouch: true }, opts.ctx));
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/ERR_FAILED|ERR_ABORTED/.test(m.text())) p.errors.push('console: ' + m.text()); });
  await p.route('**/fonts.googleapis.com/**', r => r.abort());
  await p.route('**/fonts.gstatic.com/**', r => r.abort());
  await p.addInitScript(({ seed, settings, speed }) => {
    let a = seed >>> 0;
    Math.random = function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    if (speed && speed !== 1) { const pn = performance.now.bind(performance); const t0 = pn(); performance.now = () => t0 + (pn() - t0) * speed; }
  }, { seed: opts.seed || 1, settings: opts.settings || null, speed: opts.speed || 1 });
  await p.goto('file://' + wrapperPath, { waitUntil: 'domcontentloaded' });
  // start from clean storage (plus any preset settings), then load again. Unless
  // the scenario is about a first visit, the tutorials count as already offered,
  // so Play goes straight to the setup screen.
  const preset = Object.assign({}, opts.firstVisit ? {} : { 'cardtable.tutorials.v1': { burns: 'offered', donkey: 'offered', bull: 'offered' } }, opts.storage || {});
  if (opts.settings) preset['cardtable.settings.v1'] = opts.settings;
  await p.evaluate(preset => {
    localStorage.clear();
    Object.keys(preset).forEach(k => localStorage.setItem(k, JSON.stringify(preset[k])));
  }, preset);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await sleep(500);
  return p;
}

async function shot(p, name) {
  await p.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('  shot', name);
}

async function view(p) {
  return p.evaluate(() => {
    const s = CT.App.session; if (!s) return null;
    const v = s.view('p0', { events: false });
    return { phase: v.phase, setNo: v.setNo, canLead: v.canLead, canFollow: v.canFollow, mustDraw: v.mustDraw, mayDraw: v.mayDraw, canTake: v.canTake,
      turnLeft: v.turnEndsAt ? v.turnEndsAt - s.now() : null, drew: (v.players.find(x => x.id === 'p0') || {}).drew || 0,
      playable: v.playable, hand: v.hand.length, deck: v.deckCount, winners: v.winners, reason: v.winReason,
      takers: v.players.filter(x => x.isTaker).length, sheet: CT.App.sheet };
  });
}

/* Play one game through the UI. `want` lists screenshots to take on first occurrence. */
async function playGame(p, tag, want) {
  const seen = {};
  const once = async (key, name, wait) => {
    if (!want.includes(key) || seen[key]) return;
    seen[key] = true;
    if (wait) await sleep(wait);
    await shot(p, tag + '-' + name);
  };
  let guard = 0;
  let v = await view(p);
  while (v && v.phase !== 'over' && guard++ < 3000) {
    if (v.phase === 'dealing') await once('deal', 'dealing', 650);
    if (v.mayDraw) await once('found', 'found-suit', 350);
    if (v.mayDraw && v.drew < 2 && Math.random() < 0.25) {
      await p.tap('#t-deck');          // keep drawing for a better card
      await sleep(560);
    } else if (v.canLead || v.canFollow) {
      const id = v.playable[Math.floor(Math.random() * v.playable.length)];
      await once(v.canLead ? 'lead' : 'follow', v.canLead ? 'your-lead' : 'follow', 300);
      await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } });   // the visible left edge of an overlapped card
      await sleep(160);
      await once('selected', 'selected', 0);
      await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } });   // the visible left edge of an overlapped card
      await sleep(250);
    } else if (v.mustDraw) {
      await p.tap('#t-deck');
      await sleep(80);
      await p.tap('#t-deck');          // a spam tap inside the pause should be ignored
      await sleep(470);
      await once('draw', 'drawing', 0);
    } else if (v.canTake) {
      await once('take', 'take-you', 1200);
      const t = await p.$('[data-take]');
      if (t) await t.tap();
      await sleep(250);
    } else {
      if (v.phase === 'take') await once('takeOther', 'take-others', 600);
      if (v.phase === 'reveal') await once('reveal', 'reveal', 1300);
      await sleep(120);
    }
    v = await view(p);
  }
  if (!v || v.phase !== 'over') throw new Error('game did not finish');
  await sleep(2900);
  if (want.includes('result')) await shot(p, tag + '-result');
  return v;
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (SCENARIO === 'phone') {
      const p = await open(browser, { ctx: { viewport: { width: 390, height: 780 } }, seed: 11 });
      await shot(p, '01-home');
      await p.tap('[data-play="burns"]');
      await sleep(300);
      await shot(p, '02-setup');
      await p.tap('#s-deal');
      let games = 0, v;
      do {
        games++;
        v = await playGame(p, '03-g' + games, ['deal', 'follow', 'selected', 'draw', 'found', 'take', 'takeOther', 'reveal', 'lead', 'result']);
        console.log('  game', games, '→', v.reason, 'winners', v.winners, 'set', v.setNo);
        if (v.reason === 'flush' && games < 4) { await p.tap('#r-again'); await sleep(300); }
      } while (v.reason === 'flush' && games < 4);
      // menu, log and rules sheets
      await p.tap('#r-table');
      await sleep(300);
      await p.tap('#t-menu');
      await sleep(300);
      await shot(p, '04-menu');
      await p.tap('#m-log');
      await sleep(300);
      await shot(p, '05-log');
      await p.tap('[data-close]');
      await p.tap('#t-menu');
      await sleep(200);
      await p.tap('#m-rules');
      await sleep(300);
      await shot(p, '06-rules');
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (SCENARIO === 'small') {
      // 360×640, five opponents, Flush rule on, double speed
      const p = await open(browser, { ctx: { viewport: { width: 360, height: 640 } }, seed: 4242, speed: 2,
        settings: { format: 2, burns: { opponents: 5, options: { flush: 'on' } } } });
      await p.tap('[data-play="burns"]');
      await sleep(200);
      await p.tap('#s-deal');
      let games = 0, real = 0, v;
      while (real < 2 && games < 10) {
        games++;
        v = await playGame(p, '07-small-g' + games, real === 0 ? ['follow', 'take', 'takeOther', 'reveal', 'draw', 'lead', 'result'] : ['take', 'takeOther']);
        console.log('  game', games, '→', v.reason, 'winners', v.winners, 'set', v.setNo);
        if (v.reason !== 'flush') real++;
        await p.tap('#r-again'); await sleep(300);
      }
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (SCENARIO === 'donkey' || SCENARIO === 'donkey-tie') {
      const p = await open(browser, { ctx: { viewport: { width: 390, height: 844 } }, seed: SCENARIO === 'donkey' ? 21 : 8, speed: 2 });
      if (SCENARIO === 'donkey') await shot(p, '50-home-two-games');
      await p.tap('[data-play="donkey"]');
      await sleep(300);
      if (SCENARIO === 'donkey') await shot(p, '51-donkey-setup');
      await p.tap('#s-deal');
      await sleep(300);
      const dview = () => p.evaluate(() => {
        const s = CT.App.session; if (!s) return null;
        const v = s.view('p0', { events: false });
        const n = {}; v.hand.forEach(c => { n[c.rank] = (n[c.rank] || 0) + 1; });
        let pick = null;
        if (v.canPass) { const min = Math.min(...v.hand.map(c => n[c.rank])); pick = v.hand.filter(c => n[c.rank] === min)[0].id; }
        const d = v.tiebreak && v.tiebreak.duel;
        const call = d && d.myCard ? (CT.rankValue(d.myCard.rank, true) >= 7 ? 'higher' : 'lower') : null;
        return { phase: v.phase, round: v.round, canPass: v.canPass, canDeclare: v.canDeclare, canReact: v.canReact,
          canChallenge: v.canChallenge, canCall: v.canCall, pick, call, step: d ? d.step : null, sheet: CT.App.sheet,
          letters: v.players.map(x => x.letters) };
      });
      if (SCENARIO === 'donkey-tie') {
        // jump to the end with a three-way tie for 1st that includes you, as challenger
        let v0 = await dview();
        while (v0.phase !== 'pass') { await sleep(150); v0 = await dview(); }
        await p.evaluate(() => {
          const s = CT.App.session, st = s.state;
          st.players.forEach((pl, i) => { pl.letters = [1, 1, 1, 6][i]; });
          st.result = { round: st.round, declarer: 'p0', rank: 'K', order: [], late: [], losers: ['p3'] };
          st.declare = null; st.race = null; st.turn = null; st.turnEndsAt = null;
          st.phase = 'roundEnd'; st.phaseEndsAt = s.now();
        });
        await sleep(200);
        await p.evaluate(() => {
          const s = CT.App.session, d = s.state.tiebreak.duel;
          d.challenger = 'p0';
          s._changed({ type: 'test' });
        });
      }
      const shots = {};
      const once = async (key, name, wait) => { if (shots[key]) return; shots[key] = 1; if (wait) await sleep(wait); await shot(p, name); };
      let guard = 0, v = await dview(), races = 0, lost = 0;
      while (v && v.phase !== 'over' && guard++ < 8000) {
        if (v.phase === 'dealing') await once('deal', '52-donkey-dealing', 450);
        if (v.canDeclare) {
          await once('four', '53-donkey-four-button', 150);
          await p.tap('#d-declare'); await sleep(250);
        } else if (v.canPass) {
          await once('pass', '54-donkey-your-turn', 250);
          await p.tap(`.hcard[data-id="${v.pick}"]`, { position: { x: 10, y: 24 } }); await sleep(120);
          await once('sel', '55-donkey-selected', 0);
          await p.tap(`.hcard[data-id="${v.pick}"]`, { position: { x: 10, y: 24 } }); await sleep(250);
        } else if (v.canReact) {
          races++;
          await once('race', '56-donkey-race', 0);
          await sleep(120 + Math.random() * 450);
          try { await p.tap('#d-slap', { timeout: 1500 }); } catch (e) { /* the race may have ended */ }
          await sleep(150);
        } else if (v.canChallenge) {
          await once('choose', '58-donkey-choose', 300);
          await p.tap('#d-choices button'); await sleep(300);
        } else if (v.canCall) {
          await once('call', '59-donkey-call', 300);
          await p.tap(`#d-choices [data-call="${v.call}"]`); await sleep(300);
        } else {
          if (v.phase === 'pass') await once('others', '54b-donkey-others-passing', 150);
          if (v.phase === 'declared') await once('declared', '56a-donkey-four-down', 120);
          if (v.phase === 'roundEnd') await once('roundEnd', '57-donkey-round-end', 650);
          if (v.phase === 'tiebreak' && v.step === 'call') await once('duelCall', '59b-donkey-duel-waiting', 300);
          if (v.phase === 'tiebreak' && v.step === 'reveal') await once('reveal', '60-donkey-duel-reveal', 350);
          await sleep(90);
        }
        v = await dview();
      }
      if (!v || v.phase !== 'over') throw new Error('Donkey game did not finish');
      const end = await p.evaluate(() => {
        const st = CT.App.session.state;
        return { rounds: st.round, letters: st.players.map(x => x.letters), standings: st.standings, ties: st.events.filter(e => e.type === 'duel').length };
      });
      console.log('  game over:', JSON.stringify(end), '· races you were in:', races);
      await sleep(3000);
      await shot(p, SCENARIO === 'donkey' ? '61-donkey-result' : '62-donkey-tie-result');
      if (SCENARIO === 'donkey') {
        await p.tap('#r-table'); await sleep(300);
        await p.tap('#d-menu'); await sleep(300);
        await p.tap('#m-log'); await sleep(300);
        await shot(p, '63-donkey-log');
        await p.tap('[data-close]'); await sleep(200);
        await p.tap('#d-menu'); await sleep(200);
        await p.tap('#m-rules'); await sleep(300);
        await shot(p, '64-donkey-rules');
      }
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (/^donkey-tutorial/.test(SCENARIO)) {
      // Follow the Pass-Roun Donkey tutorial from How to play to the end,
      // on a phone (default), a small phone, a phone on its side, or a desktop.
      const size = {
        'donkey-tutorial': { viewport: { width: 390, height: 844 } },
        'donkey-tutorial-small': { viewport: { width: 360, height: 640 } },
        'donkey-tutorial-landscape': { viewport: { width: 844, height: 390 } },
        'donkey-tutorial-wide': { viewport: { width: 1280, height: 820 }, isMobile: false, deviceScaleFactor: 1 }
      }[SCENARIO];
      const p = await open(browser, { ctx: size, seed: 4 });
      await p.tap('[data-rules="donkey"]');
      await sleep(350);
      await shot(p, '70-donkey-how-to-play');
      await p.evaluate(() => {
        const T = CT.UI.tutorials.donkey.prototype;
        const log = window.__tut = [];
        const render = T.render, check = T.check;
        T.render = function () {
          render.call(this);
          const s = this.current();
          log.push({ key: 'L' + (this.index + 1) + '-S' + (this.step + 1), t: performance.now(), reading: this.readingTime(),
            kind: s.next || s.final ? 'read' : s.watch ? 'watch' : 'act', how: s.next || s.final ? 'next' : 'player' });
        };
        T.check = function () {
          const was = this.advancing;
          check.call(this);
          const s = this.current(), last = log[log.length - 1];
          if (!was && this.advancing && s && s.watch && last) {
            last.how = !this.holding ? 'auto' : document.querySelector('.coach-actions:not([hidden]) .btn-primary') ? 'next' : 'held-auto';
          }
        };
      });
      await p.tap('#r-tutorial');
      await sleep(500);
      const seen = [], checks = [], back = {};
      let guard = 0, triedKing = false;
      const state = () => p.evaluate(() => {
        const t = CT.App.tutorial; if (!t) return { done: true };
        const s = t.current(); const v = CT.App.session.view('p0', { events: false });
        const held = !s.next && !s.final && !!document.querySelector('.coach-actions:not([hidden]) .btn-primary');
        const spare = v.hand.filter(c => c.rank !== 'K').map(c => c.id);
        return { done: false, lesson: t.index, step: t.step, next: !!s.next, final: !!s.final, held, phase: v.phase,
          canPass: v.canPass, canDeclare: v.canDeclare, canReact: v.canReact, canCall: v.canCall, spare, king: (v.hand.find(c => c.rank === 'K') || {}).id,
          hand: v.hand.map(c => c.id).join(' '), letters: v.players.map(x => x.letters).join(''), toast: (document.querySelector('#toast.show') || {}).textContent || '' };
      });
      while (guard++ < 900) {
        const st = await state();
        if (st.done) break;
        const key = 'L' + (st.lesson + 1) + '-S' + (st.step + 1);
        if (!seen.includes(key)) { seen.push(key); await sleep(450); await shot(p, '71-dtut-' + key); }
        if (st.final) break;
        // Previous: from the four-of-a-kind step, and from the start of the DONKEY lesson
        const tryBack = { 'L2-S3': 'a', 'L4-S1': 'b' }[key];
        if (tryBack && !back[tryBack] && (st.canDeclare || st.next)) {
          back[tryBack] = true;
          await p.tap('[data-act="prev"]'); await sleep(600);
          const w = await state();
          checks.push('Previous from ' + key + ' → L' + (w.lesson + 1) + '-S' + (w.step + 1) + ' (' + w.phase + ', hand ' + w.hand + ', letters ' + w.letters + ')');
          continue;
        }
        if (st.next || st.held) { await p.tap('.coach-actions [data-act="next"]'); await sleep(300); continue; }
        if (st.canDeclare) { await p.tap('#d-declare', { force: true }); await sleep(300); continue; }
        if (st.canPass) {
          if (!triedKing && st.lesson === 0 && st.king) {
            triedKing = true;
            await p.tap(`.hcard[data-id="${st.king}"]`, { position: { x: 10, y: 24 } }); await sleep(150);
            await p.tap(`.hcard[data-id="${st.king}"]`, { position: { x: 10, y: 24 } }); await sleep(250);
            const after = await state();
            checks.push('Passing a King in lesson 1: still your turn = ' + after.canPass + ', toast = "' + after.toast + '"');
            await shot(p, '72-dtut-keep-kings');
            continue;
          }
          const id = st.spare[0];
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } }); await sleep(150);
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } }); await sleep(250);
          continue;
        }
        if (st.canReact) { await sleep(300); try { await p.tap('#d-slap', { timeout: 1500 }); } catch (e) { /* race over */ } await sleep(200); continue; }
        if (st.canCall) { await p.tap('#d-choices [data-call="higher"]'); await sleep(300); continue; }
        await sleep(200);
      }
      const finalText = await p.evaluate(() => document.querySelector('.coach-title').textContent);
      await p.tap('[data-act="home"]');
      await sleep(400);
      const after = await p.evaluate(() => ({ screen: CT.App.screen, tutorial: !!CT.App.tutorial, save: !!localStorage.getItem('cardtable.save.v1') }));
      console.log('  steps:', seen.join(' '));
      checks.forEach(c => console.log('  ' + c));
      const notes = await p.evaluate(() => window.__tut.map((e, i, a) => Object.assign({}, e, { shown: a[i + 1] ? Math.round(a[i + 1].t - e.t) : null })));
      notes.filter(n => n.kind === 'watch').forEach(n => console.log('  watch note ' + n.key + ': ' + n.how + ', up ' + n.shown + ' ms, reading time ' + n.reading + ' ms'));
      const rushed = notes.filter(n => (n.how === 'auto' || n.how === 'held-auto') && n.shown != null && n.shown < n.reading);
      console.log('  notes that left before their reading time:', rushed.length ? rushed.map(n => n.key + ' (' + n.shown + '/' + n.reading + ' ms)') : 'none');
      console.log('  final title:', finalText, '· after leaving:', after);
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (/^real-burns/.test(SCENARIO)) {
      // Real Burns through the screen: play to a loser, then the penalty round.
      // -lose: you're left holding cards (you call Stop and pick the suit);
      // -win: you go out first and slap a computer player (you tap Next).
      const lose = /lose/.test(SCENARIO);
      const size = /small/.test(SCENARIO) ? { viewport: { width: 360, height: 640 } }
        : /landscape/.test(SCENARIO) ? { viewport: { width: 844, height: 390 } } : { viewport: { width: 390, height: 844 } };
      const tag = SCENARIO;
      const p = await open(browser, { ctx: size, seed: lose ? 13 : 17, speed: 2,
        settings: { format: 2, burns: { opponents: 3, options: { real: 'on' } } } });
      await p.tap('[data-play="burns"]'); await sleep(300);
      await shot(p, tag + '-01-setup');
      await p.tap('#s-deal'); await sleep(250);
      // lay out the hands so the test knows who loses
      await p.evaluate(lose => {
        const s = CT.App.session.state, suit = s.starter.suit;
        let pool = s.deck.concat(...s.players.map(x => x.hand));
        const take = (want, n) => { const out = []; pool = pool.filter(c => { if (out.length < n && want(c)) { out.push(c); return false; } return true; }); return out; };
        s.players.forEach((pl, i) => {
          pl.hand = lose ? (i === 0 ? take(c => c.suit !== suit, 6) : take(c => c.suit === suit, 1))
            : (i === 0 ? take(c => c.suit === suit, 1) : take(() => true, 5));
        });
        s.deck = pool;
      }, lose);
      const st = () => p.evaluate(() => {
        const s = CT.App.session, v = s.view('p0', { events: false });
        const P = v.penalty;
        return { phase: v.phase, canLead: v.canLead, canFollow: v.canFollow, mustDraw: v.mustDraw, mayDraw: v.mayDraw, canTake: v.canTake,
          playable: v.playable, out: v.out, loser: v.loser, canStop: v.canStop, canSuit: v.canSuit, canNext: v.canNext,
          step: P && P.step, turn: P && P.turn, stopReady: !!(P && P.stopFrom != null && s.now() >= P.stopFrom), drawn: P ? P.drawn.length : 0,
          sheet: CT.App.sheet, results: P ? P.results.map(r => [r.by, r.soft, r.hard, r.lucky]) : [] };
      });
      const seen = {};
      const once = async (key, name, wait) => { if (seen[key]) return; seen[key] = true; if (wait) await sleep(wait); await shot(p, tag + '-' + name); };
      let guard = 0, s = await st();
      while (s.sheet !== 'result' && guard++ < 4000) {
        if (s.out.length && !seen.out) await once('out', '02-someone-safe', 500);
        if (s.phase === 'lost') await once('lost', '03-lost', 900);
        if (s.phase === 'penalty') {
          const k = s.turn + ':' + s.step;
          if (s.step === 'shuffle') await once('shuffle' + s.turn, '04-shuffle-t' + s.turn, 700);
          if (s.step === 'suit') await once('suit' + s.turn, '05-suit-t' + s.turn, 300);
          if (s.step === 'draw' && s.drawn >= 2) await once('draw' + s.turn, '06-draw-t' + s.turn, 0);
          if (s.step === 'result') await once('result' + s.turn, '07-result-t' + s.turn, 700);
          if (s.canStop && s.stopReady) { await sleep(900); await p.tap('#pen-stop'); await sleep(300); }
          else if (s.canSuit) { await p.tap('[data-suit="H"]'); await sleep(300); }
          else if (s.canNext) { await sleep(600); await p.tap('#pen-next'); await sleep(300); }
          else await sleep(150);
          void k;
        } else if (s.canLead || s.canFollow) {
          const id = s.playable[0];
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } }); await sleep(150);
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } }); await sleep(250);
        } else if (s.mustDraw) { await p.tap('#t-deck'); await sleep(560); }
        else if (s.canTake) { const t = await p.$('[data-take]'); if (t) await t.tap(); await sleep(250); }
        else await sleep(150);
        s = await st();
      }
      await sleep(400);
      await shot(p, tag + '-08-result');
      const end = await p.evaluate(() => {
        const v = CT.App.session.view('p0', { events: false });
        return { loser: v.loser, winners: v.winners, reason: v.winReason, title: (document.querySelector('.sheet.result .wordmark') || {}).textContent,
          why: (document.querySelector('.result-why') || {}).textContent, stats: localStorage.getItem('cardtable.stats.v1'),
          log: CT.App.table.logItems.slice(-8).map(x => x.html.replace(/<[^>]+>/g, '')) };
      });
      console.log('  loser:', end.loser, '· winners:', end.winners, '· reason:', end.reason);
      console.log('  turns:', JSON.stringify(s.results));
      console.log('  result sheet:', end.title, '·', end.why);
      console.log('  stats:', end.stats);
      console.log('  play-by-play ends:', JSON.stringify(end.log));
      await p.tap('#r-home'); await sleep(300);
      console.log('  Back to games →', await p.evaluate(() => CT.App.screen));
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (/^bull-tutorial/.test(SCENARIO)) {
      // Follow the Bull tutorial from How to play to the end, trying a few wrong
      // moves and Previous on the way, on a phone (default), a small phone, a
      // phone on its side, or a desktop.
      const size = {
        'bull-tutorial': { viewport: { width: 390, height: 844 } },
        'bull-tutorial-small': { viewport: { width: 360, height: 640 } },
        'bull-tutorial-landscape': { viewport: { width: 844, height: 390 } },
        'bull-tutorial-wide': { viewport: { width: 1280, height: 820 }, isMobile: false, deviceScaleFactor: 1 }
      }[SCENARIO];
      const p = await open(browser, { ctx: size, seed: 4 });
      await p.tap('[data-rules="bull"]');
      await sleep(350);
      await shot(p, '90-bull-how-to-play');
      await p.evaluate(() => {
        const T = CT.UI.tutorials.bull.prototype;
        const log = window.__tut = [];
        const render = T.render, check = T.check;
        T.render = function () {
          render.call(this);
          const s = this.current();
          log.push({ key: 'L' + (this.index + 1) + '-S' + (this.step + 1), t: performance.now(), reading: this.readingTime(),
            kind: s.next || s.final ? 'read' : s.watch ? 'watch' : 'act', how: s.next || s.final ? 'next' : 'player' });
        };
        T.check = function () {
          const was = this.advancing;
          check.call(this);
          const s = this.current(), last = log[log.length - 1];
          if (!was && this.advancing && s && s.watch && last) {
            last.how = !this.holding ? 'auto' : document.querySelector('.coach-actions:not([hidden]) .btn-primary') ? 'next' : 'held-auto';
          }
        };
      });
      await p.tap('#r-tutorial');
      await sleep(500);
      const seen = [], checks = [], back = {}, tried = {};
      let guard = 0, bullEarly = false;
      const state = () => p.evaluate(() => {
        const t = CT.App.tutorial; if (!t) return { done: true };
        const s = t.current(); const v = CT.App.session.view('p0', { events: false });
        const held = !s.next && !s.final && !!document.querySelector('.coach-actions:not([hidden]) .btn-primary');
        return { done: false, lesson: t.index, step: t.step, next: !!s.next, final: !!s.final, held, phase: v.phase, act: !s.next && !s.final && !s.watch,
          canPlay: v.canPlay, canBull: v.canBull, rank: v.rank, hand: v.hand.map(c => c.id), selected: CT.App.table.selected.slice(),
          bullShown: !document.getElementById('b-bull').hidden, counts: v.players.map(x => x.handCount).join(' '), pile: v.pileCount,
          toast: (document.querySelector('#toast.show') || {}).textContent || '' };
      });
      // tap cards until exactly these are picked
      const pick = async ids => {
        const st = await state();
        for (const id of st.selected.filter(x => !ids.includes(x)).concat(ids.filter(x => !st.selected.includes(x)))) {
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } });
          await sleep(160);
        }
      };
      const play = async () => { await p.tap('#b-play'); await sleep(400); };
      while (guard++ < 900) {
        const st = await state();
        if (st.done) break;
        if (st.lesson < 2 && st.bullShown) bullEarly = true;
        const key = 'L' + (st.lesson + 1) + '-S' + (st.step + 1);
        if (!seen.includes(key)) { seen.push(key); await sleep(450); await shot(p, '91-btut-' + key); }
        if (st.final) break;
        // Previous: across lessons from the start of Bluffing, and from Tap Bull! (Dex plays again)
        const tryBack = { 'L2-S1': 'a', 'L3-S3': 'b' }[key];
        if (tryBack && !back[tryBack] && (st.canPlay || st.canBull)) {
          back[tryBack] = true;
          await p.tap('[data-act="prev"]'); await sleep(600);
          const w = await state();
          checks.push('Previous from ' + key + ' → L' + (w.lesson + 1) + '-S' + (w.step + 1) + ' (' + w.phase + ', ' + w.rank + 's next, hand ' + w.hand.join(' ') + ', pile ' + w.pile + ')');
          continue;
        }
        if (st.next || st.held) { await p.tap('.coach-actions [data-act="next"]'); await sleep(300); continue; }
        if (!st.act) { await sleep(200); continue; }
        if (st.canBull && st.lesson === 2) {
          await p.tap('#b-bull'); await sleep(300);
          continue;
        }
        if (st.canPlay) {
          if (st.lesson === 0) {
            if (!tried.one) {
              tried.one = true;
              await pick(['AS']); await play();
              const a = await state();
              checks.push('One Ace in lesson 1: still your turn = ' + a.canPlay + ', toast = "' + a.toast + '"');
              await shot(p, '92-btut-both-aces');
              continue;
            }
            await pick(['AS', 'AH']); await play();
          } else if (st.lesson === 1) {
            if (!tried.three) {
              tried.three = true;
              await pick(st.hand.slice(0, 3)); await play();
              const a = await state();
              checks.push('Three cards as a bluff: still your turn = ' + a.canPlay + ', toast = "' + a.toast + '"');
              continue;
            }
            await pick(['JC']); await play();
          } else if (st.lesson === 3) {
            if (!tried.bluff) {
              tried.bluff = true;
              await pick(['9C', '4D']); await play();
              const a = await state();
              checks.push('A 9 and a 4 in lesson 4: still your turn = ' + a.canPlay + ', toast = "' + a.toast + '"');
              await shot(p, '93-btut-no-bluffing');
              continue;
            }
            await pick(['9C', '9H']); await play();
          } else {
            await pick(st.hand.slice()); await play();
          }
          continue;
        }
        await sleep(200);
      }
      const end = await state();
      const finalText = await p.evaluate(() => document.querySelector('.coach-title').textContent + ' · ' + document.querySelector('.coach-text').textContent);
      checks.push('Bull! button shown in lessons 1–2 = ' + bullEarly);
      checks.push('At the end: ' + end.phase + ', cards ' + end.counts);
      await p.tap('[data-act="play"]');
      await sleep(400);
      const after = await p.evaluate(() => ({ screen: CT.App.screen, setup: (document.querySelector('#screen-setup .wordmark') || {}).textContent,
        tutorial: !!CT.App.tutorial, save: !!localStorage.getItem('cardtable.save.v1'), stats: localStorage.getItem('cardtable.stats.v1') }));
      console.log('  steps:', seen.join(' '));
      checks.forEach(c => console.log('  ' + c));
      const notes = await p.evaluate(() => window.__tut.map((e, i, a) => Object.assign({}, e, { shown: a[i + 1] ? Math.round(a[i + 1].t - e.t) : null })));
      notes.filter(n => n.kind === 'watch').forEach(n => console.log('  watch note ' + n.key + ': ' + n.how + ', up ' + n.shown + ' ms, reading time ' + n.reading + ' ms'));
      const rushed = notes.filter(n => (n.how === 'auto' || n.how === 'held-auto') && n.shown != null && n.shown < n.reading);
      console.log('  notes that left before their reading time:', rushed.length ? rushed.map(n => n.key + ' (' + n.shown + '/' + n.reading + ' ms)') : 'none');
      console.log('  final:', finalText);
      console.log('  Play Bull →', after);
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (/^bull(-small|-landscape|-six)?(-lies)?$/.test(SCENARIO)) {
      // A game of Bull through the screen: playing true cards and bluffs, calling Bull, big hands.
      // -lies: with bluffs nobody calls revealed (a rule choice).
      const lies = /-lies$/.test(SCENARIO);
      const base = SCENARIO.replace(/-lies$/, '');
      const size = {
        'bull': { viewport: { width: 390, height: 844 } },
        'bull-small': { viewport: { width: 360, height: 640 } },
        'bull-landscape': { viewport: { width: 844, height: 390 } },
        'bull-six': { viewport: { width: 390, height: 844 } }
      }[base];
      const players = base === 'bull-six' ? 6 : base === 'bull-small' ? 3 : 4;
      const tag = SCENARIO;
      const p = await open(browser, { ctx: size, seed: 41, speed: 2,
        settings: { format: 2, bull: { opponents: players - 1, options: lies ? { lies: 'shown' } : {} } } });
      await shot(p, tag + '-01-home');
      await p.tap('[data-play="bull"]');
      await sleep(300);
      await shot(p, tag + '-02-setup');
      await p.tap('#s-deal');
      await sleep(250);
      const look = () => p.evaluate(() => {
        const s = CT.App.session; if (!s) return null;
        const me = CT.App.table.me;
        const v = s.view(me, { events: false });
        return { phase: v.phase, turn: v.turn, me: me, rank: v.rank, canPlay: v.canPlay, canBull: v.canBull, openAt: v.openAt, now: s.now(),
          hand: v.hand.map(c => c.id), handRanks: v.hand.map(c => c.rank), last: v.last, reveal: v.reveal, sheet: CT.App.sheet, pile: v.pileCount,
          two: document.getElementById('b-handwrap').classList.contains('two'), exposed: !document.getElementById('b-exposed').hidden };
      });
      const shots = {};
      const once = async (key, name, wait) => { if (shots[key]) return; shots[key] = 1; if (wait) await sleep(wait); await shot(p, tag + '-' + name); };
      let guard = 0, v = await look(), myPlays = 0, myBluffs = 0, myCalls = 0, sawTwoRows = false;
      const checks = [];
      while (v && v.phase !== 'over' && guard++ < 8000) {
        if (v.two) sawTwoRows = true;
        if (v.phase === 'dealing') await once('deal', '03-dealing', 500);
        if (v.phase === 'reveal') await once(v.reveal.lie ? 'lie' : 'true', v.reveal.lie ? '08-reveal-bluff' : '09-reveal-true', 900);
        if (v.phase === 'lastcall') await once('last', '10-last-call', 200);
        if (v.exposed) await once('exposed', '14-bluff-revealed', 350);
        if (v.canBull && v.last && v.last.n >= 2 && myCalls < 3 && Math.random() < 0.5) {
          await once('bullbtn', '06-bull-button', 0);
          try { await p.tap('#b-bull', { timeout: 1500 }); myCalls++; } catch (e) { /* the moment passed */ }
          await sleep(300);
        } else if (v.canPlay && v.now >= (v.openAt || 0)) {
          await once('turn', '04-your-turn', 200);
          const want = v.hand.filter((id, i) => v.handRanks[i] === v.rank);
          let pick = want.slice(0, 4);
          if (!pick.length) { pick = [v.hand[0]]; myBluffs++; }
          else if (Math.random() < 0.3 && v.hand.length > pick.length + 1 && pick.length < 4) { pick.push(v.hand.find(id => !pick.includes(id))); myBluffs++; }
          if (want.length && Math.random() < 0.5) await p.tap('#b-pick');
          else for (const id of pick) { await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 8, y: 20 } }); await sleep(90); }
          await sleep(120);
          await once('sel', '05-selected', 0);
          try { await p.tap('#b-play', { timeout: 2500 }); myPlays++; } catch (e) { /* waiting */ }
          await sleep(250);
        } else {
          if (v.phase === 'play' && v.turn !== v.me && v.last) await once('others', '07-others-turn', 300);
          await sleep(100);
        }
        v = await look();
      }
      if (!v || v.phase !== 'over') throw new Error('Bull game did not finish');
      const end = await p.evaluate(() => {
        const st = CT.App.session.state;
        return { plays: st.plays, winner: st.winners[0], calls: st.events.filter(e => e.type === 'bull').length, counts: st.players.map(x => x.hand.length),
          revealed: st.events.filter(e => e.type === 'lieExposed').length, revealedAtEnd: st.events.some(e => e.type === 'lieExposed' && e.final) };
      });
      console.log('  game over:', JSON.stringify(end), '· you played', myPlays, 'times (' + myBluffs + ' with a bluff), called Bull', myCalls, 'times · two-row hand seen:', sawTwoRows);
      await sleep(2800);
      await shot(p, tag + '-11-result');
      await p.tap('#r-table'); await sleep(300);
      await p.tap('#b-menu'); await sleep(300);
      await p.tap('#m-log'); await sleep(300);
      await shot(p, tag + '-12-log');
      await p.tap('[data-close]'); await sleep(200);
      await p.tap('#b-menu'); await sleep(200);
      await p.tap('#m-rules'); await sleep(300);
      await shot(p, tag + '-13-rules');
      checks.forEach(c => console.log('  ' + c));
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (SCENARIO === 'online-real') {
      // Real Burns through the game server: three phones and a computer player,
      // the host switches it on in the lobby, then the game and the penalty round.
      const server = process.env.SERVER || 'ws://127.0.0.1:8787';
      const storage = { 'cardtable.server': server };
      const names = ['Odane', 'Tess', 'Ravi'];
      const pages = [];
      for (let i = 0; i < names.length; i++) pages.push(await open(browser, { ctx: { viewport: { width: 390, height: 844 } }, seed: 51 + i, storage }));
      const host = pages[0];
      await host.tap('[data-online="create"]'); await sleep(300);
      await host.tap('#overlay [data-mode="burns"]');
      await host.fill('#o-name', names[0]);
      await host.tap('#o-go');
      await host.waitForSelector('.room-code', { timeout: 10000 });
      const code = (await host.textContent('.room-code')).trim();
      for (let i = 1; i < pages.length; i++) {
        await pages[i].tap('[data-online="join"]'); await sleep(300);
        await pages[i].fill('#o-code', code);
        await pages[i].fill('#o-name', names[i]);
        await pages[i].tap('#o-go');
        await pages[i].waitForSelector('.room-code', { timeout: 10000 });
      }
      await sleep(500);
      await host.tap('[data-l-size="4"]'); await sleep(300);
      await host.tap('[data-l-opt="real"][data-val="on"]'); await sleep(500);
      await shot(host, 'or-01-lobby-host');
      await shot(pages[1], 'or-02-lobby-guest');
      const guestSees = await pages[1].evaluate(() => CT.App.online.room.options.real);
      await host.tap('#l-start');
      for (const p of pages) await p.waitForSelector('#screen-table:not([hidden])', { timeout: 10000 });
      const look = p => p.evaluate(() => {
        const s = CT.App.session;
        if (!s || !s.remote) return { none: true, sheet: CT.App.sheet };
        const v = s.view(s.me, { events: false }), P = v.penalty;
        return { me: s.me, phase: v.phase, sheet: CT.App.sheet, canLead: v.canLead, canFollow: v.canFollow, mustDraw: v.mustDraw, mayDraw: v.mayDraw,
          canTake: v.canTake, playable: v.playable, canStop: v.canStop, canSuit: v.canSuit, canNext: v.canNext, loser: v.loser, out: v.out,
          step: P && P.step, turn: P && P.turn, stopReady: !!(P && P.stopFrom != null && s.now() >= P.stopFrom) };
      });
      const busy = new Map(), shots = {};
      const act = async (p, i, v) => {
        if (v.none || v.phase === 'over' || v.sheet || busy.get(p) > Date.now()) return;
        try {
          if (v.phase === 'penalty') {
            const k = v.turn + v.step;
            if (!shots[i + k] && (v.canStop || v.canSuit || v.canNext || (v.step === 'draw' && i === 0))) { shots[i + k] = 1; await shot(p, 'or-p' + i + '-t' + v.turn + '-' + v.step); }
            if (v.canStop && v.stopReady) { await sleep(400); await p.tap('#pen-stop', { timeout: 1500 }); busy.set(p, Date.now() + 800); }
            else if (v.canSuit) { await p.tap('[data-suit="S"]', { timeout: 1500 }); busy.set(p, Date.now() + 800); }
            else if (v.canNext) { await sleep(500); await p.tap('#pen-next', { timeout: 1500 }); busy.set(p, Date.now() + 800); }
          } else if ((v.canLead || v.canFollow) && v.playable.length) {
            const id = v.playable[Math.floor(Math.random() * v.playable.length)];
            await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 }, timeout: 1500 }); await sleep(140);
            await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 }, timeout: 1500 }); busy.set(p, Date.now() + 500);
          } else if (v.mustDraw) { await p.tap('#t-deck', { timeout: 1500 }); busy.set(p, Date.now() + 650); }
          else if (v.canTake) { const t = await p.$('[data-take]'); if (t) await t.tap(); busy.set(p, Date.now() + 500); }
        } catch (e) { /* the moment passed */ }
      };
      const start = Date.now();
      let guard = 0, vs = [], sawLost = false;
      while (guard++ < 30000 && Date.now() - start < 9 * 60000) {
        vs = [];
        for (const p of pages) vs.push(await look(p));
        if (vs.every(v => v.none || v.phase === 'over')) break;
        if (!sawLost && vs[0].phase === 'lost') { sawLost = true; for (let i = 0; i < 3; i++) await shot(pages[i], 'or-lost-p' + i); }
        for (let i = 0; i < pages.length; i++) await act(pages[i], i, vs[i]);
        await sleep(40);
      }
      await sleep(3200);
      const ends = await Promise.all(pages.map(p => p.evaluate(() => ({ sheet: CT.App.sheet, title: (document.querySelector('.sheet.result .wordmark') || {}).textContent,
        why: (document.querySelector('.result-why') || {}).textContent }))));
      for (let i = 0; i < 3; i++) await shot(pages[i], 'or-end-p' + i);
      console.log('  guest sees Real Burns on in the lobby:', guestSees);
      console.log('  game finished in', Math.round((Date.now() - start) / 1000), 's · loser', vs[0].loser, '· out', JSON.stringify(vs[0].out));
      ends.forEach((e, i) => console.log('  phone ' + i + ': ' + e.sheet + ' · ' + e.title + ' · ' + e.why));
      const errors = [].concat(...pages.map(p => p.errors));
      console.log('  errors:', errors.length ? errors : 'none');
    }

    if (SCENARIO === 'online' || SCENARIO === 'online-burns' || SCENARIO === 'online-bull') {
      // Phones playing together through the game server (run it locally: cd server && npm run dev).
      const burns = SCENARIO === 'online-burns';
      const bull = SCENARIO === 'online-bull';
      const server = process.env.SERVER || 'ws://127.0.0.1:8787';
      const phone = { viewport: { width: 390, height: 844 } };
      const storage = { 'cardtable.server': server };
      const names = burns || bull ? ['Odane', 'Tess', 'Ravi'] : ['Odane', 'Tess'];
      const pages = [];
      for (let i = 0; i < names.length; i++) pages.push(await open(browser, { ctx: phone, seed: 31 + i, storage }));
      const [host, guest] = pages;
      const tag = burns ? 'ob' : bull ? 'oB' : 'od';
      const checks = [];
      const info = p => p.evaluate(() => {
        const o = CT.App.online;
        return { screen: CT.App.screen, sheet: CT.App.sheet, status: o.conn ? o.conn.status : 'none', code: o.room && o.room.code,
          phase: o.room && o.room.phase, host: o.isHost(), members: o.room ? o.room.members.map(m => m.name + (m.connected ? '' : ' (away)') + (m.computer ? ' (computer)' : '')) : [],
          bar: !document.getElementById('net-bar').hidden, game: CT.App.session && CT.App.session.remote ? CT.App.session.game : null };
      });
      await shot(host, tag + '-01-home');
      // the host creates a room
      await host.tap('[data-online="create"]'); await sleep(300);
      await host.tap('#overlay [data-mode="' + (burns ? 'burns' : bull ? 'bull' : 'donkey') + '"]');
      await host.fill('#o-name', names[0]);
      await shot(host, tag + '-02-create');
      await host.tap('#o-go');
      await host.waitForSelector('.room-code', { timeout: 10000 });
      const code = (await host.textContent('.room-code')).trim();
      checks.push('room created: ' + code);
      await sleep(300);
      await shot(host, tag + '-03-lobby-host');
      // friends join: one by typing the code, one with the invite link
      for (let i = 1; i < pages.length; i++) {
        const p = pages[i];
        if (i === 2) {
          await p.goto('file://' + wrapperPath + '?room=' + code, { waitUntil: 'domcontentloaded' }); await sleep(800);
          checks.push('invite link opens the join form with the code: ' + (await p.inputValue('#o-code')));
        } else {
          await p.tap('[data-online="join"]'); await sleep(300);
          await p.fill('#o-code', code.toLowerCase());
        }
        await p.fill('#o-name', names[i]);
        if (i === 1) await shot(p, tag + '-04-join');
        await p.tap('#o-go');
        await p.waitForSelector('.room-code', { timeout: 10000 });
      }
      await sleep(600);
      await shot(guest, tag + '-05-lobby-guest');
      await shot(host, tag + '-06-lobby-host-full');
      checks.push('lobby (host): ' + JSON.stringify((await info(host)).members) + ' · guest sees host = ' + (await info(guest)).host);
      if (burns || bull) {
        await host.tap('[data-l-size="4"]'); await sleep(400);
        checks.push('host set 4 seats; guest sees ' + await guest.evaluate(() => CT.App.online.room.size) + ' seats');
      }
      // start
      await host.tap('#l-start');
      for (const p of pages) await p.waitForSelector('#screen-table:not([hidden])', { timeout: 10000 });
      await sleep(900);
      await shot(host, tag + '-07-table-host');
      await shot(guest, tag + '-08-table-guest');
      const seatsSeen = await Promise.all(pages.map(p => p.evaluate(() => { const s = CT.App.session; const v = s.view(s.me, { events: false }); return s.me + ':' + v.players.map(x => x.name + (x.isBot ? '*' : '')).join(','); })));
      checks.push('seats as each phone sees them: ' + seatsSeen.join(' | '));

      // play every phone's seat by tapping, as people would
      const look = p => p.evaluate(() => {
        const s = CT.App.session;
        if (!s || !s.remote) return { none: true, screen: CT.App.screen, sheet: CT.App.sheet };
        const v = s.view(s.me, { events: false });
        const out = { phase: v.phase, sheet: CT.App.sheet, me: s.me, mode: v.mode };
        if (v.mode === 'donkey') {
          const n = {}; v.hand.forEach(c => { n[c.rank] = (n[c.rank] || 0) + 1; });
          if (v.canPass) { const min = Math.min(...v.hand.map(c => n[c.rank])); out.pick = v.hand.filter(c => n[c.rank] === min)[0].id; }
          const d = v.tiebreak && v.tiebreak.duel;
          Object.assign(out, { canPass: v.canPass, canDeclare: v.canDeclare, canReact: v.canReact, canChallenge: v.canChallenge, canCall: v.canCall,
            call: d && d.myCard ? (CT.rankValue(d.myCard.rank, true) >= 7 ? 'higher' : 'lower') : null });
        } else if (v.mode === 'bull') {
          Object.assign(out, { canPlay: v.canPlay, canBull: v.canBull, open: v.openAt == null || s.now() >= v.openAt, last: v.last,
            want: v.hand.filter(c => c.rank === v.rank).map(c => c.id).slice(0, 4), any: v.hand.length ? v.hand[0].id : null });
        } else {
          Object.assign(out, { canLead: v.canLead, canFollow: v.canFollow, mustDraw: v.mustDraw, mayDraw: v.mayDraw, canTake: v.canTake, playable: v.playable });
        }
        return out;
      });
      const busy = new Map();
      const act = async (p, v) => {
        if (v.none || v.phase === 'over' || v.sheet) return;
        if (busy.get(p) > Date.now()) return;
        try {
          if (v.mode === 'donkey') {
            if (v.canDeclare) { await p.tap('#d-declare', { timeout: 1500 }); busy.set(p, Date.now() + 500); }
            else if (v.canReact) { await sleep(150 + Math.random() * 350); await p.tap('#d-slap', { timeout: 1500 }); busy.set(p, Date.now() + 500); }
            else if (v.canPass) {
              await p.tap(`.hcard[data-id="${v.pick}"]`, { position: { x: 10, y: 24 }, timeout: 1500 }); await sleep(120);
              await p.tap(`.hcard[data-id="${v.pick}"]`, { position: { x: 10, y: 24 }, timeout: 1500 }); busy.set(p, Date.now() + 600);
            } else if (v.canChallenge) { await p.tap('#d-choices button', { timeout: 1500 }); busy.set(p, Date.now() + 600); }
            else if (v.canCall) { await p.tap(`#d-choices [data-call="${v.call}"]`, { timeout: 1500 }); busy.set(p, Date.now() + 600); }
          } else if (v.mode === 'bull') {
            if (v.canBull && v.last && v.last.n >= 3 && Math.random() < 0.5) { await p.tap('#b-bull', { timeout: 1500 }); busy.set(p, Date.now() + 800); }
            else if (v.canPlay && v.open) {
              const pick = v.want.length ? v.want : [v.any];
              for (const id of pick) { await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 8, y: 20 }, timeout: 1500 }); await sleep(80); }
              await p.tap('#b-play', { timeout: 2500 }); busy.set(p, Date.now() + 700);
            }
          } else {
            if ((v.canLead || v.canFollow) && v.playable.length && !(v.mayDraw && Math.random() < 0.2)) {
              const id = v.playable[Math.floor(Math.random() * v.playable.length)];
              await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 }, timeout: 1500 }); await sleep(140);
              await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 }, timeout: 1500 }); busy.set(p, Date.now() + 500);
            } else if (v.mustDraw || v.mayDraw) { await p.tap('#t-deck', { timeout: 1500 }); busy.set(p, Date.now() + 700); }
            else if (v.canTake) { const t = await p.$('[data-take]'); if (t) await t.tap(); busy.set(p, Date.now() + 500); }
          }
        } catch (e) { /* the moment passed; look again */ }
      };
      const playUntilOver = async (label, during) => {
        const start = Date.now();
        let guard = 0;
        while (guard++ < 20000 && Date.now() - start < 6 * 60000) {
          const vs = [];
          for (const p of pages) vs.push(await look(p));
          if (vs.every(v => v.none || v.phase === 'over')) return Date.now() - start;
          if (during) await during(vs, Date.now() - start);
          for (let i = 0; i < pages.length; i++) await act(pages[i], vs[i]);
          await sleep(40);
        }
        throw new Error(label + ': the game did not finish');
      };

      // part way through, one phone loses its connection for a while
      let dropped = false, back = false;
      const ms1 = await playUntilOver('game 1', async (vs, t) => {
        if (!dropped && t > 15000 && vs[1].phase && vs[1].phase !== 'over') {
          dropped = true;
          await guest.context().setOffline(true);
          await sleep(21000);
          const h = await info(host), g = await info(guest);
          checks.push('guest offline 21 s → host sees ' + JSON.stringify(h.members) + '; guest bar shown = ' + g.bar + ', status = ' + g.status);
          await shot(guest, tag + '-09-guest-offline');
          await guest.context().setOffline(false);
        } else if (dropped && !back) {
          const g = await info(guest);
          if (g.status === 'open') {
            back = true;
            await sleep(600);
            const h = await info(host);
            checks.push('guest back → status ' + g.status + ', bar ' + g.bar + ', host sees ' + JSON.stringify(h.members));
            await shot(guest, tag + '-10-guest-back');
          }
        }
      });
      checks.push('game 1 finished in ' + Math.round(ms1 / 1000) + ' s');
      await sleep(3200);
      await shot(host, tag + '-11-result-host');
      await shot(guest, tag + '-12-result-guest');
      checks.push('result sheets: host ' + (await info(host)).sheet + ' with Play again = ' + !!(await host.$('#r-again')) +
        ' · guest ' + (await info(guest)).sheet + ' waiting = ' + JSON.stringify(await guest.evaluate(() => (document.getElementById('r-wait') || {}).textContent || '')));
      // play again: everyone gets a new game
      await host.tap('#r-again');
      await sleep(1500);
      const g2 = await Promise.all(pages.map(p => info(p)));
      checks.push('play again → ' + g2.map(x => x.screen + '/game ' + x.game + (x.sheet ? '/' + x.sheet : '')).join(' | '));
      // the host's app reloads mid-game (an update): straight back in
      await sleep(2500);
      await host.reload({ waitUntil: 'domcontentloaded' });
      await host.waitForSelector('#screen-table:not([hidden])', { timeout: 15000 });
      await sleep(800);
      checks.push('host reloaded → ' + JSON.stringify(await info(host)));
      await shot(host, tag + '-13-host-after-reload');
      // a guest leaves from the menu; the computer takes their seat
      const leaver = pages[pages.length - 1];
      await leaver.tap(burns ? '#t-menu' : bull ? '#b-menu' : '#d-menu'); await sleep(300);
      await shot(leaver, tag + '-14-menu');
      await leaver.tap('#m-leave'); await sleep(300);
      await shot(leaver, tag + '-15-leave-confirm');
      await leaver.tap('#o-leave'); await sleep(800);
      checks.push('guest left → guest screen ' + (await info(leaver)).screen + '; host sees ' + JSON.stringify((await info(host)).members));
      const ms2 = await playUntilOver('game 2');
      checks.push('game 2 finished in ' + Math.round(ms2 / 1000) + ' s');
      await sleep(3200);
      // back to the room, then leave
      await host.tap('#r-lobby'); await sleep(800);
      await shot(host, tag + '-16-back-in-lobby');
      checks.push('back to the room → ' + JSON.stringify(await info(host)));
      await host.tap('#l-back'); await sleep(300);
      if (await host.$('#o-leave')) await host.tap('#o-leave');
      await sleep(600);
      checks.push('host left → ' + (await info(host)).screen);
      await shot(host, tag + '-17-home-after');
      checks.forEach(c => console.log('  ' + c));
      // the browser's own complaints while a phone was offline on purpose are expected
      const errors = [].concat(...pages.map(p => p.errors)).filter(e => !/ERR_INTERNET_DISCONNECTED/.test(e));
      console.log('  errors:', errors.length ? errors : 'none');
    }

    if (SCENARIO === 'first-play') {
      // The first time each mode is played, Play offers its tutorial, once.
      const checks = [];
      const phone = { viewport: { width: 390, height: 844 } };
      const p = await open(browser, { ctx: phone, seed: 6, firstVisit: true });
      const state = pg => pg.evaluate(() => ({ screen: CT.App.screen, sheet: CT.App.sheet, tutorial: CT.App.tutorial ? CT.App.tutorial.modeId : null,
        text: (document.querySelector('.intro-text') || {}).textContent || '', stored: localStorage.getItem('cardtable.tutorials.v1') }));
      // Donkey: offered, then skipped
      await p.tap('[data-play="donkey"]'); await sleep(450);
      let s = await state(p);
      checks.push('Play Donkey, first time → sheet = ' + s.sheet + ' · "' + s.text + '"');
      await shot(p, '80-first-play-donkey');
      await p.tap('#i-skip'); await sleep(350);
      s = await state(p);
      checks.push('Skip to the game → screen = ' + s.screen + ', sheet = ' + s.sheet + ', stored ' + s.stored);
      await p.tap('#s-back'); await sleep(300);
      await p.tap('[data-play="donkey"]'); await sleep(400);
      s = await state(p);
      checks.push('Play Donkey again → screen = ' + s.screen + ', sheet = ' + s.sheet);
      await p.tap('#s-back'); await sleep(300);
      // Burns: offered, then the tutorial taken and left
      await p.tap('[data-play="burns"]'); await sleep(450);
      s = await state(p);
      checks.push('Play Burns, first time → sheet = ' + s.sheet + ' · "' + s.text + '"');
      await shot(p, '81-first-play-burns');
      await p.tap('#i-tutorial'); await sleep(800);
      s = await state(p);
      checks.push('Start the tutorial → tutorial = ' + s.tutorial + ', screen = ' + s.screen + ', stored ' + s.stored);
      await shot(p, '82-first-play-burns-tutorial');
      await p.tap('.coach-skip'); await sleep(400);
      await p.tap('[data-play="burns"]'); await sleep(400);
      s = await state(p);
      checks.push('Leave the tutorial, Play Burns again → screen = ' + s.screen + ', sheet = ' + s.sheet);
      // Bull: offered too
      await p.tap('#s-back'); await sleep(300);
      await p.tap('[data-play="bull"]'); await sleep(450);
      s = await state(p);
      checks.push('Play Bull, first time → sheet = ' + s.sheet + ' · "' + s.text + '"');
      await shot(p, '84-first-play-bull');
      await p.tap('#i-tutorial'); await sleep(800);
      s = await state(p);
      checks.push('Start the Bull tutorial → tutorial = ' + s.tutorial + ', screen = ' + s.screen + ', stored ' + s.stored);
      // Someone who has finished a Burns game isn't asked about Burns, only Donkey
      const q = await open(browser, { ctx: phone, seed: 6, firstVisit: true,
        storage: { 'cardtable.stats.v1': { burns: { played: 3, won: 1, flushWins: 0 } } } });
      await q.tap('[data-play="burns"]'); await sleep(400);
      s = await state(q);
      checks.push('Has played Burns before → screen = ' + s.screen + ', sheet = ' + s.sheet);
      await q.tap('#s-back'); await sleep(300);
      await q.tap('[data-play="donkey"]'); await sleep(400);
      s = await state(q);
      checks.push('…but new to Donkey → sheet = ' + s.sheet);
      await q.touchscreen.tap(195, 20); await sleep(250);   // outside the card
      s = await state(q);
      checks.push('Tap outside the card → sheet = ' + s.sheet);
      await q.tap('#i-rules'); await sleep(350);
      s = await state(q);
      const tutCard = await q.evaluate(() => !!document.getElementById('r-tutorial'));
      checks.push('Read the rules instead → sheet = ' + s.sheet + ', tutorial offered there too = ' + tutCard);
      // A phone on its side
      const w = await open(browser, { ctx: { viewport: { width: 844, height: 390 } }, seed: 6, firstVisit: true });
      await w.tap('[data-play="donkey"]'); await sleep(450);
      await shot(w, '83-first-play-landscape');
      const fits = await w.evaluate(() => { const el = document.querySelector('.sheet.intro'); return el.scrollHeight <= el.clientHeight + 1; });
      checks.push('On its side, the offer fits without scrolling = ' + fits);
      checks.forEach(c => console.log('  ' + c));
      const errors = p.errors.concat(q.errors, w.errors);
      console.log('  errors:', errors.length ? errors : 'none');
    }

    if (SCENARIO === 'settings') {
      // Settings saved by 0.3 stored every rule. After the update, rules left at the old
      // defaults follow the new ones; a real choice (15 seconds) survives.
      const p = await open(browser, { ctx: { viewport: { width: 390, height: 780 } }, seed: 5,
        settings: { music: true, burns: { opponents: 3, options: { leadCard: 'suitOnly', turnTime: '15' } } } });
      const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem('cardtable.settings.v1')));
      console.log('  migrated:', JSON.stringify(await stored()));
      await p.tap('[data-play="burns"]');
      await sleep(300);
      await shot(p, '40-setup-migrated');
      await p.tap('[data-opt="flush"][data-val="on"]');
      await sleep(200);
      await shot(p, '41-setup-flush-on');
      console.log('  after picking Flush on:', JSON.stringify((await stored()).burns));
      await p.tap('#s-deal');
      await sleep(400);
      console.log('  game options:', JSON.stringify(await p.evaluate(() => CT.App.session.state.options)));
      await p.tap('#t-menu');
      await sleep(200);
      await p.tap('#m-rules');
      await sleep(300);
      await shot(p, '42-rules-flush-on');
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (/^real-tutorial/.test(SCENARIO)) {
      // The extra Real Burns lesson: on its own from How to play (with Previous
      // at the suit and after the first turn's slaps), then offered at the end of
      // the main tutorial. On a phone, a small phone, a phone on its side or a desktop.
      const size = {
        'real-tutorial': { viewport: { width: 390, height: 844 } },
        'real-tutorial-small': { viewport: { width: 360, height: 640 } },
        'real-tutorial-landscape': { viewport: { width: 844, height: 390 } },
        'real-tutorial-wide': { viewport: { width: 1280, height: 820 }, isMobile: false, deviceScaleFactor: 1 }
      }[SCENARIO];
      const suits = { 'real-tutorial': ['H', 'S'], 'real-tutorial-small': ['D', 'C'], 'real-tutorial-landscape': ['C', 'H'], 'real-tutorial-wide': ['S', 'D'] }[SCENARIO];
      const p = await open(browser, { ctx: size, seed: 6 });
      await p.tap('[data-rules="burns"]');
      await sleep(350);
      await shot(p, '95-rtut-how-to-play');
      const checks = [];
      checks.push('How to play: "' + await p.evaluate(() => document.querySelector('.tut-card p').textContent) + '" · shortcut "' +
        await p.evaluate(() => (document.querySelector('.tut-card [data-lesson]') || {}).textContent) + '"');
      await p.evaluate(() => {
        const T = CT.UI.tutorials.burns.prototype;
        const log = window.__tut = [];
        const render = T.render, check = T.check;
        T.render = function () {
          render.call(this);
          const s = this.current();
          log.push({ key: 'L' + (this.index + 1) + '-S' + (this.step + 1), t: performance.now(), reading: this.readingTime(),
            kind: s.next || s.final ? 'read' : s.watch ? 'watch' : 'act', how: s.next || s.final ? 'next' : 'player' });
        };
        T.check = function () {
          const was = this.advancing;
          check.call(this);
          const s = this.current(), last = log[log.length - 1];
          if (!was && this.advancing && s && s.watch && last) {
            last.how = !this.holding ? 'auto' : document.querySelector('.coach-actions:not([hidden]) .btn-primary') ? 'next' : 'held-auto';
          }
        };
      });
      await p.tap('.tut-card [data-lesson]');
      await sleep(500);
      const state = () => p.evaluate(() => {
        const t = CT.App.tutorial; if (!t) return { done: true };
        const s = t.current(); const v = CT.App.session.view('p0', { events: false });
        const held = !s.next && !s.final && !!document.querySelector('.coach-actions:not([hidden]) .btn-primary');
        const P = v.penalty, stop = document.getElementById('pen-stop');
        return { done: false, lesson: t.index, step: t.step, next: !!s.next, final: !!s.final, held, act: !s.next && !s.final && !s.watch,
          label: document.querySelector('.coach-step').textContent, prev: !!document.querySelector('[data-act="prev"]'),
          extra: (document.querySelector('[data-act="extra"]') || {}).textContent || null,
          phase: v.phase, canFollow: v.canFollow, canStop: v.canStop && !!stop && !stop.disabled, canSuit: v.canSuit,
          pen: P ? { turn: P.turn, step: P.step, soft: P.soft, hard: P.hard, drawn: P.drawn.map(c => c.id).join(' '), lucky: P.lucky } : null };
      });
      const seen = [], back = {};
      let guard = 0, suitNo = 0, first = null;
      while (guard++ < 900) {
        const st = await state();
        if (st.done) break;
        const key = 'L' + (st.lesson + 1) + '-S' + (st.step + 1);
        if (!first) { first = st; checks.push('Started on its own: "' + st.label + '", Previous shown = ' + st.prev); }
        if (!seen.includes(key)) { seen.push(key); await sleep(500); await shot(p, '96-rtut-' + key); }
        if (st.final) break;
        // Previous: from naming the suit back to Stop, and from the first turn's slaps back to the cards turning over
        const tryBack = { 'L7-S6': 'suit', 'L7-S8': 'slaps' }[key];
        if (tryBack && !back[tryBack] && st.prev) {
          back[tryBack] = true;
          await p.tap('[data-act="prev"]'); await sleep(700);
          const w = await state();
          checks.push('Previous from ' + key + ' → L' + (w.lesson + 1) + '-S' + (w.step + 1) + ' (' + w.phase + ', penalty ' + JSON.stringify(w.pen) + ')');
          if (tryBack === 'suit') suitNo = 0;
          continue;
        }
        if (st.next || st.held) { await p.tap('.coach-actions [data-act="next"]'); await sleep(300); continue; }
        if (!st.act) { await sleep(150); continue; }
        if (st.canFollow) {
          await p.tap('.hcard[data-id="6D"]', { position: { x: 10, y: 24 } }); await sleep(200);
          await p.tap('.hcard[data-id="6D"]', { position: { x: 10, y: 24 } }); await sleep(300);
          continue;
        }
        // Stop on its own step (or Dex's turn), the suit on its own step (or Dex's turn)
        if (st.canStop && (key === 'L7-S5' || key === 'L7-S9')) { await sleep(300); await p.tap('#pen-stop'); await sleep(300); continue; }
        if (st.canSuit && (key === 'L7-S6' || key === 'L7-S9')) {
          const suit = suits[st.pen.turn];
          await sleep(300); await p.tap(`[data-suit="${suit}"]`); await sleep(300);
          checks.push('Turn ' + (st.pen.turn + 1) + ': named ' + suit);
          suitNo++;
          continue;
        }
        await sleep(150);
      }
      const end = await state();
      const finalText = await p.evaluate(() => document.querySelector('.coach-title').textContent + ' · ' + document.querySelector('.coach-text').textContent);
      const results = await p.evaluate(() => CT.App.session.view('p0', { events: false }).penalty.results.map(r => r.by + ': ' + r.cards.map(c => c.id).join(' ') + ' → ' + r.soft + ' soft, ' + r.hard + ' hard' + (r.lucky ? ', lucky' : '')));
      checks.push('Final: ' + end.label + ' · Previous = ' + end.prev + ' · extra offer = ' + end.extra);
      checks.push('Turns: ' + results.join(' | '));
      // then the main tutorial's last lesson, whose last note offers Real Burns
      await p.tap('[data-act="home"]'); await sleep(400);
      await p.evaluate(() => CT.App.startTutorial('burns', 5));
      await sleep(500);
      guard = 0;
      while (guard++ < 200) {
        const st = await state();
        if (st.done || st.final) break;
        if (st.next || st.held) { await p.tap('.coach-actions [data-act="next"]'); await sleep(300); continue; }
        const v = await view(p);
        if (v.canLead) {
          const id = v.playable[0];
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } }); await sleep(200);
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } }); await sleep(300);
          continue;
        }
        await sleep(200);
      }
      await sleep(400);
      let st = await state();
      checks.push('Main tutorial ends: "' + st.label + '", extra offer = ' + st.extra + ', Previous = ' + st.prev);
      await shot(p, '97-rtut-main-end');
      await p.tap('[data-act="extra"]'); await sleep(600);
      st = await state();
      checks.push('Learn Real Burns → "' + st.label + '" step ' + (st.step + 1) + ', Previous shown = ' + st.prev);
      await p.tap('[data-act="prev"]'); await sleep(600);
      st = await state();
      checks.push('…Previous → L' + (st.lesson + 1) + '-S' + (st.step + 1) + ' "' + st.label + '", final = ' + st.final);
      await p.tap('.coach-skip'); await sleep(400);
      const after = await p.evaluate(() => ({ screen: CT.App.screen, tutorial: !!CT.App.tutorial, save: !!localStorage.getItem('cardtable.save.v1'), stats: localStorage.getItem('cardtable.stats.v1') }));
      console.log('  steps:', seen.join(' '));
      checks.forEach(c => console.log('  ' + c));
      const notes = await p.evaluate(() => window.__tut.map((e, i, a) => Object.assign({}, e, { shown: a[i + 1] ? Math.round(a[i + 1].t - e.t) : null })));
      notes.filter(n => n.kind === 'watch').forEach(n => console.log('  watch note ' + n.key + ': ' + n.how + ', up ' + n.shown + ' ms, reading time ' + n.reading + ' ms'));
      const rushed = notes.filter(n => (n.how === 'auto' || n.how === 'held-auto') && n.shown != null && n.shown < n.reading);
      console.log('  notes that left before their reading time:', rushed.length ? rushed.map(n => n.key + ' (' + n.shown + '/' + n.reading + ' ms)') : 'none');
      console.log('  final:', finalText);
      console.log('  after leaving:', JSON.stringify(after));
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (/^tutorial/.test(SCENARIO)) {
      // Follow the tutorial's instructions from How to play to the end
      // (on a phone, a phone on its side, or a desktop).
      const size = {
        'tutorial': { viewport: { width: 390, height: 844 } },
        'tutorial-landscape': { viewport: { width: 844, height: 390 } },
        'tutorial-wide': { viewport: { width: 1280, height: 820 }, isMobile: false, deviceScaleFactor: 1 }
      }[SCENARIO];
      const p = await open(browser, { ctx: size, seed: 3 });
      await p.tap('[data-rules="burns"]');
      await sleep(350);
      await shot(p, '30-how-to-play');
      // Log each note: when it appeared, how it was meant to end, and its reading time.
      await p.evaluate(() => {
        const T = CT.UI.tutorials.burns.prototype;
        const log = window.__tut = [];
        const render = T.render, check = T.check;
        T.render = function () {
          render.call(this);
          const s = this.current();
          log.push({ key: 'L' + (this.index + 1) + '-S' + (this.step + 1), t: performance.now(), reading: this.readingTime(),
            kind: s.next || s.final ? 'read' : s.watch ? 'watch' : 'act', how: s.next || s.final ? 'next' : 'player' });
        };
        T.check = function () {
          const was = this.advancing;
          check.call(this);
          const s = this.current(), last = log[log.length - 1];
          if (!was && this.advancing && s && s.watch && last) {
            last.how = !this.holding ? 'auto' : document.querySelector('.coach-actions:not([hidden]) .btn-primary') ? 'next' : 'held-auto';
          }
        };
      });
      await p.tap('#r-tutorial');
      await sleep(500);
      const seen = [];
      let guard = 0, drewExtra = false;
      const back = {}, checks = [];
      const where = () => p.evaluate(() => {
        const t = CT.App.tutorial, s = CT.App.session, v = s.view('p0', { events: false });
        const me = v.players.find(x => x.id === 'p0');
        return { at: 'L' + (t.index + 1) + '-S' + (t.step + 1), phase: v.phase, hand: v.hand.map(c => c.id).join(' '), committed: me.committed,
          canLead: v.canLead, secondsLeft: v.turnEndsAt ? Math.round((v.turnEndsAt - s.now()) / 1000) : null };
      });
      while (guard++ < 800) {
        const st = await p.evaluate(() => {
          const t = CT.App.tutorial; if (!t) return { done: true };
          const s = t.current(); const v = CT.App.session.view('p0', { events: false });
          const held = !s.next && !s.final && !!document.querySelector('.coach-actions:not([hidden]) .btn-primary');
          return { done: false, lesson: t.index, step: t.step, next: !!s.next, final: !!s.final, held,
            canLead: v.canLead, canFollow: v.canFollow, mustDraw: v.mustDraw, mayDraw: v.mayDraw, canTake: v.canTake, playable: v.playable };
        });
        if (st.done) break;
        const key = 'L' + (st.lesson + 1) + '-S' + (st.step + 1);
        if (!seen.includes(key)) { seen.push(key); await sleep(500); await shot(p, '31-tut-' + key); }
        if (st.final) break;
        // Previous: from a held note, across a lesson boundary, and back into the time limit
        const tryBack = { 'L1-S6': 'l1', 'L2-S1': 'l2', 'L5-S3': 'l5' }[key];
        if (tryBack && !back[tryBack]) {
          back[tryBack] = true;
          await p.tap('[data-act="prev"]');
          await sleep(600);
          checks.push('Previous from ' + key + ' → ' + JSON.stringify(await where()));
          if (key === 'L1-S6') await shot(p, '32-tut-previous-L1-S5');
          continue;
        }
        if (st.next || st.held) { await p.tap('.coach-actions .btn-primary'); await sleep(300); continue; }
        if (st.canTake) { const t = await p.$('[data-take]'); if (t) await t.tap(); await sleep(300); continue; }
        if (st.mustDraw) { await p.tap('#t-deck'); await sleep(620); continue; }
        if (st.lesson === 2 && st.mayDraw && !drewExtra) { drewExtra = true; await sleep(600); await p.tap('#t-deck'); await sleep(620); continue; }
        if (st.lesson === 4 && st.canLead) { await sleep(400); continue; }      // let the 8-second limit run out
        if (st.canLead || st.canFollow) {
          const id = st.playable[st.playable.length - 1];
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } }); await sleep(200);
          await p.tap(`.hcard[data-id="${id}"]`, { position: { x: 10, y: 24 } }); await sleep(300);
          continue;
        }
        await sleep(250);
      }
      const finalText = await p.evaluate(() => document.querySelector('.coach-title').textContent);
      await p.tap('[data-act="home"]');
      await sleep(400);
      const after = await p.evaluate(() => ({ screen: CT.App.screen, tutorial: !!CT.App.tutorial, save: !!localStorage.getItem('cardtable.save.v1') }));
      console.log('  steps:', seen.join(' '));
      checks.forEach(c => console.log('  ' + c));
      // Notes that left on their own must have stayed up for their reading time.
      const notes = await p.evaluate(() => window.__tut.map((e, i, a) => Object.assign({}, e, { shown: a[i + 1] ? Math.round(a[i + 1].t - e.t) : null })));
      notes.filter(n => n.kind === 'watch').forEach(n => console.log('  watch note ' + n.key + ': ' + n.how + ', up ' + n.shown + ' ms, reading time ' + n.reading + ' ms'));
      const rushed = notes.filter(n => (n.how === 'auto' || n.how === 'held-auto') && n.shown != null && n.shown < n.reading);
      console.log('  notes that left before their reading time:', rushed.length ? rushed.map(n => n.key + ' (' + n.shown + '/' + n.reading + ' ms)') : 'none');
      console.log('  final title:', finalText, '· after leaving:', after);
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (SCENARIO === 'timer') {
      // Sit idle with a 15-second limit: the countdown appears, then a card is played for you.
      const p = await open(browser, { ctx: { viewport: { width: 390, height: 844 } }, seed: 31,
        settings: { format: 2, burns: { opponents: 3, options: { leadCard: 'suitOnly', turnTime: '15' } } } });
      await p.tap('[data-play="burns"]');
      await sleep(200);
      await p.tap('#s-deal');
      let v = await view(p), guard = 0;
      while (v.phase === 'over' && guard++ < 6) { await p.waitForSelector('#r-again'); await p.tap('#r-again'); await sleep(2500); v = await view(p); }
      while (!(v.turnLeft != null && v.turnLeft < 8000 && (v.canFollow || v.mustDraw || v.canLead)) && guard++ < 400) { await sleep(200); v = await view(p); }
      await shot(p, '14-timer-running-out');
      const hand = v.hand;
      while ((v.canFollow || v.mustDraw || v.canLead) && guard++ < 600) { await sleep(200); v = await view(p); }
      await sleep(300);
      await shot(p, '15-timed-out');
      const log = await p.evaluate(() => CT.App.table.logItems.map(i => i.html.replace(/<[^>]+>/g, '')).filter(t => /Time ran out|random/.test(t)));
      console.log('  hand before', hand, 'phase now', v.phase, '· log:', log.slice(-3));
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (SCENARIO === 'take') {
      // Force a deck-empty take where you are the one who can't follow.
      const p = await open(browser, { ctx: { viewport: { width: 390, height: 844 } }, seed: 77,
        settings: { format: 2, burns: { opponents: 3, options: { leadCard: 'suitOnly' } } } });
      await p.tap('[data-play="burns"]');
      await sleep(200);
      await p.tap('#s-deal');
      await p.evaluate(() => {
        const st = CT.App.session.state;
        const card = id => ({ id, rank: id.slice(0, -1), suit: id.slice(-1) });
        const hands = [['2H', '3H', '4C', '5D'], ['6S', '7S', '8H', '9H'], ['10S', 'JS', 'QC', '2C'], ['AS', '3S', '4D', '5H']];
        const used = new Set([].concat(...hands, ['KS']));
        hands.forEach((h, i) => { st.players[i].hand = h.map(card); });
        st.starter = card('KS');
        st.deck = [];
        st.discard = CT.standardDeck().filter(c => !used.has(c.id));
      });
      let v = await view(p);
      let guard = 0;
      while (!(v.canTake) && guard++ < 200) { await sleep(150); v = await view(p); }
      await sleep(1200);
      await shot(p, '10-take-you');
      const before = (await view(p)).hand;
      const t = await p.$('[data-take]');
      const id = await t.getAttribute('data-take');
      await t.tap();
      await sleep(700);
      const after = await view(p);
      console.log('  took', id, '→ hand', before, '→', after.hand, 'phase', after.phase);
      await shot(p, '11-after-take');
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (SCENARIO === 'desktop') {
      const p = await open(browser, { ctx: { viewport: { width: 1280, height: 820 }, isMobile: false, hasTouch: true, deviceScaleFactor: 1 }, seed: 5, speed: 1 });
      await shot(p, '08-desktop-home');
      await p.tap('[data-play="burns"]');
      await sleep(200);
      await p.tap('#s-deal');
      await sleep(3300);
      await shot(p, '09-desktop-table');
      // resume after reload: the save should come back
      const before = await p.evaluate(() => { try { const s = JSON.parse(localStorage.getItem('cardtable.save.v1')); return s ? s.session.state.phase + ' set ' + s.session.state.setNo : 'none'; } catch (e) { return 'err ' + e.message; } });
      console.log('  saved before reload:', before);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await sleep(600);
      const after = await p.evaluate(() => { try { const raw = localStorage.getItem('cardtable.save.v1'); if (!raw) return 'no save'; const s = JSON.parse(raw); const ok = !!CT.Session.restore(s.session); return s.session.state.phase + ' set ' + s.session.state.setNo + ' restorable=' + ok + ' screen=' + CT.App.screen; } catch (e) { return 'err ' + e.message; } });
      console.log('  after reload:', after);
      const resume = await p.$('#h-resume');
      console.log('  resume offered after reload:', !!resume);
      if (resume) {
        await resume.tap();
        await sleep(1500);
        const v = await view(p);
        console.log('  resumed → phase', v.phase, 'set', v.setNo, 'hand', v.hand);
        await shot(p, '12-desktop-resumed');
      }
      await p.setViewportSize({ width: 800, height: 380 });
      await sleep(500);
      await shot(p, '13-landscape');
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
