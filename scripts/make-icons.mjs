// Generuje ikony PWA, favicon i splash screeny iOS oraz wstrzykuje <link rel="apple-touch-startup-image">
// do index.html (między znacznikami splash:start / splash:end).
// Uruchom: node scripts/make-icons.mjs
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/** Własny znak: kalendarz z kolorowymi kropkami osób na gradiencie (bez zasobów Apple). */
const mark = (size, { bg = true, scale = 1 } = {}) => {
  const s = size;
  const k = scale;
  const card = { x: s * (0.5 - 0.3 * k), y: s * (0.5 - 0.29 * k), w: s * 0.6 * k, h: s * 0.58 * k };
  const dot = s * 0.052 * k;
  const colors = ['#FF3B30', '#34C759', '#FF9500', '#AF52DE', '#007AFF', '#FF2D55', '#30B0C7', '#FFCC00'];
  const dots = [];
  const cols = 4;
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = card.x + card.w * (0.17 + (0.66 / (cols - 1)) * c);
      const cy = card.y + card.h * (0.5 + (0.38 / (rows - 1)) * (r - 0.0)) - card.h * 0.04;
      dots.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dot.toFixed(1)}" fill="${colors[(r * cols + c) % colors.length]}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4DA3FF"/>
      <stop offset="1" stop-color="#5E5CE6"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="${(s * 0.012).toFixed(1)}" stdDeviation="${(s * 0.02).toFixed(1)}" flood-color="#1b1b6b" flood-opacity="0.35"/>
    </filter>
  </defs>
  ${bg ? `<rect width="${s}" height="${s}" fill="url(#g)"/>` : ''}
  <g filter="url(#sh)">
    <rect x="${card.x.toFixed(1)}" y="${card.y.toFixed(1)}" width="${card.w.toFixed(1)}" height="${card.h.toFixed(1)}" rx="${(s * 0.08 * k).toFixed(1)}" fill="#fff"/>
    <path d="M${card.x.toFixed(1)} ${(card.y + card.h * 0.27).toFixed(1)}h${card.w.toFixed(1)}v${(-card.h * 0.27 + s * 0.08 * k).toFixed(1)}a${(s * 0.08 * k).toFixed(1)} ${(s * 0.08 * k).toFixed(1)} 0 0 0 ${(-s * 0.08 * k).toFixed(1)} ${(-s * 0.08 * k).toFixed(1)}h${(-(card.w - s * 0.16 * k)).toFixed(1)}a${(s * 0.08 * k).toFixed(1)} ${(s * 0.08 * k).toFixed(1)} 0 0 0 ${(-s * 0.08 * k).toFixed(1)} ${(s * 0.08 * k).toFixed(1)}z" fill="#FF3B30"/>
  </g>
  <g fill="#fff"><rect x="${(card.x + card.w * 0.24).toFixed(1)}" y="${(card.y - s * 0.035 * k).toFixed(1)}" width="${(s * 0.03 * k).toFixed(1)}" height="${(s * 0.08 * k).toFixed(1)}" rx="${(s * 0.015 * k).toFixed(1)}"/><rect x="${(card.x + card.w * 0.7).toFixed(1)}" y="${(card.y - s * 0.035 * k).toFixed(1)}" width="${(s * 0.03 * k).toFixed(1)}" height="${(s * 0.08 * k).toFixed(1)}" rx="${(s * 0.015 * k).toFixed(1)}"/></g>
  ${dots.join('\n  ')}
</svg>`;
};

await mkdir('public/icons', { recursive: true });
await mkdir('public/splash', { recursive: true });

const png = (svg, out) => sharp(Buffer.from(svg)).png().toFile(out);
await png(mark(192), 'public/icons/icon-192.png');
await png(mark(512), 'public/icons/icon-512.png');
await png(mark(180), 'public/icons/apple-touch-icon.png'); // pełne tło, bez przezroczystości
await png(mark(512, { scale: 0.74 }), 'public/icons/maskable-512.png'); // treść w bezpiecznej strefie ~80%
await png(mark(32), 'public/icons/favicon-32.png');
await png(mark(16), 'public/icons/favicon-16.png');
await writeFile('public/icons/icon.svg', mark(512));

/* -------------------------------------------------------------- splash iOS */
// portretowo: szerokość × wysokość w CSS px, DPR 3 — iPhone 12 … 17
const devices = [
  [375, 812, 'iPhone 12/13 mini'],
  [390, 844, 'iPhone 12/13/14, 12/13 Pro'],
  [393, 852, 'iPhone 14 Pro, 15, 15 Pro, 16'],
  [402, 874, 'iPhone 16 Pro, 17, 17 Pro'],
  [420, 912, 'iPhone Air'],
  [428, 926, 'iPhone 12/13 Pro Max, 14 Plus'],
  [430, 932, 'iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus'],
  [440, 956, 'iPhone 16 Pro Max, 17 Pro Max'],
];
const links = [];
for (const [w, h, name] of devices) {
  const pw = w * 3;
  const ph = h * 3;
  const logo = Math.round(pw * 0.26);
  const markPng = await sharp(Buffer.from(mark(logo))).png().toBuffer();
  const rounded = await sharp(markPng)
    .composite([
      {
        input: Buffer.from(`<svg width="${logo}" height="${logo}"><rect width="${logo}" height="${logo}" rx="${Math.round(logo * 0.225)}"/></svg>`),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();
  for (const scheme of ['light', 'dark']) {
    const bg = scheme === 'light' ? '#f2f2f7' : '#000000';
    const file = `splash/${pw}x${ph}-${scheme}.png`;
    await sharp({ create: { width: pw, height: ph, channels: 3, background: bg } })
      .composite([{ input: rounded, left: Math.round((pw - logo) / 2), top: Math.round((ph - logo) / 2 - ph * 0.03) }])
      .png({ compressionLevel: 9 })
      .toFile(`public/${file}`);
    links.push(
      `    <!-- ${name} -->\n    <link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: ${scheme})" href="/${file}" />`,
    );
  }
}

let html = await readFile('index.html', 'utf8');
const block = `    <!-- splash:start (generowane przez scripts/make-icons.mjs) -->\n${links.join('\n')}\n    <!-- splash:end -->`;
if (html.includes('<!-- splash:start')) {
  html = html.replace(/ {4}<!-- splash:start[\s\S]*?<!-- splash:end -->/, block);
} else {
  html = html.replace('    <title>Grafik</title>', `${block}\n    <title>Grafik</title>`);
}
await writeFile('index.html', html);
console.log(`ikony i ${links.length} splash screenów gotowe`);
