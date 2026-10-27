/* ==========================================================================
   TUTORIALS — the lesson runner every mode's interactive tutorial uses.
   A mode supplies its lessons (hand-arranged deals with steps), how to set a
   lesson up on the real table, and where things are on its screen. This
   runs the steps: the coach bubble, waiting for the player, holding the
   table while a note is read, and Previous, which rewinds the table to how
   it was when that step began. Nothing here is saved or counted in stats.

   UI.makeTutorial({
     modeId, lessons,
     makeSession(lesson)   → a session ready at the start of the lesson
     modeFor(lesson)       → the mode (with scripted computer players) for a rewound session
     target(key)           → the element a step points at, or null
     topTargets            → RegExp of keys near the bottom of the screen; the bubble goes up top
     anchor(key)           → optional: an element the bubble should sit beside, not on (or null)
     playLabel             → the last note's button, e.g. 'Play Burns'
   })

   A lesson: { title, steps, …whatever the mode's makeSession needs }. One
   marked extra: true (an optional rule, say) comes after the main lessons:
   it isn't counted, and it's offered on the last note (offer: its button)
   and on How to play, which can start it on its own (start(index)).

   A step: { title?, text (string or fn(ctx)), target? (key or fn(ctx)),
     next: true (a note to read) | final: true (the last note) |
     done(ctx) (waits for something to happen at the table), after (ms),
     watch: true (the computer players are doing it, so hold for reading),
     place?, dim? }
   ctx = { v: the player's view, me: their seat, events: since the step began }
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;

  // A watch note that reads in this long or less just stays up a little
  // longer; anything longer waits for Next.
  var SHORT_NOTE_MS = 5500;

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* Several elements as one spotlight (an element's stand-in for the coach). */
  UI.around = function (els) {
    els = els.filter(Boolean);
    if (!els.length) return null;
    return {
      getBoundingClientRect: function () {
        var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        els.forEach(function (el) {
          var x = el.getBoundingClientRect();
          if (!x.width || !x.height) return;
          l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom);
        });
        if (l === Infinity) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
      }
    };
  };

  UI.makeTutorial = function (spec) {
    var LESSONS = spec.lessons;
    var TOP = spec.topTargets || /^(card:|hand)/;
    var CORE = LESSONS.filter(function (l) { return !l.extra; }).length;
    var EXTRAS = [];
    LESSONS.forEach(function (l, i) {
      if (l.extra) EXTRAS.push({ index: i, title: l.title, offer: l.offer || 'Learn ' + l.title, shortcut: l.shortcut || 'Just the ' + l.title + ' lesson' });
    });

    function targetFn(key) {
      if (!key) return null;
      return function () { return spec.target(key); };
    }

    function Tutorial(app) {
      this.app = app;
      this.modeId = spec.modeId;
      this.coach = UI.coach || (UI.coach = new UI.Coach());
      this.holding = false;
      this.index = 0;
      this.step = -1;
      this.snaps = [];   // per lesson, per step: the table as that step began
    }

    Tutorial.prototype.lessons = LESSONS;
    Tutorial.prototype.core = CORE;        // the main lessons, as counted on screen
    Tutorial.prototype.extras = EXTRAS;    // [{ index, title, offer, shortcut }]

    /* From the first lesson, or straight into one (an extra lesson from How to play). */
    Tutorial.prototype.start = function (at) {
      var self = this;
      this.coach.onSkip = function () { self.exit(); };
      this.index = at > 0 && at < LESSONS.length ? at : 0;
      this.begin();
    };

    Tutorial.prototype.goTo = function (index) {
      clearTimeout(this.timer);
      this.index = index;
      this.begin();
    };

    /* Put a session on the table and follow it. */
    Tutorial.prototype.use = function (session) {
      if (this.unsub) this.unsub();
      this.session = session;
      session.pause();
      this.app.attachTutorial(session);
      var self = this;
      this.unsub = session.on(function () { self.check(); });
    };

    Tutorial.prototype.begin = function () {
      this.use(spec.makeSession(LESSONS[this.index]));
      this.step = -1;
      this.nextStep();
    };

    Tutorial.prototype.ctx = function () {
      var v = this.session.view('p0', { sinceSeq: this.stepSeq || 0 });
      var me = v.players.filter(function (p) { return p.id === 'p0'; })[0];
      return { v: v, me: me, events: v.events || [] };
    };

    Tutorial.prototype.current = function () { return LESSONS[this.index].steps[this.step]; };

    Tutorial.prototype.nextStep = function () {
      clearTimeout(this.timer);
      this.step++;
      var lesson = LESSONS[this.index];
      if (this.step >= lesson.steps.length) {
        this.index++;
        // extra lessons are only ever chosen, never run into
        if (this.index >= LESSONS.length || LESSONS[this.index].extra) { this.exit(); return; }
        this.begin();
        return;
      }
      var byLesson = this.snaps[this.index] || (this.snaps[this.index] = []);
      byLesson[this.step] = { state: JSON.stringify(this.session.state), t: this.session.now() };
      this.enter();
    };

    /* Previous: back to the step before, with the table exactly as it was
       when that step began, so it can be read again and played again. */
    /* The step before, if it was played here (a lesson started on its own has nothing before it). */
    Tutorial.prototype.before = function () {
      var index = this.index, step = this.step - 1;
      if (step < 0) { index--; step = index >= 0 ? LESSONS[index].steps.length - 1 : -1; }
      var snap = index >= 0 ? (this.snaps[index] || [])[step] : null;
      return snap ? { index: index, step: step, snap: snap } : null;
    };

    Tutorial.prototype.canGoBack = function () { return !!this.before(); };

    Tutorial.prototype.prevStep = function () {
      var b = this.before();
      if (!b) return;
      clearTimeout(this.timer);
      this.index = b.index;
      this.step = b.step;
      this.use(new CT.Session({ mode: spec.modeFor(LESSONS[b.index]), state: JSON.parse(b.snap.state), clock: new CT.Clock(b.snap.t) }));
      this.enter();
    };

    /* Show the current step and set the table going (or keep it waiting). */
    Tutorial.prototype.enter = function () {
      var s = this.current();
      this.stepSeq = this.session.state.seq;
      this.advancing = false;
      var read = !!(s.next || s.final);
      this.holding = read;            // the table waits while you read
      if (read) this.session.pause(); else this.app.resumePlay();
      this.render();
      if (!read) this.check();
    };

    Tutorial.prototype.prevButton = function () {
      var self = this;
      return { id: 'prev', label: 'Previous', cls: 'coach-prev', onClick: function () { self.prevStep(); } };
    };

    /* Previous (when there's somewhere to go back to), then the way forward. */
    Tutorial.prototype.buttons = function (rest) {
      return (this.canGoBack() ? [this.prevButton()] : []).concat(rest || []);
    };

    Tutorial.prototype.render = function () {
      var self = this, s = this.current(), ctx = this.ctx();
      var lesson = LESSONS[this.index];
      var next = { id: 'next', label: 'Next', primary: true, onClick: function () { self.nextStep(); } };
      var actions = this.buttons(s.next ? [next] : []);
      if (s.final) {
        // the two ways out share a row; Previous sits underneath, with any extra lesson on offer
        actions = [
          { id: 'home', label: 'Back to games', onClick: function () { self.exit(); } },
          { id: 'play', label: spec.playLabel || 'Play', primary: true, onClick: function () { self.exit('setup'); } },
          { br: true }
        ];
        if (this.canGoBack()) actions.push(this.prevButton());
        if (!lesson.extra) EXTRAS.forEach(function (x) {
          actions.push({ id: 'extra', label: x.offer, cls: 'coach-extra', onClick: function () { self.goTo(x.index); } });
        });
      }
      var target = typeof s.target === 'function' ? s.target(ctx) : s.target;
      var read = !!(s.next || s.final);
      // Reading: dim the table. Doing: keep the hand and the buttons clear.
      var place = s.place || (!target ? (read ? 'center' : 'top') : (TOP.test(target) ? 'top' : 'auto'));
      this.shownAt = now();
      this.coach.show({
        step: (lesson.extra ? 'Extra lesson' : 'Lesson ' + (this.index + 1) + ' of ' + CORE) + ' · ' + lesson.title,
        title: s.title,
        text: typeof s.text === 'function' ? s.text(ctx) : s.text,
        target: targetFn(target),
        anchor: spec.anchor && target ? function () { return spec.anchor(target); } : null,
        place: place,
        dim: s.dim != null ? s.dim : (target ? true : read),
        actions: actions
      });
    };

    /* Roughly how long the note on screen takes to read, at an unhurried pace. */
    Tutorial.prototype.readingTime = function () {
      return 1500 + 60 * (this.coach.textEl.textContent || '').length;
    };

    /* After every change at the table: has the player done what this step
       asks? A step the player completes moves on right away: they've read
       it. A "watch" note explains what the computer players are doing, and
       the table can get there before the reader does, so then the table
       waits: a short note stays up until it has had time to be read, and a
       longer one gets a Next button. */
    Tutorial.prototype.check = function () {
      var s = this.current();
      if (!s || s.next || s.final || this.advancing) return;
      var ctx = this.ctx();
      if (typeof s.text === 'function') this.coach.setText(s.text(ctx));
      if (!s.done(ctx)) return;
      this.advancing = true;
      var self = this, after = s.after != null ? s.after : 400;
      var owed = this.readingTime() - (now() - this.shownAt);
      if (!s.watch || owed <= after) {
        this.timer = setTimeout(function () { self.nextStep(); }, after);
        return;
      }
      this.holding = true;
      this.session.pause();
      if (this.readingTime() <= SHORT_NOTE_MS) this.timer = setTimeout(function () { self.nextStep(); }, owed + 50);
      else this.coach.setActions(this.buttons([{ id: 'next', label: 'Next', primary: true, onClick: function () { self.nextStep(); } }]));
    };

    Tutorial.prototype.exit = function (to) {
      clearTimeout(this.timer);
      if (this.unsub) this.unsub();
      this.unsub = null;
      this.holding = false;
      this.coach.hide();
      this.app.endTutorial(to, spec.modeId);
    };

    return Tutorial;
  };

  UI.tutorials = UI.tutorials || {};
})(window.CT);
