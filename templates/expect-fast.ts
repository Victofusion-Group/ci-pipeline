import { appendFileSync } from 'node:fs';

/**
 * Times one user action (a button press, a page save) and returns the milliseconds.
 * When SPEED_TIMINGS_FILE is set, adds one JSON line the nightly speed check reads.
 * The limits live in the shared checker, not here.
 */
export async function expectFast(label: string, action: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await action();
  const ms = Math.round(performance.now() - start);
  const file = process.env.SPEED_TIMINGS_FILE;
  if (file) appendFileSync(file, JSON.stringify({ label, ms }) + '\n');
  return ms;
}
