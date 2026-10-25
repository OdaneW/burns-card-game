/* Builds the game from the modular sources.
     docs/            the installable app, served by GitHub Pages
                      (index.html, manifest, offline service worker, icons, fonts)
     dist/burns.html  a single-file copy for the preview link in Claude
   Load order matters: engine → modes (rules, bots) → UI kit → mode tables → app shell.
   To add a game mode, add its rules/bot/ui files to SOURCES.
   No dependencies: node build.js */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SOURCES = [
  'src/engine/core.js',
  'src/engine/session.js',
  'src/modes/burns/rules.js',
  'src/modes/burns/bot.js',
  'src/ui/kit.js',
  'src/ui/music.js',
  'src/ui/coach.js',
  'src/modes/burns/ui.js',
  'src/modes/burns/tutorial.js',
  'src/ui/app.js'
];
const FONTS = [
  { family: 'Bungee', file: 'bungee-latin-400-normal.woff2', weight: '400' },
  { family: 'Young Serif', file: 'young-serif-latin-400-normal.woff2', weight: '400' },
  { family: 'Bricolage Grotesque', file: 'bricolage-grotesque-latin-wght-normal.woff2', weight: '200 800', variable: true }
];
const ICONS = ['icon.svg', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'];
const APP = {
  name: 'Burns Card Game',
  shortName: 'Burns',
  description: 'Follow the suit, draw when you can’t, and be first to empty your hand. A card game with more modes on the way.',
  color: '#0F3E3C'
};

const p = f => path.join(ROOT, f);
const read = f => fs.readFileSync(p(f), 'utf8');
const pkg = JSON.parse(read('package.json'));

const css = read('src/ui/styles.css');
const body = read('src/shell/body.html');
const js = SOURCES.map(f => '/* ---- ' + f + ' ---- */\n' + read(f)).join('\n');

// A build id that changes whenever anything shipped changes; shown in the app's menu.
const hash = crypto.createHash('sha256').update(pkg.version).update(css).update(body).update(js);
FONTS.forEach(f => hash.update(fs.readFileSync(p('src/assets/fonts/' + f.file))));
ICONS.forEach(f => hash.update(fs.readFileSync(p('src/assets/icons/' + f))));
const buildId = hash.digest('hex').slice(0, 7);
const scriptFor = target => 'window.CT = window.CT || {};\nCT.BUILD = ' +
  JSON.stringify({ version: pkg.version, id: buildId, target: target }) + ';\n' + js;

/* ---------- dist/burns.html: preview in Claude (the host adds <head>) ---------- */
const preview = `<title>${APP.name}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="${APP.color}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Bungee&family=Young+Serif&display=swap">
<style>
${css}
</style>

${body.replace('<!--__EXTRA_BODY__-->', '')}
<script>
${scriptFor('preview')}
</script>
`;
fs.mkdirSync(p('dist'), { recursive: true });
fs.writeFileSync(p('dist/burns.html'), preview);

/* ---------- docs/: the installable app ---------- */
const fontFaces = FONTS.map(f => `@font-face { font-family: '${f.family}'; font-style: normal; font-weight: ${f.weight}; font-display: swap; src: url(fonts/${f.file}) format('${f.variable ? 'woff2-variations' : 'woff2'}'), url(fonts/${f.file}) format('woff2'); }`).join('\n');
const reset = `:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; }
img { max-width: 100%; }
[hidden] { display: none !important; }`;
const updateBar = `<div class="update-bar" id="update-bar" role="status" hidden>
  <span>A new version is ready.</span>
  <button class="btn btn-primary" type="button" id="update-now">Update</button>
  <button class="update-later" type="button" id="update-later" aria-label="Not now">Later</button>
</div>`;
const swRegister = `(function () {
  // Offline support and updates. Each new build ships a new sw.js; when it has
  // downloaded, offer a restart. The current game is saved first, so it can be resumed.
  if (!('serviceWorker' in navigator)) return;
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  var updating = false;
  function offer(worker) {
    var bar = document.getElementById('update-bar');
    if (!bar) return;
    bar.hidden = false;
    document.getElementById('update-now').onclick = function () {
      updating = true;
      this.disabled = true;
      try { if (window.CT && CT.App) CT.App.save(); } catch (e) {}
      worker.postMessage('skipWaiting');
    };
    document.getElementById('update-later').onclick = function () { bar.hidden = true; };
  }
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (updating) location.reload();
  });
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) reg.update().catch(function () {});
      });
    }).catch(function () {});
  });
})();`;

const site = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${APP.name}</title>
<meta name="description" content="${APP.description}">
<meta name="theme-color" content="${APP.color}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="icon" href="icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
${FONTS.map(f => `<link rel="preload" href="fonts/${f.file}" as="font" type="font/woff2" crossorigin>`).join('\n')}
<style>
${fontFaces}
${reset}
${css}
</style>
</head>
<body>
${body.replace('<!--__EXTRA_BODY__-->', updateBar)}
<script>
${scriptFor('app')}
</script>
<script>
${swRegister}
</script>
</body>
</html>
`;

const manifest = {
  id: './',
  name: APP.name,
  short_name: APP.shortName,
  description: APP.description,
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: APP.color,
  theme_color: APP.color,
  categories: ['games'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
};

const precache = ['./', 'index.html', 'manifest.webmanifest']
  .concat(ICONS.map(f => 'icons/' + f))
  .concat(FONTS.map(f => 'fonts/' + f.file));

const sw = `/* Burns service worker: keeps the app working offline and installs new versions.
   Generated by build.js — edit build.js, not this file. */
var VERSION = '${pkg.version}-${buildId}';
var CACHE = 'burns-' + VERSION;
var FILES = ${JSON.stringify(precache)};

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('burns-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (event) {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then(function (hit) { return hit || fetch(req); }));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); }));
});
`;

const out = p('docs');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), site);
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'sw.js'), sw);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
ICONS.forEach(f => fs.copyFileSync(p('src/assets/icons/' + f), path.join(out, 'icons', f)));
FONTS.forEach(f => fs.copyFileSync(p('src/assets/fonts/' + f.file), path.join(out, 'fonts', f.file)));
fs.readdirSync(p('src/assets/fonts')).filter(f => f.startsWith('LICENSE')).forEach(f =>
  fs.copyFileSync(p('src/assets/fonts/' + f), path.join(out, 'fonts', f)));

console.log('Burns ' + pkg.version + ' (build ' + buildId + ')');
console.log('  docs/index.html   ' + (site.length / 1024).toFixed(1) + ' KB  (installable app)');
console.log('  dist/burns.html   ' + (preview.length / 1024).toFixed(1) + ' KB  (preview in Claude)');
