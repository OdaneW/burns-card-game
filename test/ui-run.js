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
  // start from clean storage (plus any preset settings), then load again
  await p.evaluate(settings => { localStorage.clear(); if (settings) localStorage.setItem('cardtable.settings.v1', JSON.stringify(settings)); }, opts.settings || null);
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
      // 360×640, five opponents, Take and play + face-up leads, double speed
      const p = await open(browser, { ctx: { viewport: { width: 360, height: 640 } }, seed: 4242, speed: 2,
        settings: { burns: { opponents: 5, options: { deckEmpty: 'takeAndPlay', leadCard: 'faceUp' } } } });
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

    if (SCENARIO === 'tutorial') {
      // Follow the tutorial's instructions from How to play to the end.
      const p = await open(browser, { ctx: { viewport: { width: 390, height: 844 } }, seed: 3 });
      await p.tap('[data-rules="burns"]');
      await sleep(350);
      await shot(p, '30-how-to-play');
      await p.tap('#r-tutorial');
      await sleep(500);
      const seen = [];
      let guard = 0, drewExtra = false;
      while (guard++ < 800) {
        const st = await p.evaluate(() => {
          const t = CT.App.tutorial; if (!t) return { done: true };
          const s = t.current(); const v = CT.App.session.view('p0', { events: false });
          return { done: false, lesson: t.index, step: t.step, next: !!s.next, final: !!s.final,
            canLead: v.canLead, canFollow: v.canFollow, mustDraw: v.mustDraw, mayDraw: v.mayDraw, canTake: v.canTake, playable: v.playable };
        });
        if (st.done) break;
        const key = 'L' + (st.lesson + 1) + '-S' + (st.step + 1);
        if (!seen.includes(key)) { seen.push(key); await sleep(500); await shot(p, '31-tut-' + key); }
        if (st.final) break;
        if (st.next) { await p.tap('.coach-actions .btn-primary'); await sleep(300); continue; }
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
      await p.tap('.coach-actions .btn-plain');
      await sleep(400);
      const after = await p.evaluate(() => ({ screen: CT.App.screen, tutorial: !!CT.App.tutorial, save: !!localStorage.getItem('cardtable.save.v1') }));
      console.log('  steps:', seen.join(' '));
      console.log('  final title:', finalText, '· after leaving:', after);
      console.log('  errors:', p.errors.length ? p.errors : 'none');
    }

    if (SCENARIO === 'timer') {
      // Sit idle with a 15-second limit: the countdown appears, then a card is played for you.
      const p = await open(browser, { ctx: { viewport: { width: 390, height: 844 } }, seed: 31,
        settings: { burns: { opponents: 3, options: { leadCard: 'suitOnly', turnTime: '15' } } } });
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
        settings: { burns: { opponents: 3, options: { deckEmpty: 'pickUp', leadCard: 'suitOnly' } } } });
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
