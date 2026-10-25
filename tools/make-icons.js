/* Draws the app icon and renders the PNG sizes the installable app needs.
   Run once after changing the design: node tools/make-icons.js
   (needs Playwright with Chromium; the build only copies the results). */
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'src', 'assets', 'icons');

function iconSvg({ rx, scale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="36%" r="82%">
      <stop offset="0" stop-color="#1B5E58"/>
      <stop offset="1" stop-color="#0A2C2B"/>
    </radialGradient>
    <pattern id="lat" width="19" height="19" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="19" height="19" fill="#F4B942"/>
      <rect width="4" height="19" fill="#0E3230"/>
      <rect width="19" height="4" fill="#0E3230"/>
    </pattern>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="11" flood-color="#021413" flood-opacity=".55"/>
    </filter>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="${rx}" fill="url(#bg)"/>
  <g transform="translate(256 262) scale(${scale})">
    <g transform="translate(-60 8) rotate(-14)" filter="url(#sh)">
      <rect x="-86" y="-120" width="172" height="240" rx="20" fill="#FBF7EC"/>
      <rect x="-74" y="-108" width="148" height="216" rx="11" fill="url(#lat)"/>
    </g>
    <g transform="translate(60 -6) rotate(10)">
      <rect x="-86" y="-120" width="172" height="240" rx="20" fill="#F0643C" opacity=".55" filter="url(#glow)"/>
      <g filter="url(#sh)">
        <rect x="-86" y="-120" width="172" height="240" rx="20" fill="#FBF7EC"/>
      </g>
      <rect x="-75" y="-109" width="150" height="218" rx="12" fill="none" stroke="#F0643C" stroke-width="4" opacity=".5"/>
      <g transform="translate(-50 -72)">
        <path fill="#F0643C" d="M50 4C57 25 84 41 84 79 84 111 68 134 50 134 31 134 16 112 16 86 16 63 28 51 36 39 37 55 42 63 50 65 45 44 43 22 50 4Z"/>
        <path fill="#F4B942" d="M53 70C59 82 70 91 70 106 70 120 62 128 52 128 41 128 34 119 34 108 34 98 40 92 44 86 45 94 48 98 53 99 50 89 49 79 53 70Z"/>
      </g>
    </g>
  </g>
</svg>`;
}

(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const rounded = iconSvg({ rx: 112, scale: 1 });
  fs.writeFileSync(path.join(OUT, 'icon.svg'), rounded);
  const jobs = [
    { file: 'icon-192.png', size: 192, svg: rounded },
    { file: 'icon-512.png', size: 512, svg: rounded },
    { file: 'maskable-512.png', size: 512, svg: iconSvg({ rx: 0, scale: 0.9 }) },
    { file: 'apple-touch-icon.png', size: 180, svg: iconSvg({ rx: 0, scale: 0.9 }) },
    { file: 'favicon-32.png', size: 32, svg: rounded }
  ];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const j of jobs) {
    await page.setViewportSize({ width: j.size, height: j.size });
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>' + j.svg);
    await page.screenshot({ path: path.join(OUT, j.file), omitBackground: true });
    console.log('wrote', j.file);
  }
  await browser.close();
  // Shrink the PNGs with a colour palette when sharp is installed (optional).
  let sharp = null;
  try { sharp = require('sharp'); } catch (e) { /* skip */ }
  if (sharp) {
    for (const j of jobs) {
      const file = path.join(OUT, j.file);
      const buf = await sharp(file).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
      if (buf.length < fs.statSync(file).size) fs.writeFileSync(file, buf);
    }
    console.log('compressed icons');
  }
})().catch(e => { console.error(e); process.exit(1); });
