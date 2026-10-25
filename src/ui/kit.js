/* ==========================================================================
   UI KIT — shared by every mode's table: card elements, suit icons,
   flying-card animation, sound, toasts and per-device storage.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI = CT.UI || {};

  var PLURAL = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds' };
  var SINGLE = { S: 'spade', H: 'heart', C: 'club', D: 'diamond' };

  UI.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  UI.isRed = function (suit) { return suit === 'H' || suit === 'D'; };
  UI.suitPlural = function (s) { return PLURAL[s]; };
  UI.suitSingle = function (s) { return SINGLE[s]; };

  UI.suitSvg = function (suit) {
    return '<svg class="si" viewBox="0 0 100 100" aria-hidden="true"><use href="#suit-' + suit + '"/></svg>';
  };
  /** Suit icon for running text, coloured for the dark board. */
  UI.suit = function (suit) {
    return '<span class="' + (UI.isRed(suit) ? 'suit-red' : 'suit-black') + '" aria-label="' + PLURAL[suit] + '">' + UI.suitSvg(suit) + '</span>';
  };
  /** "K♥" for running text. */
  UI.cardText = function (card) {
    return '<span class="ct ' + (UI.isRed(card.suit) ? 'suit-red' : 'suit-black') + '" aria-label="' + UI.esc(CT.cardName(card)) + '">' + card.rank + UI.suitSvg(card.suit) + '</span>';
  };

  UI.cardFace = function (card) {
    var r = card.rank;
    var idx = '<b' + (r === '10' ? ' class="ten"' : '') + '>' + r + '</b>' + UI.suitSvg(card.suit);
    var center;
    if (r === 'J' || r === 'Q' || r === 'K') center = '<span class="face">' + r + '</span>';
    else center = '<span class="pip' + (r === 'A' ? ' ace' : '') + '">' + UI.suitSvg(card.suit) + '</span>';
    return '<span class="ci">' + idx + '</span>' + center + '<span class="ci ci-b">' + idx + '</span>';
  };

  /** A card element; pass null for a face-down card. */
  UI.makeCard = function (card, tag) {
    var el = document.createElement(tag || 'div');
    UI.setCard(el, card);
    return el;
  };
  UI.setCard = function (el, card) {
    var key = card ? card.id : 'back';
    if (el.dataset.card === key) return el;
    el.dataset.card = key;
    el.classList.remove('red', 'back');
    el.classList.add('card');
    if (card) {
      if (UI.isRed(card.suit)) el.classList.add('red');
      el.innerHTML = UI.cardFace(card);
      el.setAttribute('aria-label', CT.cardName(card));
    } else {
      el.classList.add('back');
      el.innerHTML = '';
      el.setAttribute('aria-label', 'Face-down card');
    }
    return el;
  };

  UI.reducedMotion = (function () {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  })();

  /**
   * Fly a card from one place to another.
   * from: element or DOMRect; to: element. Resolves when it lands.
   */
  UI.fly = function (opts) {
    return new Promise(function (resolve) {
      var a = opts.fromRect || (opts.from && opts.from.getBoundingClientRect && opts.from.getBoundingClientRect());
      var b = opts.to && opts.to.getBoundingClientRect && opts.to.getBoundingClientRect();
      var layer = document.getElementById('fx');
      if (!a || !b || !a.width || !b.width || !layer || UI.reducedMotion || document.hidden) { resolve(); return; }
      var g = UI.makeCard(opts.card || null);
      g.classList.add('ghost');
      // Draw the ghost at the larger of the two sizes and only ever scale it down,
      // so the card-back pattern and shadow never get blown up.
      var base = Math.max(a.width, b.width);
      g.style.setProperty('--cw', base + 'px');
      var bh = base * 1.4;
      g.style.left = (b.left + b.width / 2 - base / 2) + 'px';
      g.style.top = (b.top + b.height / 2 - bh / 2) + 'px';
      var dx = (a.left + a.width / 2) - (b.left + b.width / 2);
      var dy = (a.top + a.height / 2) - (b.top + b.height / 2);
      layer.appendChild(g);
      var spin = opts.spin || 0;
      var anim = g.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + (a.width / base) + ') rotate(' + spin + 'deg)' },
        { transform: 'translate(0,0) scale(' + (b.width / base) + ') rotate(0deg)' }
      ], { duration: opts.duration || 360, delay: opts.delay || 0, easing: 'cubic-bezier(.22,.8,.26,1)', fill: 'both' });
      var done = function () { if (g.parentNode) g.parentNode.removeChild(g); resolve(); };
      anim.onfinish = done;
      anim.oncancel = done;
    });
  };

  /* ---------- toast ---------- */
  var toastTimer = null;
  UI.toast = function (html, ms) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(toastTimer);
    // up for at least as long as it takes to read; longer messages stay longer
    var read = 1200 + 55 * (el.textContent || '').length;
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, Math.max(ms || 1900, read));
  };

  /* ---------- storage (per device; may be unavailable) ---------- */
  UI.store = {
    get: function (key, fallback) {
      try { var v = window.localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked */ }
    },
    del: function (key) {
      try { window.localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
    }
  };

  /* ---------- sound: tiny synthesised effects, no files ---------- */
  var Sound = UI.Sound = {
    ctx: null,
    on: true,
    noiseBuf: null,
    unlock: function () {
      if (!this.ctx) {
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) this.ctx = new AC();
        } catch (e) { this.ctx = null; }
      }
      if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* ignore */ } }
    },
    ready: function () { return this.on && this.ctx && this.ctx.state === 'running'; },
    noise: function (dur, freq, gain, when) {
      var c = this.ctx;
      if (!this.noiseBuf) {
        this.noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
        var d = this.noiseBuf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      var src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      var f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4;
      var g = c.createGain();
      var t = c.currentTime + (when || 0);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.out());
      src.start(t, Math.random() * 0.3, dur + 0.02);
    },
    /* Effects share a gentle top-end roll-off, so nothing is piercing. */
    out: function () {
      var c = this.ctx;
      if (!this.bus || this.bus.context !== c) {
        var lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 5500; lp.Q.value = 0.5;
        lp.connect(c.destination);
        this.bus = lp;
      }
      return this.bus;
    },
    tone: function (freq, dur, gain, type, when) {
      var c = this.ctx;
      var o = c.createOscillator();
      var g = c.createGain();
      var t = c.currentTime + (when || 0);
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out());
      o.start(t); o.stop(t + dur + 0.03);
    },
    play: function (name) {
      if (!this.ready()) return;
      try {
        switch (name) {
          case 'deal': this.noise(0.05, 2000, 0.2); break;
          case 'draw': this.noise(0.06, 1700, 0.26); break;
          case 'play': this.noise(0.07, 1100, 0.3); this.tone(180, 0.08, 0.08, 'sine'); break;
          case 'flip': this.noise(0.04, 2300, 0.17); this.noise(0.04, 2000, 0.13, 0.05); break;
          case 'win': this.tone(523, 0.14, 0.12, 'triangle'); this.tone(784, 0.22, 0.12, 'triangle', 0.1); break;
          case 'lose': this.tone(392, 0.16, 0.1, 'triangle'); this.tone(330, 0.24, 0.1, 'triangle', 0.12); break;
          case 'alert': this.tone(659, 0.13, 0.11, 'triangle'); this.tone(523, 0.18, 0.1, 'triangle', 0.11); break;
          case 'tick': this.tone(880, 0.06, 0.07, 'sine'); this.noise(0.02, 1200, 0.06); break;
          case 'nope': this.tone(330, 0.1, 0.09, 'triangle'); this.tone(262, 0.15, 0.09, 'triangle', 0.08); break;
          case 'victory': [523, 659, 784, 1046].forEach(function (f, i) { Sound.tone(f, 0.22, i === 3 ? 0.09 : 0.11, i === 3 ? 'sine' : 'triangle', i * 0.11); }); break;
        }
      } catch (e) { /* audio is optional */ }
    }
  };

  UI.buzz = function (ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) { /* not allowed here */ }
  };

  /* Small inline icons used by the shell and tables. */
  UI.icon = {
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h11"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
    musicOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17.5V6.5l10-2.5v11"/><circle cx="6.5" cy="17.5" r="2.6" fill="currentColor" stroke="none"/><circle cx="16.5" cy="15" r="2.6" fill="currentColor" stroke="none"/></svg>',
    musicOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17.5V6.5l10-2.5v11"/><circle cx="6.5" cy="17.5" r="2.6" fill="currentColor" stroke="none"/><circle cx="16.5" cy="15" r="2.6" fill="currentColor" stroke="none"/><path d="M3.5 3.5l17 17"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><path d="M4 4l16 16"/></svg>',
    flame: '<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-flame"/></svg>'
  };
})(window.CT);
