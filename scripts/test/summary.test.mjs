import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummary, hasFailure } from '../summary.mjs';

const recs = [
  { stage: 'Unit tests', status: 'PASS', detail: 'Passed' },
  { stage: 'Lint', status: 'FAIL', detail: 'Failed' },
  { stage: 'Types', status: 'PASS', detail: 'Passed' },
  { stage: 'E2E', status: 'MISSING', detail: 'No "e2e" script in package.json' },
];

test('table has one row per stage in order', () => {
  const out = renderSummary('CI', recs);
  assert.ok(out.includes('| Check | Result | What it means |'));
  const rows = [
    '| Unit tests | ✅ PASS | Passed |',
    '| Lint | ❌ FAIL | Failed |',
    '| Types | ✅ PASS | Passed |',
    '| E2E | 🟡 MISSING | No "e2e" script in package.json |',
  ];
  let last = -1;
  for (const row of rows) {
    const i = out.indexOf(row);
    assert.ok(i > last, `row out of order or missing: ${row}`);
    last = i;
  }
  assert.ok(renderSummary('CI', [{ stage: 'S', status: 'WARN', detail: 'd' }]).includes('| S | ⚠️ WARN | d |'));
});

test('headline counts', () => {
  const lines = renderSummary('CI', recs).split('\n');
  assert.equal(lines[0], '## CI');
  assert.equal(lines.find((l) => l.startsWith('**')), '**2 passed, 1 failed, 1 missing, 0 warnings**');
  const one = renderSummary('CI', [{ stage: 'S', status: 'WARN', detail: 'd' }]);
  assert.ok(one.includes('**0 passed, 0 failed, 0 missing, 1 warning**'));
});

test('empty results', () => {
  const out = renderSummary('CI', []);
  assert.ok(out.includes('No checks ran. Something stopped the job before the first check. Open the log.'));
  assert.equal(hasFailure([]), true);
});

test('pipe in detail is escaped', () => {
  const row = renderSummary('CI', [{ stage: 'S', status: 'PASS', detail: 'a|b' }]).split(String.fromCharCode(10)).find((l) => l.startsWith('| S '));
  assert.ok(row.includes('a\\|b'), row);
  // Split on unescaped pipes only: leading and trailing give two empty parts, plus 3 cells.
  assert.equal(row.split(/(?<!\\)\|/).length, 5);
});

test('hasFailure', () => {
  assert.equal(hasFailure(recs), true);
  assert.equal(hasFailure([recs[0], recs[3]]), false);
});
