/* ==========================================================================
   BACKGROUND MUSIC — lobby music composed live with WebAudio, no files.
   A relaxed bossa-lounge tune in F (32-bar AABA): warm electric-piano
   comping, a round plucked bass, brushes and a soft rim click, and a
   vibraphone melody. The second time round the A sections leave space, so
   the loop (about 2½ minutes) doesn't wear thin. Everything is rolled off
   above ~4 kHz, so nothing is shrill on a phone speaker. Starts after the
   first tap (browsers require it) and fades out when the app goes to the
   background.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var Sound = UI.Sound;

  var BPM = 96;
  var BEAT = 60 / BPM;
  var BAR = BEAT * 4;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function jitter(ms) { return (Math.random() * 2 - 1) * ms / 1000; }      // human timing
  function vary(v, amount) { return v * (1 + (Math.random() * 2 - 1) * amount); }

  /* Chords: the bass root, and a rootless electric-piano voicing in the
     middle of the range phone speakers carry well. */
  var CH = {
    Fmaj9: { root: 41, ep: [57, 60, 64, 67] },   // A C E G over F
    Gm9: { root: 43, ep: [58, 62, 65, 69] },     // Bb D F A over G
    C13: { root: 48, ep: [58, 62, 64, 69] },     // Bb D E A over C
    Am7: { root: 45, ep: [55, 60, 64, 69] },     // G C E A over A
    D7b9: { root: 50, ep: [54, 60, 63, 69] },    // F# C Eb A over D
    D9: { root: 50, ep: [60, 64, 66, 69] },      // C E F# A over D
    Bbmaj9: { root: 46, ep: [62, 65, 69, 72] },  // D F A C over Bb
    Eb9: { root: 51, ep: [61, 65, 67, 70] }      // Db F G Bb over Eb
  };
  function fifth(root) { return root + 7 <= 53 ? root + 7 : root - 5; }

  /* The form. A bar with two chords changes on beat 3. */
  var INTRO = [['Fmaj9'], ['Gm9', 'C13'], ['Fmaj9'], ['Gm9', 'C13']];
  var A1 = [['Fmaj9'], ['Fmaj9'], ['Gm9'], ['C13'], ['Am7'], ['D7b9'], ['Gm9'], ['C13']];
  var A2 = [['Fmaj9'], ['Fmaj9'], ['Gm9'], ['C13'], ['Am7'], ['D7b9'], ['Gm9', 'C13'], ['Fmaj9']];
  var B = [['Bbmaj9'], ['Eb9'], ['Am7'], ['D9'], ['Gm9'], ['C13'], ['Am7', 'D9'], ['Gm9', 'C13']];
  var A3 = A2.slice(0, 7).concat([['Fmaj9', 'C13']]);   // turns back round to the top
  var CHORUS = A1.concat(A2, B, A3);

  /* The tune, bar by bar: [beat, MIDI note, length in beats]. A note on the
     last half-beat that runs over the bar line anticipates the next chord. */
  var MEL_A = [
    [[0, 69, 0.5], [0.5, 72, 0.5], [1, 76, 2], [3, 74, 0.5], [3.5, 72, 0.5]],
    [[0, 67, 1.5], [1.5, 69, 0.5], [2, 72, 1.5], [3.5, 74, 1.5]],
    [[1, 77, 0.5], [1.5, 74, 0.5], [2, 70, 1.5], [3.5, 76, 1.5]],
    [[1, 74, 0.5], [1.5, 72, 0.5], [2, 69, 2]],
    [[0, 72, 0.5], [0.5, 76, 0.5], [1, 79, 2], [3, 76, 0.5], [3.5, 78, 1.5]],
    [[1, 75, 0.5], [1.5, 74, 0.5], [2, 72, 2]],
    [[0, 70, 0.5], [0.5, 74, 0.5], [1, 77, 1.5], [2.5, 81, 1], [3.5, 79, 0.5]],
    [[0, 76, 2.5]]
  ];
  var MEL_A2 = MEL_A.slice(0, 6).concat([
    [[0, 70, 0.5], [0.5, 74, 0.5], [1, 77, 1], [2, 76, 1], [3, 74, 0.5], [3.5, 70, 0.5]],
    [[0, 69, 3]]
  ]);
  var MEL_B = [
    [[0.5, 74, 0.5], [1, 77, 0.5], [1.5, 81, 2.5]],
    [[0, 79, 1.5], [1.5, 77, 0.5], [2, 73, 1.5], [3.5, 72, 1.5]],
    [[1.5, 76, 0.5], [2, 79, 1], [3, 81, 0.5], [3.5, 78, 1.5]],
    [[1.5, 76, 0.5], [2, 72, 2]],
    [[0.5, 74, 0.5], [1, 77, 0.5], [1.5, 82, 1.5], [3, 81, 0.5], [3.5, 79, 0.5]],
    [[0, 76, 1.5], [1.5, 79, 0.5], [2, 74, 0.5], [2.5, 72, 1.5]],
    [[0, 76, 1], [1, 79, 1], [2, 78, 1], [3, 81, 1]],
    [[0, 77, 1], [1, 74, 1], [2, 76, 2]]
  ];
  var MELODY = MEL_A.concat(MEL_A2, MEL_B, MEL_A2);

  /* Two-bar bossa patterns: electric-piano hits [beat, accent], rim clicks. */
  var COMP = [[[0, 1], [1.5, 0.72], [3, 0.84]], [[1, 0.86], [2.5, 0.78]]];
  var RIM = [[0, 1.5, 3], [1, 2.5]];
  var KICK = [[0, 1], [1.5, 0.28], [2, 0.72], [3.5, 0.28]];

  /* Relative levels; the offline checks scale these to compare parts. */
  var MIX = { ep: 1, vib: 1, bass: 1, drums: 1, pad: 1 };

  function barInfo(n) {
    if (n < INTRO.length) return { chords: INTRO[n], chorus: -1, idx: n };
    var k = n - INTRO.length;
    return { chords: CHORUS[k % 32], chorus: Math.floor(k / 32), idx: k % 32 };
  }

  var Music = UI.Music = {
    on: true,
    playing: false,
    level: 0.65,
    bus: null,
    timer: null,
    nextBar: 0,
    bar: 0,
    BAR: BAR,
    MIX: MIX,

    start: function () {
      if (!this.on || this.playing || document.hidden) return;
      Sound.unlock();
      var ctx = Sound.ctx;
      if (!ctx) return;
      var self = this;
      if (ctx.state !== 'running') {
        try { ctx.resume().then(function () { if (self.on && !self.playing && !document.hidden) self.start(); }, function () {}); } catch (e) { /* wait for a tap */ }
        return;
      }
      try { this.build(ctx); } catch (e) { return; }
      this.playing = true;
      this.bar = 0;
      this.nextBar = ctx.currentTime + 0.2;
      this.timer = setInterval(function () { self.schedule(); }, 200);
      this.schedule();
    },

    stop: function () {
      if (!this.playing) return;
      this.playing = false;
      clearInterval(this.timer);
      this.timer = null;
      var ctx = Sound.ctx, bus = this.bus;
      this.bus = null;
      if (!ctx || !bus) return;
      var t = ctx.currentTime;
      try {
        bus.out.gain.cancelScheduledValues(t);
        bus.out.gain.setValueAtTime(Math.max(0.0001, bus.out.gain.value), t);
        bus.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        bus.lfos.forEach(function (l) { l.stop(t + 1); });
      } catch (e) { /* already gone */ }
      setTimeout(function () { try { bus.out.disconnect(); } catch (e) { /* ignore */ } }, 1100);
    },

    setOn: function (on) {
      this.on = on;
      if (on) this.start(); else this.stop();
    },

    /* One fresh signal chain per start, so notes already scheduled by a
       stopped run can never leak into the next one. */
    build: function (ctx) {
      var t = ctx.currentTime;
      var out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(this.level, t + 3);
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3;
      comp.attack.value = 0.02; comp.release.value = 0.4;
      out.connect(comp);
      comp.connect(ctx.destination);

      // the whole mix is rolled off above ~4 kHz: warm, never shrill
      var tone = ctx.createBiquadFilter();
      tone.type = 'lowpass'; tone.frequency.value = 4200; tone.Q.value = 0.5;
      tone.connect(out);
      var verb = ctx.createConvolver();
      verb.buffer = this.impulse(ctx);
      verb.connect(tone);

      var lfos = [];
      function lowpass(freq) {
        var f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = 0.5;
        return f;
      }
      function part(level, send, input) {
        var g = ctx.createGain(); g.gain.value = level;
        var s = ctx.createGain(); s.gain.value = send;
        input.connect(g); g.connect(tone); g.connect(s); s.connect(verb);
        return input;
      }
      function lfo(rate) {
        var o = ctx.createOscillator();
        o.frequency.value = rate;
        o.start(t);
        lfos.push(o);
        return o;
      }

      // electric piano: soft lowpass and a slow stereo sway
      var ep = lowpass(2600);
      var sway = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (sway) {
        var swayDepth = ctx.createGain(); swayDepth.gain.value = 0.3;
        lfo(2.9).connect(swayDepth); swayDepth.connect(sway.pan);
        ep.connect(sway);
        part(MIX.ep, 0.26, sway);
      } else part(MIX.ep, 0.26, ep);

      // vibraphone: the motor's gentle tremolo
      var vibIn = ctx.createGain();
      var trem = ctx.createGain(); trem.gain.value = 0.8;
      var tremDepth = ctx.createGain(); tremDepth.gain.value = 0.2;
      lfo(4.6).connect(tremDepth); tremDepth.connect(trem.gain);
      var vibTone = lowpass(3400);
      vibIn.connect(trem); trem.connect(vibTone);
      part(MIX.vib, 0.34, vibTone);

      var bass = part(MIX.bass, 0.04, ctx.createGain());
      var drums = part(MIX.drums, 0.12, lowpass(3600));
      var pad = part(MIX.pad, 0.45, lowpass(900));

      this.bus = { out: out, ep: ep, vib: vibIn, bass: bass, drums: drums, pad: pad, lfos: lfos };
    },

    /* A dark room: decaying noise that loses its top end as it fades. */
    impulse: function (ctx) {
      if (this.ir && this.ir.sampleRate === ctx.sampleRate) return this.ir;
      var sr = ctx.sampleRate, len = Math.floor(sr * 2.4), pre = Math.floor(sr * 0.015);
      var buf = ctx.createBuffer(2, len, sr);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch), y = 0;
        for (var i = pre; i < len; i++) {
          var x = (i - pre) / (len - pre);
          var a = 0.06 + 0.4 * Math.pow(1 - x, 1.6);
          y += a * ((Math.random() * 2 - 1) - y);
          d[i] = y * Math.pow(1 - x, 3) * 2.2;
        }
      }
      this.ir = buf;
      return buf;
    },

    noise: function (ctx) {
      if (this.nb && this.nb.sampleRate === ctx.sampleRate) return this.nb;
      var buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.nb = buf;
      return buf;
    },

    schedule: function () {
      var ctx = Sound.ctx;
      if (!this.playing || !ctx || !this.bus || ctx.state !== 'running') return;
      // After a stall (throttled tab) skip ahead rather than pile notes up.
      if (this.nextBar < ctx.currentTime - 0.25) this.nextBar = ctx.currentTime + 0.1;
      while (this.nextBar < ctx.currentTime + 0.6) {
        this.playBar(ctx, this.nextBar, this.bar);
        this.nextBar += BAR;
        this.bar++;
      }
    },

    playBar: function (ctx, t, n) {
      var self = this, bus = this.bus;
      var info = barInfo(n), next = barInfo(n + 1);
      var chords = info.chords.map(function (c) { return CH[c]; });
      function at(beat) { return chords[chords.length > 1 && beat >= 2 ? 1 : 0]; }
      function when(beat) { return t + beat * BEAT; }
      var intro = info.chorus < 0;

      // electric piano: bossa comping, each chord rolled very slightly
      var comp = COMP[n % 2];
      comp.forEach(function (hit, i) {
        var nextBeat = i + 1 < comp.length ? comp[i + 1][0] : 4 + COMP[(n + 1) % 2][0][0];
        var dur = (nextBeat - hit[0]) * BEAT - 0.07;
        var start = when(hit[0]) + jitter(7);
        var vel = vary(hit[1], 0.1);
        at(hit[0]).ep.forEach(function (m, k) { self.ep(ctx, bus, start + k * 0.005, m, dur, vel); });
      });

      // bass: root, fifth, fifth (or the new root), then a step into the next bar
      var c1 = at(0), c2 = at(2), nextRoot = CH[next.chords[0]].root;
      this.bass(ctx, bus, when(0) + jitter(3), c1.root, 1.35 * BEAT, vary(1, 0.06));
      this.bass(ctx, bus, when(1.5) + jitter(3), fifth(c1.root), 0.4 * BEAT, vary(0.5, 0.1));
      this.bass(ctx, bus, when(2) + jitter(3), c2 === c1 ? fifth(c1.root) : c2.root, 1.35 * BEAT, vary(0.85, 0.06));
      var step = Math.random() < 0.6 ? nextRoot + (Math.random() < 0.7 ? -1 : 1) : c2.root;
      this.bass(ctx, bus, when(3.5) + jitter(3), step, 0.42 * BEAT, vary(0.55, 0.1));

      // drums: brushes from the second bar, kick and rim once the tune starts
      if (n >= 1) {
        for (var e = 0; e < 8; e++) {
          var sweep = e === 2 || e === 6;
          this.brush(ctx, bus, when(e / 2) + jitter(5), vary(sweep ? 1 : 0.45, 0.2), sweep);
        }
      }
      if (!intro) {
        KICK.forEach(function (h) { self.kick(ctx, bus, when(h[0]) + jitter(3), vary(h[1], 0.08)); });
        RIM[n % 2].forEach(function (beat) { self.rim(ctx, bus, when(beat) + jitter(4), vary(1, 0.15)); });
      }

      // a soft pad lifts the bridge
      if (!intro && info.idx >= 16 && info.idx < 24) {
        if (chords.length > 1) { this.pad(ctx, bus, t, 2 * BEAT, chords[0].ep); this.pad(ctx, bus, when(2), 2 * BEAT, chords[1].ep); }
        else this.pad(ctx, bus, t, BAR, chords[0].ep);
      }

      // vibraphone: the tune. Second time round, the A sections leave space
      // and a short arpeggio answers in place of half the phrases.
      if (intro) return;
      var s = info.idx % 8;
      var thin = info.chorus % 2 === 1 && info.idx < 16;
      if (!thin || s === 0 || s === 1 || s === 4 || s === 5) {
        MELODY[info.idx].forEach(function (note) {
          var accent = note[0] === 0 || note[2] >= 1.5 ? 1 : 0.82;
          self.vibe(ctx, bus, when(note[0]) + jitter(6), note[1], note[2] * BEAT, vary(accent, 0.08));
        });
      } else if (s === 2 || s === 6) {
        [1, 1.5, 2, 2.5].forEach(function (beat, j) {
          self.vibe(ctx, bus, when(beat) + jitter(6), at(beat).ep[j] + 12, (j === 3 ? 1.5 : 0.5) * BEAT, vary(0.62, 0.08));
        });
      }
    },

    /* Electric piano: a sine with a little FM for the hammer's bark, which
       fades within a fifth of a second to a round, nearly pure tone. */
    ep: function (ctx, bus, t, midi, dur, vel) {
      var f = mtof(midi), peak = 0.024 * vel;
      var car = ctx.createOscillator();
      car.frequency.value = f;
      var mod = ctx.createOscillator();
      mod.frequency.value = f;
      var depth = ctx.createGain();
      depth.gain.setValueAtTime(f * (0.8 + 0.8 * vel), t);
      depth.gain.setTargetAtTime(f * 0.3, t, 0.16);
      mod.connect(depth); depth.connect(car.frequency);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.005);
      g.gain.setTargetAtTime(peak * 0.2, t + 0.005, 0.9);
      g.gain.setTargetAtTime(0, t + dur, 0.09);
      car.connect(g); g.connect(bus.ep);
      car.start(t); mod.start(t);
      car.stop(t + dur + 0.6); mod.stop(t + dur + 0.6);
    },

    /* Vibraphone: the bar's fundamental plus its quiet fourth partial, which
       dies away quickly, then dampened a moment after the note's length. */
    vibe: function (ctx, bus, t, midi, dur, vel) {
      var f = mtof(midi), ring = Math.min(dur, 2.5) + 0.35;
      [[1, 1, 1.2], [4, 0.07, 0.1]].forEach(function (p) {
        var o = ctx.createOscillator();
        o.frequency.value = f * p[0];
        var g = ctx.createGain(), peak = 0.026 * vel * p[1];
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.006);
        g.gain.setTargetAtTime(0, t + 0.006, p[2]);
        g.gain.setTargetAtTime(0, t + ring, 0.08);
        o.connect(g); g.connect(bus.vib);
        o.start(t); o.stop(t + ring + 0.5);
      });
    },

    /* Plucked bass: a sine body with a filtered sawtooth for the pluck, so
       the notes still read on small speakers that can't play the low end. */
    bass: function (ctx, bus, t, midi, dur, vel) {
      var f = mtof(midi), peak = 0.07 * vel;
      var body = ctx.createOscillator();
      body.frequency.value = f;
      var saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = f;
      var sawLevel = ctx.createGain(); sawLevel.gain.value = 0.8;
      var bodyLevel = ctx.createGain(); bodyLevel.gain.value = 0.6;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(Math.min(2000, f * 10), t);
      lp.frequency.setTargetAtTime(f * 4.5, t, 0.09);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.008);
      g.gain.setTargetAtTime(peak * 0.4, t + 0.008, 0.28);
      g.gain.setTargetAtTime(0, t + dur, 0.05);
      saw.connect(sawLevel); sawLevel.connect(lp); body.connect(bodyLevel); bodyLevel.connect(lp); lp.connect(g); g.connect(bus.bass);
      body.start(t); saw.start(t);
      body.stop(t + dur + 0.4); saw.stop(t + dur + 0.4);
    },

    kick: function (ctx, bus, t, vel) {
      var o = ctx.createOscillator();
      o.frequency.setValueAtTime(115, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.003);
      g.gain.setTargetAtTime(0, t + 0.003, 0.07);
      o.connect(g); g.connect(bus.drums);
      o.start(t); o.stop(t + 0.5);
    },

    /* Cross-stick: a short, woody knock rather than a bright click. */
    rim: function (ctx, bus, t, vel) {
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(780, t);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.03);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.04 * vel, t + 0.001);
      g.gain.setTargetAtTime(0, t + 0.001, 0.014);
      o.connect(g); g.connect(bus.drums);
      o.start(t); o.stop(t + 0.15);
    },

    /* Brushes on a snare: band-limited noise, a slow sweep on 2 and 4. */
    brush: function (ctx, bus, t, vel, sweep) {
      var src = ctx.createBufferSource();
      src.buffer = this.noise(ctx);
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = sweep ? 1500 : 2100; bp.Q.value = 0.8;
      var g = ctx.createGain();
      var rise = sweep ? 0.05 : 0.008, fall = sweep ? 0.15 : 0.045;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.022 * vel, t + rise);
      g.gain.setTargetAtTime(0, t + rise, fall);
      src.connect(bp); bp.connect(g); g.connect(bus.drums);
      src.start(t, Math.random() * 1.4, rise + fall * 6);
    },

    pad: function (ctx, bus, t, dur, notes) {
      notes.forEach(function (m) {
        var o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(m);
        o.detune.value = (Math.random() * 2 - 1) * 5;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.009, t + 0.7);
        g.gain.setTargetAtTime(0, t + dur, 0.5);
        o.connect(g); g.connect(bus.pad);
        o.start(t); o.stop(t + dur + 3);
      });
    }
  };
})(window.CT);
