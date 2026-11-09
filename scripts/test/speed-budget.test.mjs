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
