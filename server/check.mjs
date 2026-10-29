/* A live check of the deployed server: two pretend phones make a room, play
   a whole game of Burns against each other (deciding like the computer
   players do, from only what each is sent), check nobody was sent anyone
   else's cards, then leave. Then two pretend players (the same two each
   time) become friends and stop being friends again. Run after each deploy:
     node server/check.mjs https://burns-card-game.<you>.workers.dev */
import CT from './src/engine.js';

const base = (process.argv[2] || 'http://127.0.0.1:8787').replace(/^http/, 'ws').replace(/\/+$/, '');
const LIMIT_MS = 180000;
const WELCOME_MS = 20000;
const t0 = Date.now();
let finished = false;
// where things stood, so a failure says more than "it failed"
const status = () => ' [after ' + Math.round((Date.now() - t0) / 1000) + ' s; ' + [host, guest].map(p =>
  p.name + ': ' + (p.code ? 'room ' + p.code : 'no welcome') + ', ' + p.msgs.length + ' messages, ' +
  (p.view ? p.view.phase + ' in set ' + p.view.setNo + (p.busy ? ', waiting on a move' : '') : 'no game yet')).join(' · ') + ']';
const fail = m => { finished = true; console.error('✗ ' + m + status()); process.exit(1); };
setTimeout(() => fail('the game didn’t finish in time'), LIMIT_MS);

function phone(name, token) {
  const p = { name, token, msgs: [], view: null, memory: {}, busy: false };
  p.connect = path => new Promise((resolve, reject) => {
    const ws = new WebSocket(base + path);
    p.ws = ws;
    const late = setTimeout(() => reject(new Error('no welcome from the server within ' + WELCOME_MS / 1000 + ' s')), WELCOME_MS);
    ws.onopen = () => ws.send(JSON.stringify(Object.assign({ t: 'hello', v: 1, token, name }, p.extra || {})));
    ws.onerror = e => reject(new Error('WebSocket error' + (e && e.message ? ': ' + e.message : '')));
    ws.onclose = e => { if (!finished) fail(name + '’s connection closed (code ' + e.code + (e.reason ? ', ' + e.reason : '') + ')'); };
    ws.onmessage = e => {
      if (e.data === 'pong') return;
      const m = JSON.parse(e.data);
      if (m.t === 'pong') return;
      p.msgs.push(m);
      if (m.t === 'welcome') { p.code = m.code; clearTimeout(late); resolve(); }
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
try {
  await host.connect('/rooms/new');
  console.log('Created room ' + host.code);
  await guest.connect('/rooms/' + host.code);
  console.log('Joined it from a second phone');
} catch (e) { fail(e.message); }
host.send({ t: 'start' });
// like the app, check in every few seconds: a phone that's quiet for long during a game counts as gone
setInterval(() => [host, guest].forEach(p => { if (p.ws.readyState === 1) p.send({ t: 'ping', c: Date.now() }); }), 4000);

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

// no phone was told anyone else's token; everyone has a friend code
const rooms = host.msgs.filter(m => m.t === 'room').map(m => JSON.stringify(m));
if (rooms.some(r => r.includes(guest.token))) fail('a token was sent to another phone');
const lastRoom = host.msgs.filter(m => m.t === 'room').pop().room;
if (!lastRoom.members.every(m => /^[A-Z2-9]{8,}$/.test(m.code || ''))) fail('people in the room have no friend codes');
if (!v.tally || typeof v.tally !== 'object') fail('the game’s stats weren’t counted');
console.log('Friend codes in the room: ' + lastRoom.members.map(m => m.code).join(', ') + '; your stats this game: ' + JSON.stringify(v.tally));

finished = true;
host.send({ t: 'leave' });
guest.send({ t: 'leave' });

// friends: the same two pretend players every time, so nothing piles up
const http = base.replace(/^ws/, 'http');
const players = async (token, body) => {
  const res = await fetch(http + '/players', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status !== 200) fail('the friends server answered ' + res.status);
  if (res.headers.get('access-control-allow-origin') !== '*') fail('the friends server can’t be reached from the app (no CORS)');
  return res.json();
};
try {
  const A = 'live-check-friend-aaaaaaaaaaaa', B = 'live-check-friend-bbbbbbbbbbbb';
  const a = await players(A, { name: 'Check A', stats: { burns: { played: 1, won: 1, sets: 3 } } });
  const b = await players(B, { name: 'Check B', remove: a.you.code });
  const added = await players(B, { add: a.you.code });
  if (!added.added || !added.friends.some(f => f.code === a.you.code && f.stats.burns && f.stats.burns.sets === 3)) fail('adding a friend didn’t work: ' + JSON.stringify(added));
  const back = await players(A, {});
  if (!back.friends.some(f => f.code === b.you.code)) fail('the friendship didn’t go both ways');
  const gone = await players(A, { remove: b.you.code });
  if (gone.friends.some(f => f.code === b.you.code)) fail('removing a friend didn’t work');
  console.log('Friends: ' + a.you.code + ' and ' + b.you.code + ' added and removed each other');
} catch (e) { fail('friends: ' + e.message); }
setTimeout(() => { console.log('Both left. All good.'); process.exit(0); }, 800);
