/* A live check of the deployed server: two pretend phones make a room, play
   a whole game of Burns against each other (deciding like the computer
   players do, from only what each is sent), check nobody was sent anyone
   else's cards, then leave. Run after each deploy:
     node server/check.mjs https://burns-card-game.<you>.workers.dev */
import CT from './src/engine.js';

const base = (process.argv[2] || 'http://127.0.0.1:8787').replace(/^http/, 'ws').replace(/\/+$/, '');
const LIMIT_MS = 180000;
const fail = m => { console.error('✗ ' + m); process.exit(1); };
setTimeout(() => fail('the game didn’t finish in time'), LIMIT_MS);

function phone(name, token) {
  const p = { name, token, msgs: [], view: null, memory: {}, busy: false };
  p.connect = path => new Promise((resolve, reject) => {
    const ws = new WebSocket(base + path);
    p.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(Object.assign({ t: 'hello', v: 1, token, name }, p.extra || {})));
    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onmessage = e => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data);
      p.msgs.push(m);
      if (m.t === 'welcome') { p.code = m.code; resolve(); }
      if (m.t === 'error') fail(name + ': ' + m.message);
      if (m.t === 'state') {
        (m.view.events || []).forEach(ev => { if (ev.secret) fail('a secret was sent to ' + name); });
        delete m.view.events;
        p.view = m.view;
      }
      if (m.t === 'result') p.busy = false;
    };
  });
  p.send = m => p.ws.send(JSON.stringify(m));
  return p;
}

const host = phone('Check host', 'live-check-host-' + Date.now());
const guest = phone('Check guest', 'live-check-guest-' + Date.now());
host.extra = { mode: 'burns', size: 2, options: { turnTime: '15' } };
await host.connect('/rooms/new');
console.log('Created room ' + host.code);
await guest.connect('/rooms/' + host.code);
console.log('Joined it from a second phone');
host.send({ t: 'start' });

const mode = CT.getMode('burns');
let rngState = 12345;
const rnd = () => { rngState = (rngState * 1103515245 + 12345) % 2147483648; return rngState / 2147483648; };
let n = 0;
const started = Date.now();
await new Promise(resolve => {
  const loop = setInterval(() => {
    const over = [host, guest].every(p => p.view && p.view.phase === 'over');
    if (over) { clearInterval(loop); resolve(); return; }
    [host, guest].forEach(p => {
      if (!p.view || p.busy || p.view.phase === 'over') return;
      if (!mode.bot.intent(p.view) || rnd() < 0.5) return;
      const action = mode.bot.decide(p.view, p.memory, rnd);
      if (!action) return;
      p.busy = true;
      p.send({ t: 'act', id: ++n, type: action.type, payload: action.payload || {} });
    });
  }, 250);
});
const v = host.view;
console.log('Game over after ' + Math.round((Date.now() - started) / 1000) + ' s and ' + n + ' moves: ' +
  v.winners.map(id => v.players.find(p => p.id === id).name).join(' & ') + ' won');

// no phone was told anyone else's token
const rooms = host.msgs.filter(m => m.t === 'room').map(m => JSON.stringify(m));
if (rooms.some(r => r.includes(guest.token))) fail('a token was sent to another phone');

host.send({ t: 'leave' });
guest.send({ t: 'leave' });
setTimeout(() => { console.log('Both left. All good.'); process.exit(0); }, 800);
