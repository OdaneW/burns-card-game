/* ==========================================================================
   STANDINGS · each phone's record of its own games, and the leaderboard
   For each game a phone keeps: games played and won, the current and best
   winning streaks, and what that game counts for the player (its
   mode.stats.show list: sets won, fours of a kind, bluffs caught, …), added
   up game after game, or only the best kept (the fastest put-down). Online
   games are kept again on their own, under `online`.

   The friends screen ranks you and your friends from these records, by
   wins, win rate, games, best streak, or anything the game ranks by.
   Nothing here touches the page, so the tests use it as it is.
   ========================================================================== */
(function (CT) {
  'use strict';
  var MIN_GAMES = 5;   // a win rate counts from this many games

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* One finished game into a record: { played, won, streak, bestStreak, …the game's counts }. */
  function addGame(rec, won, tally, mode) {
    rec.played = (rec.played || 0) + 1;
    rec.won = (rec.won || 0) + (won ? 1 : 0);
    rec.streak = won ? (rec.streak || 0) + 1 : 0;
    rec.bestStreak = Math.max(num(rec.bestStreak) || 0, rec.streak);
    var show = (mode && mode.stats && mode.stats.show) || [];
    show.forEach(function (x) {
      if (x.rate) return;                     // worked out from two counts when shown
      var n = num(tally ? tally[x.key] : null);
      if (n == null) return;
      if (x.best === 'min') { if (num(rec[x.key]) == null || n < rec[x.key]) rec[x.key] = n; }
      else if (x.best === 'max') { if (num(rec[x.key]) == null || n > rec[x.key]) rec[x.key] = n; }
      else rec[x.key] = (rec[x.key] || 0) + n;
    });
    return rec;
  }

  /* A finished game into everything the phone keeps (all: { modeId: record }). */
  function record(all, mode, won, tally, online, now) {
    var rec = all[mode.id] || (all[mode.id] = {});
    addGame(rec, won, tally, mode);
    if (online) addGame(rec.online || (rec.online = {}), won, tally, mode);
    rec.last = now;
    return rec;
  }

  /* One player's record for a game ('all': every game added together), online games only or not. */
  function recordFor(all, modeId, online) {
    all = all || {};
    if (modeId !== 'all') {
      var rec = all[modeId] || {};
      return (online ? rec.online : rec) || {};
    }
    var sum = { played: 0, won: 0, bestStreak: 0 };
    CT.listModes().forEach(function (m) {
      var r = all[m.id];
      r = r && (online ? r.online : r);
      if (!r) return;
      sum.played += num(r.played) || 0;
      sum.won += num(r.won) || 0;
      sum.bestStreak = Math.max(sum.bestStreak, num(r.bestStreak) || 0);
    });
    return sum;
  }

  var fmt = {
    count: function (n) { return String(Math.round(n)); },
    pct: function (n) { return Math.round(n * 100) + '%'; },
    ms: function (n) { return (n / 1000).toFixed(2) + ' s'; }
  };

  /* What a leaderboard ranks by, for one game or for 'all':
     { id, label, help, get(rec) → number or null (can't count it yet), fmt(n), low (smaller is better), need(rec) }. */
  function metrics(modeId) {
    var games = function (r) { return num(r.played) || 0; };
    var list = [
      { id: 'won', label: 'Wins', help: 'Games won. A shared win counts for everyone who shared it.',
        get: function (r) { return games(r) ? num(r.won) || 0 : null; } },
      { id: 'rate', label: 'Win %', help: 'Wins out of games played, once someone has played ' + MIN_GAMES + ' games.', pct: true,
        get: function (r) { return games(r) >= MIN_GAMES ? (num(r.won) || 0) / games(r) : null; },
        need: function (r) { return 'Win % after ' + MIN_GAMES + ' games · ' + games(r) + ' so far'; } },
      { id: 'played', label: 'Games', help: 'Games played to the end.', get: function (r) { return games(r) || null; } },
      { id: 'bestStreak', label: 'Best streak', help: modeId === 'all' ? 'The most wins in a row, in any one game.' : 'The most wins in a row.',
        get: function (r) { return games(r) ? num(r.bestStreak) || 0 : null; } }
    ];
    var mode = modeId === 'all' ? null : CT.getMode(modeId);
    ((mode && mode.stats && mode.stats.show) || []).forEach(function (x) {
      if (!x.rank) return;
      list.push(statMetric(x, mode));
    });
    list.forEach(function (m) { if (!m.fmt) m.fmt = m.pct ? fmt.pct : fmt.count; });
    return list;
  }

  function labelOf(mode, key) {
    var x = mode.stats.show.filter(function (y) { return y.key === key; })[0];
    return x ? x.label.toLowerCase() : key;
  }

  /* A count a game keeps, as something to rank by or show. */
  function statMetric(x, mode) {
    var m = { id: x.key, label: x.label, help: x.help || x.label, low: !!x.low, note: x.note || '' };
    if (x.rate) {
      var top = x.rate[0], bottom = x.rate[1], min = x.min || 1;
      m.pct = true;
      m.get = function (r) { var d = num(r[bottom]) || 0; return d >= min ? (num(r[top]) || 0) / d : null; };
      m.need = function (r) { return 'Counts from ' + min + ' ' + labelOf(mode, bottom) + ' · ' + (num(r[bottom]) || 0) + ' so far'; };
      m.sub = function (r) { return (num(r[top]) || 0) + ' of ' + plural(num(r[bottom]) || 0, labelOf(mode, bottom).replace(/s$/, '')); };
    } else if (x.best) {
      m.get = function (r) { return num(r[x.key]); };
      m.need = function () { return 'None yet'; };
      if (x.unit === 'ms') m.fmt = fmt.ms;
    } else {
      m.get = function (r) { return (num(r.played) || 0) ? num(r[x.key]) || 0 : null; };
    }
    return m;
  }

  /* Every line of the side-by-side comparison for a game: what it ranks by, then the rest. */
  function details(modeId) {
    var list = metrics(modeId);
    list.splice(3, 0, { id: 'streak', label: 'Current streak', help: 'Wins in a row right now.', fmt: fmt.count,
      get: function (r) { return (num(r.played) || 0) ? num(r.streak) || 0 : null; } });
    list.forEach(function (m) { if (m.id === 'played') m.neutral = true; });   // more games isn't better
    if (modeId === 'all') {
      CT.listModes().forEach(function (mode) {
        list.push({ id: 'wins-' + mode.id, label: (mode.shortName || mode.name) + ' wins', help: 'Games of ' + mode.name + ' won.', fmt: fmt.count,
          get: function (r, all, online) {      // (this one needs the whole record)
            var rec = recordFor(all, mode.id, online);
            return num(rec.played) ? num(rec.won) || 0 : null;
          } });
      });
      return list;
    }
    var mode = CT.getMode(modeId);
    ((mode && mode.stats && mode.stats.show) || []).forEach(function (x) {
      if (x.rank) return;
      var m = statMetric(x, mode);
      if (!m.fmt) m.fmt = m.pct ? fmt.pct : fmt.count;
      if (!x.low) m.neutral = true;     // more isn't better or worse (Bull calls)
      list.push(m);
    });
    return list;
  }

  /* The leaderboard: people [{ name, me?, stats }] ranked for one game and metric, best first.
     → [{ person, rec, value, rank }]; rank is null for anyone it can't count yet (they go last).
     Equal values share a rank. */
  function standings(people, modeId, metricId, online) {
    var list = metrics(modeId);
    var metric = list.filter(function (m) { return m.id === metricId; })[0] || list[0];
    var rows = people.map(function (p) {
      var rec = recordFor(p.stats, modeId, online);
      return { person: p, rec: rec, value: metric.get(rec) };
    });
    rows.sort(function (a, b) {
      var an = a.value == null, bn = b.value == null;
      if (an !== bn) return an ? 1 : -1;
      if (!an && a.value !== b.value) return metric.low ? a.value - b.value : b.value - a.value;
      var ga = num(a.rec.played) || 0, gb = num(b.rec.played) || 0;
      if (ga !== gb) return gb - ga;
      if (!!a.person.me !== !!b.person.me) return a.person.me ? -1 : 1;
      return String(a.person.name).localeCompare(String(b.person.name));
    });
    var rank = 0, last = null;
    rows.forEach(function (r, i) {
      if (r.value == null) { r.rank = null; return; }
      if (last === null || r.value !== last) { rank = i + 1; last = r.value; }
      r.rank = rank;
    });
    return { metric: metric, rows: rows };
  }

  /* Under a name on the leaderboard: how many games, and what's missing if it can't be ranked yet. */
  function summary(rec, metric, value, online) {
    var games = num(rec.played) || 0;
    if (!games) return online ? 'No online games yet' : 'No games yet';
    if (value == null && metric.need) return metric.need(rec);
    if (metric.sub) return metric.sub(rec);
    return plural(games, 'game') + ' · ' + plural(num(rec.won) || 0, 'win');
  }

  CT.Standings = {
    MIN_GAMES: MIN_GAMES,
    addGame: addGame,
    record: record,
    recordFor: recordFor,
    metrics: metrics,
    details: details,
    standings: standings,
    summary: summary,
    fmt: fmt
  };
})(typeof globalThis !== 'undefined' ? (globalThis.CT = globalThis.CT || {}) : (window.CT = window.CT || {}));
