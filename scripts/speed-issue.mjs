import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readResults } from './lib/results.mjs';
import { renderSummary } from './summary.mjs';
import { isMain, parseArgs } from './lib/cli.mjs';

const titleFor = (target) => `Speed report (${target})`;

function runGh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { env: process.env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const isProblem = (r) => r.status === 'FAIL' || r.status === 'MISSING';

// A hidden line naming which rows were failing or missing (not their numbers), so
// the next run can tell whether anything changed. Hashed so no page address can
// break out of the HTML comment.
export function rowsMarker(records) {
  const rows = records.filter(isProblem).map((r) => `${r.stage}|${r.status}`).sort();
  const hash = createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
  return `<!-- speed-rows: ${hash} -->`;
}

const MARKER = /<!-- speed-rows: [0-9a-f]+ -->/g;

// The newest marker in the issue: the last one in the last comment that has one,
// else the one in the issue body.
function latestMarker(thread) {
  const texts = [thread?.body ?? '', ...(thread?.comments ?? []).map((c) => c?.body ?? '')];
  for (let i = texts.length - 1; i >= 0; i--) {
    const found = texts[i].match(MARKER);
    if (found) return found.at(-1);
  }
  return null;
}

function buildBody(records, target, runUrl) {
  return [
    `Speed check on ${target} found pages or actions over the limit, or could not measure them.`,
    '',
    renderSummary(titleFor(target), records),
    `Run: ${runUrl}`,
    '',
    rowsMarker(records),
  ].join('\n');
}

// Keeps one open "Speed report (<target>)" issue per site: opens it on a FAIL,
// comments while it stays open and the failing rows change, closes it once
// nothing fails. Staging and live each have their own issue.
export async function syncSpeedIssue({ records, target, runUrl, gh, now = new Date() }) {
  // No records means the checks never ran: that is not a clean bill, so touch nothing.
  if (records.length === 0) return 'none';
  // A check that could not measure is treated like a failure, never like a pass.
  const failed = records.some(isProblem);
  const title = titleFor(target);
  const listed = JSON.parse(
    (await gh(['issue', 'list', '--state', 'open', '--search', `in:title "${title}"`, '--json', 'number,title'])) || '[]',
  );
  const open = listed.find((i) => i.title === title);

  if (failed) {
    if (open) {
      const thread = JSON.parse((await gh(['issue', 'view', String(open.number), '--json', 'body,comments'])) || '{}');
      // Same pages failing as last time: a nightly comment would only be noise.
      if (latestMarker(thread) === rowsMarker(records)) return 'none';
      await gh(['issue', 'comment', String(open.number), '--body', buildBody(records, target, runUrl)]);
      return 'commented';
    }
    await gh(['issue', 'create', '--title', title, '--body', buildBody(records, target, runUrl)]);
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
