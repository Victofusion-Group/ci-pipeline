import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '..', 'secret-scan.sh');
// Built at run time so this test file never holds a key-shaped string itself.
const FAKE_KEY = 'sk' + '_live_' + 'x'.repeat(24);

function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

const scan = (cwd) => spawnSync('bash', [SCRIPT], { cwd, encoding: 'utf8' });

test('a committed live key fails the scan', () => {
  const r = scan(repoWith({ 'config.txt': `STRIPE=${FAKE_KEY}\n` }));
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('::error::Possible secret found in tracked files'), r.stdout);
});

test('the same key in an .example file is ignored', () => {
  const r = scan(repoWith({ 'x.example': `STRIPE=${FAKE_KEY}\n` }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a clean repo passes', () => {
  const r = scan(repoWith({ 'readme.txt': 'hello\n' }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
