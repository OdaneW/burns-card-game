/* ==========================================================================
   GAME MODE · STRIP-ME — computer player
   There's nothing to choose but when: nobody knows what's in their deck. It
   turns its cards over briskly (rounds are long), a little quicker while
   paying up, and now and then shuffles for luck, mostly when it owes three
   or four cards or the pile it might take is big.
   ========================================================================== */
(function (CT) {
  'use strict';
  var StripMe = CT.getMode('stripme');

  var bot = {
    intent: function (v) {
      if (!v.canPlay) return null;
      return { kind: 'play', key: 'P' + v.round + ':' + v.plays + ':' + v.owe + ':' + (v.canShuffle ? 1 : 0) };
    },

    delay: function (intent, v, rnd) {
      return (v.owe ? 360 : 460) + rnd() * 360;
    },

    decide: function (v, memory, rnd) {
      if (!v.canPlay) return null;
      if (v.canShuffle) {
        var odds = v.owe >= 3 ? 0.3 : (v.owe && v.pileCount >= 12) ? 0.25 : 0.03;
        if (rnd() < odds) return { type: 'shuffle', payload: {} };
      }
      return { type: 'play', payload: {} };
    }
  };

  StripMe.bot = bot;
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
