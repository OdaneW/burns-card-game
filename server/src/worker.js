/* ==========================================================================
   ONLINE · the game server (a Cloudflare Worker)
   Every room is a Durable Object named after its code, holding the room
   (room.js) and talking to each phone over a WebSocket:
     GET /             a health check
     GET /rooms/new    (WebSocket) a new room with a fresh code
     GET /rooms/ABCD   (WebSocket) join room ABCD, or come back to it
   Sockets use the hibernation API, so a quiet room costs nothing while it
   waits; a room nobody has visited for a while is cleared away.
   ========================================================================== */
import CT from './engine.js';
import { RoomCore } from './room.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I to mix up
const EXPIRE_MS = 6 * 60 * 60 * 1000;                     // an empty room is cleared after six hours
const SAVE_MS = 3000;                                     // during play, save at most this often
const MAX_MESSAGE = 8192;

function newCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) code += CODE_CHARS[b % CODE_CHARS.length];
  return code;
}

function forward(request, params) {
  const url = new URL(request.url);
  for (const k in params) url.searchParams.set(k, params[k]);
  return new Request(url.toString(), request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('Card table server is running.', { headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
    }
    const m = url.pathname.match(/^\/rooms\/([A-Za-z0-9]{4}|new)$/);
    if (!m) return new Response('Not found', { status: 404 });
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('This address is for the game’s WebSocket connections.', { status: 426 });
    }
    if (m[1] === 'new') {
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        const res = await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(forward(request, { code: code, create: '1' }));
        if (res.status !== 409) return res;      // 409: that code is in use, try another
      }
      return new Response('No free room codes right now. Try again.', { status: 503 });
    }
    const code = m[1].toUpperCase();
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(forward(request, { code: code }));
  }
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sockets = new Map();      // connId → WebSocket
    this.timer = null;
    this.timerAt = 0;
    this.saveTimer = null;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));   // keep-alives, without waking the room
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('room');
      this.core = new RoomCore(this.io(), saved || null);
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() || {};
        if (!a.connId) continue;
        this.sockets.set(a.connId, ws);
        this.core.reattach(a.connId, a.memberId);
      }
      this.core.wake();
    });
  }

  io() {
    const self = this;
    return {
      send(connId, msg) {
        const ws = self.sockets.get(connId);
        if (!ws) return;
        try { ws.send(JSON.stringify(msg)); } catch (e) { /* already closed */ }
      },
      close(connId, code, reason) {
        const ws = self.sockets.get(connId);
        self.sockets.delete(connId);
        if (!ws) return;
        try { ws.close(code, reason); } catch (e) { /* already closed */ }
      },
      bind(connId, memberId) {
        const ws = self.sockets.get(connId);
        if (ws) ws.serializeAttachment({ connId: connId, memberId: memberId });
      },
      now() { return Date.now(); },
      random() { return Math.random(); },
      clock(startAt) { return new CT.Clock(startAt); },
      wake(ms) { self.wake(ms); },
      persist(now) { self.persist(now); }
    };
  }

  /* One timer for the room's next tick: the soonest anyone asked for. */
  wake(ms) {
    const at = Date.now() + ms;
    if (this.timer && this.timerAt <= at) return;
    clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.core.tick();
    }, ms);
  }

  persist(now) {
    if (!now) {
      if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, SAVE_MS);
      return;
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  save() {
    const snap = this.core.snapshot();
    if (snap) {
      this.ctx.storage.put('room', snap);
      // push the clear-away time back now and then (each alarm set is a storage write)
      if (Date.now() - (this.alarmSetAt || 0) > 30 * 60 * 1000) {
        this.alarmSetAt = Date.now();
        this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
      }
    } else {
      this.alarmSetAt = 0;
      this.ctx.storage.deleteAll();
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const create = url.searchParams.get('create') === '1';
    if (create) {
      if (this.core.exists()) return new Response('Taken', { status: 409 });
      this.core.create(url.searchParams.get('code'));
    }
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    const connId = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connId: connId, memberId: null });
    this.sockets.set(connId, server);
    this.core.open(connId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    const a = ws.deserializeAttachment() || {};
    if (!a.connId) return;
    if (!this.sockets.has(a.connId)) this.sockets.set(a.connId, ws);
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    this.core.message(a.connId, msg);
  }

  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const a = ws.deserializeAttachment() || {};
    if (!a.connId) return;
    this.sockets.delete(a.connId);
    this.core.disconnect(a.connId);
  }

  /* Nobody has been in the room for a while: clear it away. */
  async alarm() {
    if (this.ctx.getWebSockets().length) {
      this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
      return;
    }
    this.core = new RoomCore(this.io(), null);
    this.alarmSetAt = 0;
    await this.ctx.storage.deleteAll();
  }
}
