// Generuje placeholderowe ikony PWA (faza 9 zastąpi je finalnymi).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const svg = (size, pad) => {
  const r = size * 0.5;
  const inner = size - pad * 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#007aff"/>
  <g transform="translate(${pad} ${pad}) scale(${inner / 100})" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round">
    <rect x="18" y="22" width="64" height="58" rx="10"/>
    <path d="M18 40h64M36 14v14M64 14v14"/>
    <path d="M32 56h10M46 56h10M60 56h10M32 68h10M46 68h10" stroke-width="5"/>
  </g>
  <title>${r}</title>
</svg>`);
};

await mkdir('public/icons', { recursive: true });
const jobs = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0], // bez przezroczystości
  ['maskable-512.png', 512, 80], // treść w bezpiecznej strefie 80%
];
for (const [name, size, pad] of jobs) {
  await sharp(svg(size, pad)).png().toFile(`public/icons/${name}`);
}
console.log('ikony gotowe');
