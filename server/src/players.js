/* ==========================================================================
   ONLINE · players and friends
   Every phone that opens Friends gets a player profile here: a friend code
   to share, a name, its stats for each game, and its friends. A friendship
   goes both ways: add someone's code and you're on each other's list (and
   leaderboard) until either of you removes it.

   Who you are is the private token your phone already uses for rooms: the
   server keeps only a one-way hash of it, which is also where the friend
   code comes from, so a room can show the code of everyone in it and you can
   add them as a friend there.

   One request does everything, POST /players with the token as a bearer
   token and a JSON body of { name?, stats?, add?: code, remove?: code }, and
   gets back { you: { code, name }, friends: [{ code, name, stats, updated }],
   added?, error? }.

   No platform code here: the Durable Object (worker.js) and the tests supply
   the storage: { get(key), getMany(keys) → Map, put(key, value) }.
   ========================================================================== */
import { sha256 } from './sha256.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // as room codes: no 0/O or 1/I to mix up
const CODE_LEN = 8;
export const FRIENDS_MAX = 100;
const NAME_MAX = 16;
const STATS_MAX_BYTES = 12000;
const RATE_MAX = 40;            // requests…
const RATE_MS = 60000;          // …a minute, from one player

/* A player's id: a one-way hash of their phone's private token. */
export function idFor(token) { return sha256('player:' + token); }

/* The friend code: the id's first 40 bits (8 characters), or more if that's taken. */
export function codeFor(id, len) {
  len = len || CODE_LEN;
  let code = '', acc = 0, bits = 0;
  for (let i = 0; i < id.length && code.length < len; i += 2) {
    acc = (acc << 8) | parseInt(id.slice(i, i + 2), 16);
    bits += 8;
    while (bits >= 5 && code.length < len) {
      bits -= 5;
      code += CODE_CHARS[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return code;
}

/* What someone typed: "k7pq-2mxd" → "K7PQ2MXD" (spaces, dashes and anything else dropped). */
export function cleanCode(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '').slice(0, 16);
}

export function cleanToken(s) {
  s = String(s || '');
  return /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : null;
}

function cleanName(s) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f<>‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('').trim();
}

/* Stats as the app keeps them: { mode: { count: number, …, online: { count: number } } }.
   Anything else is left out; numbers are whole or to two places, and not absurd. */
export function cleanStats(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  const num = v => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1e9 ? Math.round(v * 100) / 100 : null;
  Object.keys(src).slice(0, 16).forEach(mode => {
    const m = src[mode];
    if (!/^[a-z]{2,16}$/.test(mode) || !m || typeof m !== 'object') return;
    const dst = {};
    Object.keys(m).slice(0, 48).forEach(k => {
      if (!/^[A-Za-z]{1,24}$/.test(k)) return;
      const v = m[k];
      if (k === 'online' && v && typeof v === 'object') {
        const o = {};
        Object.keys(v).slice(0, 16).forEach(j => { const n = /^[A-Za-z]{1,24}$/.test(j) ? num(v[j]) : null; if (n != null) o[j] = n; });
        dst.online = o;
        return;
      }
      const n = num(v);
      if (n != null) dst[k] = n;
    });
    out[mode] = dst;
  });
  return JSON.stringify(out).length <= STATS_MAX_BYTES ? out : {};
}

const ERRORS = {
  'bad-token': 'Something went wrong with this phone’s player code. Try again.',
  'no-player': 'No one has that friend code yet. Check it with your friend: they can find it under Friends.',
  self: 'That’s your own friend code. Share it with your friends so they can add you.',
  full: 'That’s the most friends you can have: ' + FRIENDS_MAX + '. Remove someone first.',
  'their-full': 'They already have the most friends anyone can have.',
  busy: 'That was a lot at once. Wait a moment, then try again.'
};
function fail(status, code) { return { status, body: { error: code, message: ERRORS[code] } }; }

export class Directory {
  constructor(store, now) {
    this.store = store;
    this.now = now || (() => Date.now());
    this.hits = new Map();         // id → recent request times (not saved)
  }

  limited(id) {
    const now = this.now();
    const list = (this.hits.get(id) || []).filter(t => now - t < RATE_MS);
    list.push(now);
    this.hits.set(id, list);
    if (this.hits.size > 5000) this.hits.clear();
    return list.length > RATE_MAX;
  }

  /* This player's profile, made the first time (with a code nobody else has). */
  async profile(id) {
    const have = await this.store.get('p:' + id);
    if (have) return have;
    let code = codeFor(id);
    for (let len = CODE_LEN + 2; len <= 16; len += 2) {
      const owner = await this.store.get('c:' + code);
      if (!owner || owner === id) break;
      code = codeFor(id, len);
    }
    const p = { id, code, name: 'Player', stats: {}, friends: [], created: this.now(), updated: this.now() };
    await this.store.put('c:' + code, id);
    await this.store.put('p:' + id, p);
    return p;
  }

  async byCode(code) {
    code = cleanCode(code);
    if (code.length < CODE_LEN) return null;
    const id = await this.store.get('c:' + code);
    return id ? (await this.store.get('p:' + id)) || null : null;
  }

  async handle(token, body) {
    token = cleanToken(token);
    if (!token) return fail(401, 'bad-token');
    body = body && typeof body === 'object' ? body : {};
    const id = idFor(token);
    if (this.limited(id)) return fail(429, 'busy');
    const me = await this.profile(id);
    let changed = false, added = null, error = null;
    if (body.name != null) {
      const name = cleanName(body.name);
      if (name && name !== me.name) { me.name = name; changed = true; }
    }
    if (body.stats != null) { me.stats = cleanStats(body.stats); changed = true; }
    if (body.add != null) {
      const other = await this.byCode(body.add);
      if (!other) error = 'no-player';
      else if (other.id === me.id) error = 'self';
      else if (me.friends.indexOf(other.id) >= 0) added = other;
      else if (me.friends.length >= FRIENDS_MAX) error = 'full';
      else if (other.friends.length >= FRIENDS_MAX) error = 'their-full';
      else {
        me.friends.push(other.id);
        if (other.friends.indexOf(me.id) < 0) other.friends.push(me.id);
        await this.store.put('p:' + other.id, other);
        added = other;
        changed = true;
      }
    }
    if (body.remove != null) {
      const other = await this.byCode(body.remove);
      if (other) {
        me.friends = me.friends.filter(f => f !== other.id);
        other.friends = other.friends.filter(f => f !== me.id);
        await this.store.put('p:' + other.id, other);
        changed = true;
      }
    }
    if (changed) { me.updated = this.now(); await this.store.put('p:' + id, me); }
    const found = me.friends.length ? await this.store.getMany(me.friends.map(f => 'p:' + f)) : new Map();
    const friends = [];
    me.friends.forEach(f => {
      const p = found.get('p:' + f);
      if (p) friends.push({ code: p.code, name: p.name, stats: p.stats, updated: p.updated });
    });
    friends.sort((a, b) => a.name.localeCompare(b.name));
    const out = { you: { code: me.code, name: me.name }, friends };
    if (added) out.added = { code: added.code, name: added.name };
    if (error) { out.error = error; out.message = ERRORS[error]; }
    return { status: 200, body: out };
  }
}
