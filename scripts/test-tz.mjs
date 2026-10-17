// Testy jednostkowe w kilku strefach czasowych (audyt 16.2: daty poprawne niezależnie od TZ).
import { spawnSync } from 'node:child_process';

const zones = ['Europe/Warsaw', 'America/New_York', 'Pacific/Auckland'];
let failed = false;
for (const TZ of zones) {
  console.log(`\n=== TZ=${TZ} ===`);
  const r = spawnSync('npx', ['vitest', 'run'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, TZ },
  });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
