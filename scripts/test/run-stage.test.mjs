import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStage } from '../run-stage.mjs';
import { appendResult, readResults } from '../lib/results.mjs';

function project(scripts) {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  return dir;
}
const fakeExec = (code, calls = []) => async (cmd) => { calls.push(cmd); return { code }; };

test('existing script that exits 0 is PASS', async () => {
  const cwd = project({ test: 'x' });
  const calls = [];
  const r = await runStage({ stage: 'Unit tests', script: 'test', pm: 'pnpm', cwd, required: false, exec: fakeExec(0, calls) });
  assert.deepEqual(r, { stage: 'Unit tests', status: 'PASS', detail: 'Passed' });
  assert.deepEqual(calls, ['pnpm run test']);
  const calls2 = [];
  await runStage({ stage: 'Unit tests', script: 'test', pm: 'npm', cwd, required: false, exec: fakeExec(0, calls2) });
  assert.deepEqual(calls2, ['npm run test']);
});

test('existing script that exits 2 is FAIL', async () => {
  const r = await runStage({ stage: 'Unit tests', script: 'test', pm: 'npm', cwd: project({ test: 'x' }), required: false, exec: fakeExec(2) });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.detail, 'Failed (exit code 2). Open the log for this step to see which test.');
});

test('missing script is MISSING', async () => {
  const r = await runStage({ stage: 'Lint', script: 'lint', pm: 'npm', cwd: project({}), required: false, exec: fakeExec(0) });
  assert.equal(r.status, 'MISSING');
  assert.equal(r.detail, 'No "lint" script in package.json');
});

test('required missing script is FAIL', async () => {
  const r = await runStage({ stage: 'Lint', script: 'lint', pm: 'npm', cwd: project({}), required: true, exec: fakeExec(0) });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.detail, 'No "lint" script in package.json (required for this project)');
});

test('command stage runs the raw command', async () => {
  const calls = [];
  const r = await runStage({ stage: 'Install', command: 'npm ci', pm: 'npm', cwd: project({}), required: false, exec: fakeExec(0, calls) });
  assert.deepEqual(calls, ['npm ci']);
  assert.equal(r.status, 'PASS');
});

test('results file gets one line per stage', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'rs-')), 'results.jsonl');
  const a = { stage: 'A', status: 'PASS', detail: 'Passed' };
  const b = { stage: 'B', status: 'FAIL', detail: 'Failed' };
  appendResult(file, a);
  appendResult(file, b);
  assert.deepEqual(readResults(file), [a, b]);
});
