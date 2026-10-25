/* ==========================================================================
   BACKGROUND MUSIC — composed live with WebAudio, no audio files.
   A slow, warm loop: soft electric-piano pads, a round bass, and a sparse
   steel-pan melody that wanders a pentatonic scale, so it never repeats
   exactly. Starts after the first tap (browsers require it), fades out when
   the app goes to the background.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;
  var Sound = UI.Sound;

  var BPM = 74;
  var BEAT = 60 / BPM;
  var BAR = BEAT * 4;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // Voicings sit in the range phone speakers carry well.
  var CHORDS = {
    Cmaj9: { bass: 48, pad: [64, 67, 71, 74] },
    Am9: { bass: 45, pad: [64, 67, 71, 72] },
    Dm9: { bass: 50, pad: [64, 65, 69, 72] },
    G9sus: { bass: 43, pad: [65, 69, 72, 74] },
    Fmaj9: { bass: 41, pad: [64, 67, 69, 72] },
    Em7: { bass: 52, pad: [62, 64, 67, 71] },
    G69: { bass: 43, pad: [62, 64, 69, 71] }
  };
  var PHRASES = [
    ['Cmaj9', 'Am9', 'Dm9', 'G9sus'],
    ['Cmaj9', 'Am9', 'Fmaj9', 'G69'],
    ['Fmaj9', 'Em7', 'Dm9', 'G9sus'],
    ['Cmaj9', 'Am9', 'Fmaj9', 'G69']
  ];
  var SCALE = [72, 74, 76, 79, 81, 84, 86, 88];   // C major pentatonic, C5 to E6

  var Music = UI.Music = {
    on: true,
    playing: false,
    level: 0.7,
    bus: null,
    timer: null,
    nextBar: 0,
    bar: 0,
    note: 3,

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
        bus.lfo.stop(t + 1);
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

      var mix = ctx.createGain();
      var dry = ctx.createGain(); dry.gain.value = 0.8;
      var verb = ctx.createConvolver(); verb.buffer = this.impulse(ctx);
      var wet = ctx.createGain(); wet.gain.value = 0.32;
      mix.connect(dry); dry.connect(out);
      mix.connect(verb); verb.connect(wet); wet.connect(out);

      var pad = ctx.createBiquadFilter();
      pad.type = 'lowpass'; pad.frequency.value = 1250; pad.Q.value = 0.4;
      pad.connect(mix);
      var lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05;
      var depth = ctx.createGain(); depth.gain.value = 320;
      lfo.connect(depth); depth.connect(pad.frequency);
      lfo.start(t);

      var low = ctx.createBiquadFilter();
      low.type = 'lowpass'; low.frequency.value = 520;
      low.connect(out);

      this.bus = { out: out, mix: mix, pad: pad, low: low, lfo: lfo };
    },

    impulse: function (ctx) {
      if (this.ir && this.ir.sampleRate === ctx.sampleRate) return this.ir;
      var len = Math.floor(ctx.sampleRate * 2.6);
      var buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      this.ir = buf;
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
      var bus = this.bus;
      var chord = CHORDS[PHRASES[Math.floor(n / 4) % PHRASES.length][n % 4]];
      this.pad(ctx, bus, t, BAR, chord.pad);
      this.bass(ctx, bus, t, chord.bass, 0.12);
      this.bass(ctx, bus, t + 2 * BEAT, chord.bass + (n % 2 ? 7 : 0), 0.08);
      if (Math.random() < 0.3) this.bass(ctx, bus, t + 3.5 * BEAT, chord.bass + 12, 0.045);

      // A sparse steel-pan line. Leave whole bars empty now and then.
      if (n < 2 || n % 8 === 7 || Math.random() < 0.18) return;
      for (var i = 0; i < 8; i++) {
        var chance = i === 0 ? 0.55 : (i % 2 ? 0.2 : 0.34);
        if (Math.random() > chance) continue;
        var step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
        this.note = Math.max(0, Math.min(SCALE.length - 1, this.note + step));
        var lilt = i % 2 ? BEAT * 0.09 : 0;
        this.pan(ctx, bus, t + i * BEAT / 2 + lilt, SCALE[this.note], 0.05 + Math.random() * 0.03);
      }
      if (n % 4 === 3 && Math.random() < 0.45) {
        // a soft roll on the last beat of the phrase, the way pan players hold a note
        var m = SCALE[this.note];
        for (var r = 0; r < 5; r++) this.pan(ctx, bus, t + 3 * BEAT + r * 0.08, m, 0.032 - r * 0.005);
      }
    },

    pan: function (ctx, bus, t, midi, vel) {
      var f = mtof(midi);
      // fundamental, octave and a slightly stretched twelfth: a mellow pan tone
      [[1, 1, 1.5], [2, 0.42, 0.85], [3.01, 0.13, 0.45], [4.2, 0.05, 0.22]].forEach(function (p) {
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * p[0] * 1.01, t);
        o.frequency.exponentialRampToValueAtTime(f * p[0], t + 0.04);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vel * p[1], t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + p[2]);
        o.connect(g); g.connect(bus.mix);
        o.start(t); o.stop(t + p[2] + 0.05);
      });
    },

    pad: function (ctx, bus, t, dur, notes) {
      notes.forEach(function (m) {
        var f = mtof(m);
        [['triangle', -6, 0.011], ['sine', 6, 0.009]].forEach(function (v) {
          var o = ctx.createOscillator();
          o.type = v[0];
          o.frequency.value = f;
          o.detune.value = v[1];
          var g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(v[2], t + 1.1);
          g.gain.setValueAtTime(v[2], t + dur - 0.3);
          g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
          o.connect(g); g.connect(bus.pad);
          o.start(t); o.stop(t + dur + 1.6);
        });
      });
    },

    bass: function (ctx, bus, t, midi, vel) {
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(midi);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vel, t + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g); g.connect(bus.low);
      o.start(t); o.stop(t + 1.25);
    }
  };
})(window.CT);
