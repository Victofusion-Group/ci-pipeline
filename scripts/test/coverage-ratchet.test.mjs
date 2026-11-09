import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateCoverage } from '../coverage-ratchet.mjs';

const REPO = join(process.cwd(), 'fake-repo');
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
// Istanbul writes absolute file keys; fixtures hold relative ones.
const absolute = (data) => Object.fromEntries(
  Object.entries(data).map(([k, v]) => [k === 'total' ? k : join(REPO, k), v]));
const sum = (name, root = '.') => ({ root, data: absolute(fixture(name)) });
const totalOnly = (total, covered) => ({ root: '.', data: { total: { lines: { total, covered, pct: (covered / total) * 100 } } } });
const run = (summaries, extra = {}) => evaluateCoverage({ summaries, floor: 62, criticalGlobs: [], criticalEnforced: false, repoRoot: REPO, ...extra });

test('below floor is FAIL', () => {
  const [r] = run([totalOnly(10000, 5824)]);
  assert.deepEqual(r, { stage: 'Coverage', status: 'FAIL', detail: "58.2% of lines are tested, below this project's floor of 62%." });
});

test('at floor is PASS', () => {
  const [r] = run([totalOnly(1000, 624)]);
  assert.deepEqual(r, { stage: 'Coverage', status: 'PASS', detail: '62.4% of lines are tested (floor 62%).' });
});

test('two points above suggests raising', () => {
  const [r] = run([totalOnly(100, 66)]);
  assert.equal(r.status, 'PASS');
  assert.ok(r.detail.endsWith(' Raise the floor to 66.'), r.detail);
});

test('skips absent files and merges the rest', () => {
  const [r] = run([sum('coverage-web.json'), sum('coverage-api.json'), null].filter(Boolean), { floor: 60 });
  assert.ok(r.detail.startsWith('72.5% of lines'), r.detail);
});

test('no coverage files is MISSING', () => {
  assert.deepEqual(run([]), [{ stage: 'Coverage', status: 'MISSING', detail: 'No coverage file found. Add the json-summary coverage reporter.' }]);
});

const crit = { criticalGlobs: ['src/pay/**', 'src/auth/**'] };

test('critical below 100 not enforced is WARN', () => {
  const r = run([sum('coverage-web.json')], crit).find((x) => x.stage === 'Critical-path coverage');
  // charge 40/40 + login 10/20 = 50/60 = 83.3
  assert.equal(r.status, 'WARN');
  assert.equal(r.detail, '83.3% of money, login and permission code is tested. Target is 100%.');
});

test('critical below 100 enforced is FAIL', () => {
  const r = run([sum('coverage-web.json')], { ...crit, criticalEnforced: true }).find((x) => x.stage === 'Critical-path coverage');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.detail, '83.3% of money, login and permission code is tested. Target is 100%. Below 100: src/auth/login.js.');
});

test('critical below 100 lists at most 5 paths', () => {
  const data = { total: { lines: { total: 70, covered: 0, pct: 0 } } };
  for (let i = 0; i < 7; i++) data[join(REPO, `src/pay/f${i}.js`)] = { lines: { total: 10, covered: 0, pct: 0 } };
  const r = run([{ root: '.', data }], { ...crit, criticalEnforced: true }).find((x) => x.stage === 'Critical-path coverage');
  assert.equal(r.detail.split('Below 100: ')[1].split(', ').length, 5);
});

test('critical at 100 not yet enforced is PASS', () => {
  const r = run([sum('coverage-full.json')], crit).find((x) => x.stage === 'Critical-path coverage');
  assert.deepEqual(r, { stage: 'Critical-path coverage', status: 'PASS', detail: '100% of money, login and permission code is tested. Set critical_enforced: true.' });
});

test('critical at 100 and enforced is PASS', () => {
  const r = run([sum('coverage-full.json')], { ...crit, criticalEnforced: true }).find((x) => x.stage === 'Critical-path coverage');
  assert.equal(r.status, 'PASS');
  assert.equal(r.detail, '100% of money, login and permission code is tested.');
});

test('no file matches critical globs is WARN', () => {
  const r = run([sum('coverage-web.json')], { criticalGlobs: ['nothing/**'] }).find((x) => x.stage === 'Critical-path coverage');
  assert.deepEqual(r, { stage: 'Critical-path coverage', status: 'WARN', detail: 'No files match the critical-path list. Check the globs in ci.yml.' });
});

test('no critical globs gives no critical record', () => {
  assert.equal(run([sum('coverage-web.json')]).length, 1);
});

test('windows-style backslash keys still match', () => {
  const key = REPO.split('/').join("\\") + "\\src\\pay\\x.js";
  const data = { total: { lines: { total: 10, covered: 10, pct: 100 } }, [key]: { lines: { total: 10, covered: 10, pct: 100 } } };
  const r = run([{ root: '.', data }], crit).find((x) => x.stage === 'Critical-path coverage');
  assert.equal(r.status, 'PASS');
});

test('a floor that is not a number is FAIL, never PASS', () => {
  for (const floor of [NaN, undefined, '', true, '62']) {
    const [r] = run([totalOnly(100, 90)], { floor });
    assert.deepEqual(r, { stage: 'Coverage', status: 'FAIL', detail: 'No coverage floor set in ci.yml.' }, String(floor));
  }
});

test('a coverage file with no measured lines is MISSING', () => {
  const [r] = run([totalOnly(0, 0)]);
  assert.deepEqual(r, { stage: 'Coverage', status: 'MISSING', detail: 'Coverage file has no measured lines.' });
});

test('critical files that all have no measured lines are MISSING', () => {
  const data = { total: { lines: { total: 10, covered: 10, pct: 100 } }, [join(REPO, 'src/pay/types.js')]: { lines: { total: 0, covered: 0, pct: 100 } } };
  const r = run([{ root: '.', data }], crit).find((x) => x.stage === 'Critical-path coverage');
  assert.deepEqual(r, { stage: 'Critical-path coverage', status: 'MISSING', detail: 'Files on the critical-path list have no measured lines.' });
});

test('CLI: empty, missing or non-numeric --floor fails', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { readResults } = await import('../lib/results.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'cov-'));
  writeFileSync(join(dir, 'cov.json'), JSON.stringify({ total: { lines: { total: 100, covered: 90, pct: 90 } } }));
  const cli = new URL('../coverage-ratchet.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const variants = [['--floor', ''], [], ['--floor', 'abc']];
  for (const [i, extra] of variants.entries()) {
    const results = join(dir, `r${i}.jsonl`);
    spawnSync(process.execPath, [cli, '--cwd', dir, '--files', 'cov.json', ...extra, '--results', results]);
    const [r] = readResults(results);
    assert.equal(r.status, 'FAIL', JSON.stringify(extra));
    assert.equal(r.detail, 'No coverage floor set in ci.yml.');
  }
});
