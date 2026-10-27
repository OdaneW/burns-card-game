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
          anchor: fn → element|null (optional: the bubble goes beside this
            instead, e.g. the whole table when the spotlight is on a seat),
          place: 'auto' | 'top' | 'center', dim: true|false,
          actions: [{ id, label, primary, cls, onClick }] } */
  Coach.prototype.show = function (o) {
    // a message about the last step shouldn't sit over the new note
    if (UI.toastHide) UI.toastHide();
    this.el.hidden = false;
    this.stepEl.textContent = o.step || '';
    this.titleEl.textContent = o.title || '';
    this.titleEl.hidden = !o.title;
    this.textEl.innerHTML = o.text || '';
    this.getTarget = o.target || null;
    this.getAnchor = o.anchor || null;
    this.where = o.place || 'auto';
    this.useDim = o.dim !== false;
    this.spot.classList.toggle('plain', !this.useDim);
    this.bubble.classList.remove('enter');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('enter');
    this.setActions(o.actions);
    this.loop();
  };

  /* Swap the buttons without re-showing the bubble (e.g. add Next to a note
     the table has already caught up with). */
  Coach.prototype.setActions = function (actions) {
    actions = actions || [];
    this.actionsEl.innerHTML = '';
    actions.forEach(function (a) {
      if (a.br) { var br = document.createElement('span'); br.className = 'coach-break'; this.actionsEl.appendChild(br); return; }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-plain') + (a.cls ? ' ' + a.cls : '');
      if (a.id) b.dataset.act = a.id;
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      this.actionsEl.appendChild(b);
    }, this);
    this.actionsEl.hidden = !actions.length;
    var primary = this.actionsEl.querySelector('.btn-primary');
    if (primary) try { primary.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
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

    // Told to keep clear of something (the table, on a phone on its side)?
    // Then sit beside it, a little narrower if that's what fits.
    var a = this.getAnchor ? this.getAnchor() : null;
    var ar = a && a.getBoundingClientRect ? a.getBoundingClientRect() : null;
    if (ar && ar.width && ar.height && this.where !== 'center') {
      if (this.maxW == null) this.maxW = parseFloat(getComputedStyle(this.bubble).maxWidth) || 380;
      var full = Math.min(this.maxW, vw - 24);
      var roomL = ar.left - gap - 12, roomR = vw - 12 - (ar.right + gap);
      if (Math.max(roomL, roomR) >= Math.min(full, 260)) {
        var w = Math.min(full, Math.max(roomL, roomR));
        var side = this.bubble.style;
        side.left = (roomL > roomR ? ar.left - gap - w : ar.right + gap) + 'px';
        side.right = 'auto'; side.width = w + 'px'; side.marginLeft = side.marginRight = '0';
        side.top = Math.max(12, Math.min(vh - bh - 12, ar.top + ar.height / 2 - bh / 2)) + 'px';
        this.arrow.className = 'coach-arrow';
        return;
      }
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

    // Still on top of what it points at (a wide screen, or a phone on its
    // side)? Then move beside it, if there's room, so nothing it asks you to
    // tap is covered.
    var left = null;
    if (r && this.where !== 'center') {
      var L = r.left - pad, R = r.right + pad, T = r.top - pad, B = r.bottom + pad;
      if (top < B && top + bh > T && bl < R && bl + bw > L) {
        var toLeft = L - gap - bw, toRight = R + gap;
        var okLeft = toLeft >= 12, okRight = toRight + bw <= vw - 12;
        if (okLeft || okRight) {
          left = okLeft && (!okRight || L > vw - R) ? toLeft : toRight;
          if (this.where !== 'top') top = Math.max(12, Math.min(vh - bh - 12, r.top + r.height / 2 - bh / 2));
          arrowAt = null;
        }
      }
    }
    var bs = this.bubble.style;
    if (left == null) bs.left = bs.right = bs.width = bs.marginLeft = bs.marginRight = '';
    else { bs.left = left + 'px'; bs.right = 'auto'; bs.width = bw + 'px'; bs.marginLeft = bs.marginRight = '0'; }
    this.bubble.style.top = top + 'px';
    if (r) this.arrow.style.left = Math.max(18, Math.min(bw - 32, r.left + r.width / 2 - bl - 7)) + 'px';
    this.arrow.className = 'coach-arrow' + (arrowAt === 'bottom-far' ? ' bottom' : arrowAt ? ' ' + arrowAt : '');
  };

  UI.Coach = Coach;
})(window.CT);
