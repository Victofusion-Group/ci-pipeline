import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { appendResult } from './lib/results.mjs';
import { isMain, parseArgs } from './lib/cli.mjs';

function defaultExec(cmd, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, env, shell: true, stdio: 'inherit' });
    child.on('error', () => resolve({ code: 127 }));
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}

export function hasScript(cwd, script) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts && Object.hasOwn(pkg.scripts, script));
  } catch {
    return false;
  }
}

export async function runStage({ stage, script, command, pm = 'npm', cwd, required = false, exec = defaultExec }) {
  let cmd = command;
  if (script !== undefined) {
    if (!hasScript(cwd, script)) {
      const detail = `No "${script}" script in package.json` + (required ? ' (required for this project)' : '');
      return { stage, status: required ? 'FAIL' : 'MISSING', detail };
    }
    cmd = `${pm} run ${script}`;
  }
  const { code } = await exec(cmd, { cwd, env: process.env });
  if (code === 0) return { stage, status: 'PASS', detail: 'Passed' };
  return { stage, status: 'FAIL', detail: `Failed (exit code ${code}). Open the log for this step to see which test.` };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cwd = a.cwd || process.cwd();
  if (a['only-if-script'] && !hasScript(cwd, a['only-if-script'])) return 0;
  const record = await runStage({
    stage: a.stage,
    script: a.script,
    command: a.command,
    pm: a.pm || 'npm',
    cwd,
    required: Boolean(a.required),
  });
  appendResult(a.results, record);
  console.log(`${record.status}: ${record.stage} - ${record.detail}`);
  return a['stop-on-fail'] && record.status === 'FAIL' ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
