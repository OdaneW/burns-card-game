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
     playLabel             → the last note's button, e.g. 'Play Burns'
   })

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

  UI.makeTutorial = function (spec) {
    var LESSONS = spec.lessons;
    var TOP = spec.topTargets || /^(card:|hand)/;

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

    Tutorial.prototype.start = function () {
      var self = this;
      this.coach.onSkip = function () { self.exit(); };
      this.index = 0;
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
        if (this.index >= LESSONS.length) { this.exit(); return; }
        this.begin();
        return;
      }
      var byLesson = this.snaps[this.index] || (this.snaps[this.index] = []);
      byLesson[this.step] = { state: JSON.stringify(this.session.state), t: this.session.now() };
      this.enter();
    };

    /* Previous: back to the step before, with the table exactly as it was
       when that step began, so it can be read again and played again. */
    Tutorial.prototype.canGoBack = function () { return this.index > 0 || this.step > 0; };

    Tutorial.prototype.prevStep = function () {
      var index = this.index, step = this.step - 1;
      if (step < 0) { index--; step = index >= 0 ? LESSONS[index].steps.length - 1 : -1; }
      var snap = index >= 0 ? (this.snaps[index] || [])[step] : null;
      if (!snap) return;
      clearTimeout(this.timer);
      this.index = index;
      this.step = step;
      this.use(new CT.Session({ mode: spec.modeFor(LESSONS[index]), state: JSON.parse(snap.state), clock: new CT.Clock(snap.t) }));
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
        // the two ways out share a row; Previous sits underneath
        actions = [
          { id: 'home', label: 'Back to games', onClick: function () { self.exit(); } },
          { id: 'play', label: spec.playLabel || 'Play', primary: true, onClick: function () { self.exit('setup'); } },
          { br: true }, this.prevButton()
        ];
      }
      var target = typeof s.target === 'function' ? s.target(ctx) : s.target;
      var read = !!(s.next || s.final);
      // Reading: dim the table. Doing: keep the hand and the buttons clear.
      var place = s.place || (!target ? (read ? 'center' : 'top') : (TOP.test(target) ? 'top' : 'auto'));
      this.shownAt = now();
      this.coach.show({
        step: 'Lesson ' + (this.index + 1) + ' of ' + LESSONS.length + ' · ' + lesson.title,
        title: s.title,
        text: typeof s.text === 'function' ? s.text(ctx) : s.text,
        target: targetFn(target),
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
