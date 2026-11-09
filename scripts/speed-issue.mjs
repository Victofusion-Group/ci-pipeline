import { execFile } from 'node:child_process';
import { readResults } from './lib/results.mjs';
import { renderSummary } from './summary.mjs';
import { isMain, parseArgs } from './lib/cli.mjs';

const TITLE = 'Speed report';

function runGh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { env: process.env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

function buildBody(records, target, runUrl) {
  return [
    `Speed check on ${target} found pages or actions over the limit.`,
    '',
    renderSummary(`Speed report (${target})`, records),
    `Run: ${runUrl}`,
  ].join('\n');
}

// Keeps one open "Speed report" issue per project: opens it on a FAIL, adds a
// comment while it stays open, closes it once nothing fails.
export async function syncSpeedIssue({ records, target, runUrl, gh, now = new Date() }) {
  const failed = records.some((r) => r.status === 'FAIL');
  const listed = JSON.parse(
    (await gh(['issue', 'list', '--state', 'open', '--search', `in:title "${TITLE}"`, '--json', 'number,title'])) || '[]',
  );
  const open = listed.find((i) => i.title === TITLE);

  if (failed) {
    const body = buildBody(records, target, runUrl);
    if (open) {
      await gh(['issue', 'comment', String(open.number), '--body', body]);
      return 'commented';
    }
    await gh(['issue', 'create', '--title', TITLE, '--body', body]);
    return 'opened';
  }
  if (open) {
    const day = now.toISOString().slice(0, 10);
    await gh(['issue', 'comment', String(open.number), '--body', `All pages and actions within budget on ${target} (${day}).`]);
    await gh(['issue', 'close', String(open.number)]);
    return 'closed';
  }
  return 'none';
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const outcome = await syncSpeedIssue({
    records: readResults(a.results),
    target: a.target,
    runUrl: a['run-url'],
    gh: runGh,
  });
  console.log(`Speed report issue: ${outcome}`);
}
