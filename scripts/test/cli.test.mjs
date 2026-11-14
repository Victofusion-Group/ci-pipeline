import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, flag } from '../lib/cli.mjs';

test('value flags keep their value, including an empty one', () => {
  const a = parseArgs(['--floor', '', '--cwd', 'x y']);
  assert.equal(a.floor, '');
  assert.equal(a.cwd, 'x y');
});

test('a flag followed by another flag is bare', () => {
  const a = parseArgs(['--required', '--stage', 'Lint']);
  assert.equal(a.required, true);
  assert.equal(a.stage, 'Lint');
});

test('boolean flags read the word they are given', () => {
  assert.equal(flag(true), true);
  assert.equal(flag('true'), true);
  assert.equal(flag('TRUE'), true);
  assert.equal(flag('false'), false);
  assert.equal(flag(''), false);
  assert.equal(flag(undefined), false);
  assert.equal(flag('0'), false);
});

test('--critical-enforced false is not enforced', () => {
  assert.equal(flag(parseArgs(['--critical-enforced', 'false']) ['critical-enforced']), false);
  assert.equal(flag(parseArgs(['--critical-enforced', '--results', 'f'])['critical-enforced']), true);
});
