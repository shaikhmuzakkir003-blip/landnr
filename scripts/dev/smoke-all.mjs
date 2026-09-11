/**
 * smoke-all.mjs — run the smoke test across every viewport the site cares about.
 *
 * Each scenario needs a fresh module registry (the engine's modules are
 * singletons), so every one runs in its own child process.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = resolve(HERE, 'smoke.mjs');
const scenarios = ['desktop', 'wide', 'narrow', 'tablet', 'mobile', 'touch', 'reduced', 'remote'];

let failed = 0;
const summary = [];

for (const scenario of scenarios) {
  const result = spawnSync(process.execPath, [SMOKE, `--scenario=${scenario}`], {
    encoding: 'utf8',
    timeout: 240_000,
  });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  const problemMatch = out.match(/✗ (\d+) problem/);
  const problems = problemMatch ? Number(problemMatch[1]) : 0;
  const ok = result.status === 0;
  if (!ok) failed++;

  const grab = (label) => {
    const m = new RegExp(`${label}\\s+(\\S+)`).exec(out);
    return m ? m[1] : '–';
  };

  summary.push({
    scenario,
    ok: ok ? '✓' : '✗',
    lines: grab('split \\.line'),
    chars: grab('split \\.char'),
    reveals: grab('reveal done'),
    pins: grab('horizontalPins'),
    theme: grab('nav theme'),
    problems: problems || (ok ? 0 : '?'),
  });

  if (!ok) {
    console.log(`\n──── ${scenario} FAILED ────`);
    console.log(out.split('\n').slice(-40).join('\n'));
  }
}

console.log('\nscenario   ok  lines  chars  reveals  pins  theme    problems');
for (const row of summary) {
  console.log(
    `${row.scenario.padEnd(10)} ${row.ok}   ${String(row.lines).padStart(5)}  ${String(row.chars).padStart(5)}`
    + `  ${String(row.reveals).padStart(7)}  ${String(row.pins).padStart(4)}  ${String(row.theme).padEnd(8)} ${row.problems}`,
  );
}

console.log(failed ? `\n✗ ${failed}/${scenarios.length} scenario(s) failed` : `\n✓ all ${scenarios.length} scenarios clean`);
process.exit(failed ? 1 : 0);
