import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUDGETS, median, evaluatePages, evaluateTimings } from '../speed-budget.mjs';

// A minimal Lighthouse result with only the fields the checker reads.
function lhr({ url = 'https://example.com/', final, bytes = 800000, lcp = 1600, cls = 0.01, tbt = 90, runtimeError } = {}) {
  const audits = {};
  if (bytes !== null) audits['total-byte-weight'] = { numericValue: bytes };
  audits['largest-contentful-paint'] = { numericValue: lcp };
  audits['cumulative-layout-shift'] = { numericValue: cls };
  audits['total-blocking-time'] = { numericValue: tbt };
  const out = { requestedUrl: url, finalDisplayedUrl: final ?? url, audits };
  if (runtimeError) out.runtimeError = runtimeError;
  return out;
}

test('budgets are the agreed numbers', () => {
  assert.deepEqual(BUDGETS.weightBytes, { warn: 1_000_000, fail: 2_000_000 });
  assert.deepEqual(BUDGETS.lcpMs, { warn: 2000, fail: 2500 });
  assert.deepEqual(BUDGETS.cls, { warn: 0.05, fail: 0.1 });
  assert.deepEqual(BUDGETS.tbtMs, { warn: 200, fail: 300 });
});

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('all within budget is PASS', () => {
  const [r] = evaluatePages([lhr(), lhr(), lhr()]);
  assert.deepEqual(r, { stage: 'Speed: /', status: 'PASS', detail: '0.8 MB, main content 1.6 s, layout shift 0.01, frozen 90 ms' });
});

test('median of three decides', () => {
  const [r] = evaluatePages([lhr({ lcp: 1900 }), lhr({ lcp: 3400 }), lhr({ lcp: 2100 })]);
  assert.equal(r.status, 'WARN');
  assert.ok(r.detail.includes('main content 2.1 s'), r.detail);
});

test('over fail budget is FAIL and names only the problems', () => {
  const [r] = evaluatePages([lhr({ bytes: 2400000, lcp: 3100 })]);
  assert.equal(r.status, 'FAIL');
  assert.equal(r.detail, '2.4 MB sent (limit 2 MB); main content 3.1 s (limit 2.5 s)');
});

test('exactly on a limit is not over it', () => {
  const [r] = evaluatePages([lhr({ bytes: 2000000, lcp: 2500, cls: 0.1, tbt: 300 })]);
  assert.equal(r.status, 'WARN');
});

// A value just over a limit must never print as the limit itself: when it would
// round to the limit, one more decimal place is shown, rounded up.
test('just over each page limit never reads as the limit', () => {
  const [r] = evaluatePages([lhr({ bytes: 2_000_001, lcp: 2501, cls: 0.1004, tbt: 300.4 })]);
  assert.equal(r.status, 'FAIL');
  assert.equal(r.detail, '2.01 MB sent (limit 2 MB); main content 2.51 s (limit 2.5 s); layout shift 0.101 (limit 0.1); frozen 300.4 ms (limit 300 ms)');
});

test('just over each warning level never reads as the level', () => {
  const [r] = evaluatePages([lhr({ bytes: 1_000_001, lcp: 2001, cls: 0.0504, tbt: 200.2 })]);
  assert.equal(r.status, 'WARN');
  assert.equal(r.detail, '1.01 MB sent (aim under 1 MB); main content 2.01 s (aim under 2 s); layout shift 0.051 (aim under 0.05); frozen 200.2 ms (aim under 200 ms)');
});

test('a clear miss keeps the short form', () => {
  const [r] = evaluatePages([lhr({ bytes: 2_100_000, lcp: 2600, cls: 0.2, tbt: 301 })]);
  assert.equal(r.detail, '2.1 MB sent (limit 2 MB); main content 2.6 s (limit 2.5 s); layout shift 0.20 (limit 0.1); frozen 301 ms (limit 300 ms)');
});

test('a light page shows its weight in KB', () => {
  const [r] = evaluatePages([lhr({ bytes: 85_400 })]);
  assert.ok(r.detail.startsWith('85 KB, '), r.detail);
  const [r2] = evaluatePages([lhr({ bytes: 100_000 })]);
  assert.ok(r2.detail.startsWith('0.1 MB, '), r2.detail);
});

test('just over the action limits never reads as the limit', () => {
  const rs = evaluateTimings([{ label: 'Save', ms: 3001 }, { label: 'Open', ms: 1040 }, { label: 'Pay', ms: 3000 }]);
  assert.deepEqual(rs.map((r) => [r.status, r.detail]), [
    ['FAIL', 'Took 3.01 s (limit 3 s)'],
    ['WARN', 'Took 1.04 s (aim under 1 s)'],
    ['WARN', 'Took 3 s (aim under 1 s)'],
  ]);
});

test('runtimeError is FAIL', () => {
  const [r] = evaluatePages([lhr({ runtimeError: { message: 'DNS lookup failed' } })]);
  assert.deepEqual([r.status, r.detail], ['FAIL', 'Page could not be measured: DNS lookup failed']);
});

test('missing metric is FAIL', () => {
  const [r] = evaluatePages([lhr({ bytes: null })]);
  assert.deepEqual([r.status, r.detail], ['FAIL', 'Page could not be measured: page weight missing']);
});

test('redirect to a different path is WARN', () => {
  const [r] = evaluatePages([lhr({ url: 'https://example.com/dashboard', final: 'https://example.com/login' })]);
  assert.equal(r.stage, 'Speed: /dashboard');
  assert.equal(r.status, 'WARN');
  assert.ok(r.detail.startsWith('Measured /login instead (redirected). '), r.detail);
});

test('redirect that also breaks budget is FAIL', () => {
  const [r] = evaluatePages([lhr({ url: 'https://example.com/dashboard', final: 'https://example.com/login', lcp: 4000 })]);
  assert.equal(r.status, 'FAIL');
  assert.ok(r.detail.startsWith('Measured /login instead (redirected). '));
});

test('groups by requested url, one record per page', () => {
  const rs = evaluatePages([lhr({ url: 'https://example.com/a' }), lhr({ url: 'https://example.com/b' }), lhr({ url: 'https://example.com/a' })]);
  assert.deepEqual(rs.map((r) => r.stage), ['Speed: /a', 'Speed: /b']);
});

test('stage name uses the full url when hosts differ', () => {
  const rs = evaluatePages([lhr({ url: 'https://a.example.com/' }), lhr({ url: 'https://b.example.com/' })]);
  assert.deepEqual(rs.map((r) => r.stage), ['Speed: https://a.example.com/', 'Speed: https://b.example.com/']);
});

test('falls back to finalUrl', () => {
  const l = lhr({ url: 'https://example.com/a' });
  delete l.finalDisplayedUrl;
  l.finalUrl = 'https://example.com/b';
  assert.ok(evaluatePages([l])[0].detail.startsWith('Measured /b instead'));
});

test('timings', () => {
  const rs = evaluateTimings([{ label: 'Save', ms: 3400 }, { label: 'Open', ms: 1300 }, { label: 'Tap', ms: 400 }], { warnOnly: false });
  assert.deepEqual(rs, [
    { stage: 'Action: Save', status: 'FAIL', detail: 'Took 3.4 s (limit 3 s)' },
    { stage: 'Action: Open', status: 'WARN', detail: 'Took 1.3 s (aim under 1 s)' },
    { stage: 'Action: Tap', status: 'PASS', detail: 'Took 0.4 s' },
  ]);
});

test('with warnOnly over 3 s is WARN', () => {
  const [r] = evaluateTimings([{ label: 'Save', ms: 3400 }], { warnOnly: true });
  assert.deepEqual([r.status, r.detail], ['WARN', 'Took 3.4 s (limit 3 s)']);
});

test('an expected page with no Lighthouse result is FAIL', () => {
  const rs = evaluatePages([lhr({ url: 'https://example.com/a' })], { expected: ['https://example.com/a', 'https://example.com/down'] });
  assert.deepEqual(rs.map((r) => [r.stage, r.status]), [['Speed: /a', 'PASS'], ['Speed: /down', 'FAIL']]);
  assert.equal(rs[1].detail, 'Page could not be measured: no Lighthouse result');
});

test('expected urls match Lighthouse requested urls after normalising', () => {
  const rs = evaluatePages([lhr({ url: 'https://example.com/' })], { expected: ['https://example.com'] });
  assert.deepEqual(rs.map((r) => [r.stage, r.status]), [['Speed: /', 'PASS']]);
});

test('every expected page unmeasured gives one FAIL each', () => {
  const rs = evaluatePages([], { expected: ['https://example.com/', 'https://example.com/b'] });
  assert.deepEqual(rs.map((r) => [r.stage, r.status]), [['Speed: /', 'FAIL'], ['Speed: /b', 'FAIL']]);
});

async function cli(args) {
  const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'speed-'));
  const results = join(dir, 'results.jsonl');
  const script = fileURLToPath(new URL('../speed-budget.mjs', import.meta.url));
  execFileSync(process.execPath, [script, '--results', results, ...args(dir)]);
  return existsSync(results) ? readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
}

const NO_TIMINGS = { stage: 'Button speed', status: 'MISSING', detail: 'No button timings were recorded. Wrap key actions in expectFast.' };

test('cli: an absent timings file is MISSING, not silence', async () => {
  const rows = await cli((dir) => ['--timings', `${dir}/timings.jsonl`]);
  assert.deepEqual(rows, [NO_TIMINGS]);
});

test('cli: an empty timings file is MISSING', async () => {
  const { writeFileSync } = await import('node:fs');
  const rows = await cli((dir) => { writeFileSync(`${dir}/timings.jsonl`, '\n  \n'); return ['--timings', `${dir}/timings.jsonl`]; });
  assert.deepEqual(rows, [NO_TIMINGS]);
});

test('cli: recorded timings give one row each', async () => {
  const { writeFileSync } = await import('node:fs');
  const rows = await cli((dir) => {
    writeFileSync(`${dir}/timings.jsonl`, JSON.stringify({ label: 'Save', ms: 400 }) + '\n');
    return ['--timings', `${dir}/timings.jsonl`];
  });
  assert.deepEqual(rows, [{ stage: 'Action: Save', status: 'PASS', detail: 'Took 0.4 s' }]);
});

test('cli: --only-if-script skips everything when the script is absent', async () => {
  const { writeFileSync } = await import('node:fs');
  const rows = await cli((dir) => {
    writeFileSync(`${dir}/package.json`, JSON.stringify({ scripts: { test: 'x' } }));
    return ['--timings', `${dir}/timings.jsonl`, '--only-if-script', 'test:e2e', '--cwd', dir];
  });
  assert.deepEqual(rows, []);
});

test('cli: --only-if-script runs when the script is present', async () => {
  const { writeFileSync } = await import('node:fs');
  const rows = await cli((dir) => {
    writeFileSync(`${dir}/package.json`, JSON.stringify({ scripts: { 'test:e2e': 'x' } }));
    return ['--timings', `${dir}/timings.jsonl`, '--only-if-script', 'test:e2e', '--cwd', dir];
  });
  assert.deepEqual(rows, [NO_TIMINGS]);
});

test('cli: a page with no result shows as FAIL, not silence', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'speed-'));
  const lhrDir = join(dir, '.lighthouseci');
  mkdirSync(lhrDir);
  writeFileSync(join(lhrDir, 'lhr-1.json'), JSON.stringify(lhr({ url: 'https://example.com/' })));
  const results = join(dir, 'results.jsonl');
  const script = fileURLToPath(new URL('../speed-budget.mjs', import.meta.url));
  execFileSync(process.execPath, [script, '--results', results, '--lhr-dir', lhrDir, '--urls', 'https://example.com/\r\n\n  https://down.example.com/  \n']);
  const rows = readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.stage, r.status]), [
    ['Speed: https://example.com/', 'PASS'],
    ['Speed: https://down.example.com/', 'FAIL'],
  ]);
});
