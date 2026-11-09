import { appendFileSync } from 'node:fs';
import { readResults } from './lib/results.mjs';
import { isMain, parseArgs } from './lib/cli.mjs';

const ICONS = { PASS: '✅ PASS', FAIL: '❌ FAIL', MISSING: '🟡 MISSING', WARN: '⚠️ WARN' };

const cell = (text) => String(text).replace(/\|/g, '\|').replace(/\r?\n/g, ' ');

export function hasFailure(records) {
  return records.length === 0 || records.some((r) => r.status === 'FAIL');
}

export function renderSummary(title, records) {
  const lines = [`## ${title}`, ''];
  if (records.length === 0) {
    lines.push('No checks ran. Something stopped the job before the first check. Open the log.');
    return lines.join('\n') + '\n';
  }
  const n = (s) => records.filter((r) => r.status === s).length;
  const warnings = n('WARN');
  lines.push(`**${n('PASS')} passed, ${n('FAIL')} failed, ${n('MISSING')} missing, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}**`, '');
  lines.push('| Check | Result | What it means |', '| --- | --- | --- |');
  for (const r of records) {
    lines.push(`| ${cell(r.stage)} | ${ICONS[r.status] ?? cell(r.status)} | ${cell(r.detail)} |`);
  }
  return lines.join('\n') + '\n';
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const records = readResults(a.results);
  const text = renderSummary(a.title, records);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else process.stdout.write(text);
  process.exitCode = hasFailure(records) ? 1 : 0;
}
