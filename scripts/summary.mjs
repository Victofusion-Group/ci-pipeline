import { appendFileSync } from 'node:fs';
import { readResults } from './lib/results.mjs';
import { flag, isMain, parseArgs } from './lib/cli.mjs';

const ICONS = { PASS: '✅ PASS', FAIL: '❌ FAIL', MISSING: '🟡 MISSING', WARN: '⚠️ WARN' };

const cell = (text) => String(text).replace(/\|/g, '\x5c|').replace(/\r?\n/g, ' ');

export function hasFailure(records) {
  return records.length === 0 || records.some((r) => r.status === 'FAIL');
}

export const REPORT_ONLY = 'Report only: speed failures are shown but do not fail this run.';

export function renderSummary(title, records, { reportOnly = false } = {}) {
  const lines = [`## ${title}`, ''];
  if (records.length === 0) {
    lines.push('No checks ran. Something stopped the job before the first check. Open the log.');
    return lines.join('\n') + '\n';
  }
  const n = (s) => records.filter((r) => r.status === s).length;
  const warnings = n('WARN');
  lines.push(`**${n('PASS')} passed, ${n('FAIL')} failed, ${n('MISSING')} missing, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}**`, '');
  if (reportOnly) lines.push(REPORT_ONLY, '');
  lines.push('| Check | Result | What it means |', '| --- | --- | --- |');
  for (const r of records) {
    lines.push(`| ${cell(r.stage)} | ${ICONS[r.status] ?? cell(r.status)} | ${cell(r.detail)} |`);
  }
  return lines.join('\n') + '\n';
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const records = readResults(a.results);
  const reportOnly = flag(a['report-only']);
  const text = renderSummary(a.title, records, { reportOnly });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  else process.stdout.write(text);
  // Report-only keeps FAIL rows from failing the run, but a run where no checks
  // ran at all is broken, not slow, so it still fails.
  const failed = reportOnly ? records.length === 0 : hasFailure(records);
  process.exitCode = failed ? 1 : 0;
}
