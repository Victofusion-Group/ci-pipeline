import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncSpeedIssue, rowsMarker } from '../speed-issue.mjs';

const RUN = 'https://example.com/runs/1';
const failing = [
  { stage: 'Speed: /', status: 'FAIL', detail: '2.4 MB sent (limit 2 MB)' },
  { stage: 'Action: Save', status: 'PASS', detail: 'Took 0.4 s' },
];
const warning = [{ stage: 'Speed: /', status: 'WARN', detail: 'main content 2.1 s (aim under 2 s)' }];
const passing = [{ stage: 'Speed: /', status: 'PASS', detail: '0.8 MB' }];

// A fake gh that records every call. `open` is the list of open issues it reports;
// `thread` is what `gh issue view` returns for an issue (body and comments).
function fakeGh(open, thread = { body: '', comments: [] }) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    if (args[1] === 'list') return JSON.stringify(open);
    if (args[1] === 'view') return JSON.stringify(thread);
    return '';
  };
  return { gh, calls };
}

const STAGING = 'Speed report (staging)';
const LIVE = 'Speed report (live)';

test('FAIL and no open issue opens one titled for the target', async () => {
  const { gh, calls } = fakeGh([]);
  const out = await syncSpeedIssue({ records: failing, target: 'staging', runUrl: RUN, gh });
  assert.equal(out, 'opened');
  const create = calls.find((c) => c[1] === 'create');
  assert.deepEqual(create.slice(0, 4), ['issue', 'create', '--title', STAGING]);
  assert.equal(create[4], '--body');
  const body = create[5];
  assert.ok(body.includes('staging'));
  assert.ok(body.includes('| Speed: / | ❌ FAIL | 2.4 MB sent (limit 2 MB) |'));
  assert.ok(body.includes(RUN));
  assert.ok(body.includes(rowsMarker(failing)), 'body carries the rows marker');
});

test('looks for the issue by exact title among open issues', async () => {
  const { gh, calls } = fakeGh([]);
  await syncSpeedIssue({ records: failing, target: 'live', runUrl: RUN, gh });
  assert.deepEqual(calls[0], ['issue', 'list', '--state', 'open', '--search', `in:title "${LIVE}"`, '--json', 'number,title']);
});

test('staging and live issues are independent', async () => {
  // The staging issue is open; a live failure must open its own, not comment on staging's.
  const { gh, calls } = fakeGh([{ number: 7, title: STAGING }]);
  assert.equal(await syncSpeedIssue({ records: failing, target: 'live', runUrl: RUN, gh }), 'opened');
  assert.deepEqual(calls.find((c) => c[1] === 'create').slice(2, 4), ['--title', LIVE]);
  assert.equal(calls.some((c) => c[1] === 'comment' || c[1] === 'close'), false);
});

test('a clean live run leaves the staging issue open', async () => {
  const { gh, calls } = fakeGh([{ number: 7, title: STAGING }]);
  assert.equal(await syncSpeedIssue({ records: passing, target: 'live', runUrl: RUN, gh }), 'none');
  assert.equal(calls.some((c) => c[1] === 'close'), false);
});

test('FAIL and open issue with different failures adds a comment', async () => {
  const before = [{ stage: 'Speed: /about', status: 'FAIL', detail: 'x' }];
  const { gh, calls } = fakeGh([{ number: 7, title: STAGING }], { body: `old\n${rowsMarker(before)}`, comments: [] });
  const out = await syncSpeedIssue({ records: failing, target: 'staging', runUrl: RUN, gh });
  assert.equal(out, 'commented');
  assert.deepEqual(calls.find((x) => x[1] === 'view'), ['issue', 'view', '7', '--json', 'body,comments']);
  const c = calls.find((x) => x[1] === 'comment');
  assert.deepEqual(c.slice(0, 3), ['issue', 'comment', '7']);
  assert.equal(c[3], '--body');
  assert.ok(c[4].includes(RUN));
  assert.ok(c[4].includes(rowsMarker(failing)));
  assert.equal(calls.some((x) => x[1] === 'create'), false);
});

test('the same failures as last time add no comment', async () => {
  const { gh, calls } = fakeGh([{ number: 7, title: STAGING }], { body: `old\n${rowsMarker(failing)}`, comments: [] });
  assert.equal(await syncSpeedIssue({ records: failing, target: 'staging', runUrl: RUN, gh }), 'none');
  assert.equal(calls.some((x) => x[1] === 'comment' || x[1] === 'close'), false);
});

test('the latest marker wins over the issue body', async () => {
  const older = [{ stage: 'Speed: /about', status: 'FAIL', detail: 'x' }];
  const thread = { body: rowsMarker(older), comments: [{ body: 'a person writing' }, { body: `update\n${rowsMarker(failing)}` }] };
  const same = fakeGh([{ number: 7, title: STAGING }], thread);
  assert.equal(await syncSpeedIssue({ records: failing, target: 'staging', runUrl: RUN, gh: same.gh }), 'none');
  const changed = fakeGh([{ number: 7, title: STAGING }], thread);
  assert.equal(await syncSpeedIssue({ records: older, target: 'staging', runUrl: RUN, gh: changed.gh }), 'commented');
});

test('the marker ignores details, order and passing rows', () => {
  const a = [{ stage: 'B', status: 'FAIL', detail: '2.4 MB' }, { stage: 'A', status: 'MISSING', detail: 'x' }, { stage: 'C', status: 'PASS', detail: 'ok' }];
  const b = [{ stage: 'A', status: 'MISSING', detail: 'y' }, { stage: 'B', status: 'FAIL', detail: '2.6 MB' }];
  assert.equal(rowsMarker(a), rowsMarker(b));
  assert.notEqual(rowsMarker(a), rowsMarker([{ stage: 'B', status: 'FAIL', detail: '' }]));
  assert.match(rowsMarker(a), /^<!-- speed-rows: [0-9a-f]+ -->$/);
});

test('an open issue with no marker gets a comment', async () => {
  const { gh } = fakeGh([{ number: 7, title: STAGING }]);
  assert.equal(await syncSpeedIssue({ records: failing, target: 'staging', runUrl: RUN, gh }), 'commented');
});

test('a similar title is not the speed report', async () => {
  const { gh } = fakeGh([{ number: 3, title: 'Speed report (staging) for the old site' }, { number: 4, title: 'Speed report' }]);
  assert.equal(await syncSpeedIssue({ records: failing, target: 'staging', runUrl: RUN, gh }), 'opened');
});

test('no FAIL and open issue closes it', async () => {
  const { gh, calls } = fakeGh([{ number: 7, title: STAGING }]);
  const out = await syncSpeedIssue({ records: warning, target: 'staging', runUrl: RUN, gh, now: new Date('2026-11-09T10:00:00Z') });
  assert.equal(out, 'closed');
  const comment = calls.find((x) => x[1] === 'comment');
  assert.deepEqual(comment, ['issue', 'comment', '7', '--body', 'All pages and actions within budget on staging (2026-11-09).']);
  assert.deepEqual(calls.at(-1), ['issue', 'close', '7']);
});

test('only WARN and no open issue does nothing', async () => {
  const { gh, calls } = fakeGh([]);
  assert.equal(await syncSpeedIssue({ records: warning, target: 'live', runUrl: RUN, gh }), 'none');
  assert.equal(calls.length, 1);
});

test('all passing and no open issue does nothing', async () => {
  const { gh } = fakeGh([]);
  assert.equal(await syncSpeedIssue({ records: passing, target: 'live', runUrl: RUN, gh }), 'none');
});

const missing = [{ stage: 'Speed: pages', status: 'MISSING', detail: 'No Lighthouse results found.' }];

test('zero records touch nothing, even with an open issue', async () => {
  const { gh, calls } = fakeGh([{ number: 7, title: LIVE }]);
  assert.equal(await syncSpeedIssue({ records: [], target: 'live', runUrl: RUN, gh }), 'none');
  assert.equal(calls.some((c) => c[1] === 'comment' || c[1] === 'close' || c[1] === 'create'), false);
});

test('MISSING with an open issue comments and keeps it open', async () => {
  const { gh, calls } = fakeGh([{ number: 7, title: LIVE }]);
  assert.equal(await syncSpeedIssue({ records: missing, target: 'live', runUrl: RUN, gh }), 'commented');
  assert.equal(calls.some((c) => c[1] === 'close'), false);
});

test('MISSING with no open issue opens one', async () => {
  const { gh } = fakeGh([]);
  assert.equal(await syncSpeedIssue({ records: missing, target: 'live', runUrl: RUN, gh }), 'opened');
});
