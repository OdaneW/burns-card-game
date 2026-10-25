/* ==========================================================================
   COACH — the tutorial's speech bubble and spotlight, usable by any mode.
   It sits above the table without blocking it: only the bubble takes taps,
   so the player uses the real cards and deck while it explains.
   ========================================================================== */
(function (CT) {
  'use strict';
  var UI = CT.UI;

  function Coach() {
    var el = this.el = document.createElement('div');
    el.className = 'coach';
    el.hidden = true;
    el.innerHTML =
      '<div class="coach-dim"></div>' +
      '<div class="coach-spot"></div>' +
      '<div class="coach-bubble" role="dialog" aria-live="polite" aria-label="Tutorial">' +
        '<span class="coach-arrow" aria-hidden="true"></span>' +
        '<div class="coach-top"><span class="coach-step"></span>' +
        '<button type="button" class="coach-skip">Leave tutorial</button></div>' +
        '<p class="coach-title"></p>' +
        '<p class="coach-text"></p>' +
        '<div class="coach-actions"></div>' +
      '</div>';
    document.body.appendChild(el);
    this.dim = el.querySelector('.coach-dim');
    this.spot = el.querySelector('.coach-spot');
    this.bubble = el.querySelector('.coach-bubble');
    this.arrow = el.querySelector('.coach-arrow');
    this.stepEl = el.querySelector('.coach-step');
    this.titleEl = el.querySelector('.coach-title');
    this.textEl = el.querySelector('.coach-text');
    this.actionsEl = el.querySelector('.coach-actions');
    this.getTarget = null;
    this.raf = null;
    this.onSkip = null;
    var self = this;
    el.querySelector('.coach-skip').addEventListener('click', function () { if (self.onSkip) self.onSkip(); });
  }

  /* o: { step, title, text (HTML), target: fn → element|null,
          place: 'auto' | 'top' | 'center', dim: true|false,
          actions: [{ label, primary, onClick }] } */
  Coach.prototype.show = function (o) {
    this.el.hidden = false;
    this.stepEl.textContent = o.step || '';
    this.titleEl.textContent = o.title || '';
    this.titleEl.hidden = !o.title;
    this.textEl.innerHTML = o.text || '';
    this.actionsEl.innerHTML = '';
    var actions = o.actions || [];
    actions.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-plain');
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      this.actionsEl.appendChild(b);
    }, this);
    this.actionsEl.hidden = !actions.length;
    this.getTarget = o.target || null;
    this.where = o.place || 'auto';
    this.useDim = o.dim !== false;
    this.spot.classList.toggle('plain', !this.useDim);
    this.bubble.classList.remove('enter');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('enter');
    var primary = this.actionsEl.querySelector('.btn-primary');
    if (primary) try { primary.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    this.loop();
  };

  Coach.prototype.setText = function (html) {
    if (this.textEl.innerHTML !== html) this.textEl.innerHTML = html;
  };

  Coach.prototype.hide = function () {
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
    this.raf = null;
  };

  /* Follow the target every frame: cards move as the hand re-lays out. */
  Coach.prototype.loop = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    var frame = function () {
      if (self.el.hidden) return;
      self.place();
      self.raf = requestAnimationFrame(frame);
    };
    frame();
  };

  Coach.prototype.place = function () {
    var t = this.getTarget ? this.getTarget() : null;
    var r = t && t.getBoundingClientRect ? t.getBoundingClientRect() : null;
    if (r && !(r.width && r.height)) r = null;
    var vw = window.innerWidth, vh = window.innerHeight;
    var bh = this.bubble.offsetHeight;
    var bw = this.bubble.offsetWidth;
    var bl = (vw - bw) / 2;
    var gap = 14, pad = 8, top, arrowAt = null;

    this.dim.style.opacity = !r && this.useDim ? '1' : '0';
    this.spot.style.display = r ? 'block' : 'none';
    if (r) {
      this.spot.style.left = (r.left - pad) + 'px';
      this.spot.style.top = (r.top - pad) + 'px';
      this.spot.style.width = (r.width + pad * 2) + 'px';
      this.spot.style.height = (r.height + pad * 2) + 'px';
    }

    if (this.where === 'top') {
      // out of the way of the hand, the deck and the Play button
      top = 12;
      if (r && r.top - pad > top + bh + 6) arrowAt = 'bottom-far';
    } else if (this.where === 'center' || !r) {
      top = (vh - bh) * 0.42;
    } else {
      var below = vh - (r.bottom + pad);
      var above = r.top - pad;
      if (below >= bh + gap + 12) { top = r.bottom + pad + gap; arrowAt = 'top'; }
      else if (above >= bh + gap + 12) { top = r.top - pad - gap - bh; arrowAt = 'bottom'; }
      else top = below > above ? vh - bh - 12 : 12;
    }
    top = Math.max(12, Math.min(vh - bh - 12, top));
    this.bubble.style.top = top + 'px';
    if (r) this.arrow.style.left = Math.max(18, Math.min(bw - 32, r.left + r.width / 2 - bl - 7)) + 'px';
    this.arrow.className = 'coach-arrow' + (arrowAt === 'bottom-far' ? ' bottom' : arrowAt ? ' ' + arrowAt : '');
  };

  UI.Coach = Coach;
})(window.CT);
