import { chromium, webkit, devices } from '@playwright/test';
const targets = [['iphone-12', webkit, devices['iPhone 12']], ['pixel-7', chromium, devices['Pixel 7']]];
for (const [name, type, dev] of targets) {
  const b = await type.launch();
  for (const scheme of ['light', 'dark']) {
    const c = await b.newContext({ ...dev, colorScheme: scheme });
    const p = await c.newPage();
    await p.goto('http://localhost:4173/'); await p.getByRole('heading', { name: 'Grafik' }).waitFor();
    await p.screenshot({ path: `docs/screens/faza1/${name}-${scheme}.png` });
    await c.close();
  }
  await b.close();
}
