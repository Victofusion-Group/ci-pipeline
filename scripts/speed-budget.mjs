import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendResult } from './lib/results.mjs';
import { isMain, parseArgs } from './lib/cli.mjs';

export const BUDGETS = {
  weightBytes: { warn: 1_000_000, fail: 2_000_000 },
  lcpMs: { warn: 2000, fail: 2500 },
  cls: { warn: 0.05, fail: 0.1 },
  tbtMs: { warn: 200, fail: 300 },
  actionMs: { warn: 1000, fail: 3000 },
};

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const trim = (n, digits) => String(Number(n.toFixed(digits)));
const sec = (ms) => trim(ms / 1000, 1);

// How each measured value reads in a sentence: `show` when within budget,
// `problem` when over it, `unit` for the limit that was crossed.
const METRICS = [
  { key: 'weightBytes', audit: 'total-byte-weight', missing: 'page weight', budget: BUDGETS.weightBytes,
    show: (v) => `${(v / 1e6).toFixed(1)} MB`, problem: (v) => `${(v / 1e6).toFixed(1)} MB sent`, unit: (v) => `${trim(v / 1e6, 1)} MB` },
  { key: 'lcpMs', audit: 'largest-contentful-paint', missing: 'main content time', budget: BUDGETS.lcpMs,
    show: (v) => `main content ${sec(v)} s`, problem: (v) => `main content ${sec(v)} s`, unit: (v) => `${sec(v)} s` },
  { key: 'cls', audit: 'cumulative-layout-shift', missing: 'layout shift', budget: BUDGETS.cls,
    show: (v) => `layout shift ${v.toFixed(2)}`, problem: (v) => `layout shift ${v.toFixed(2)}`, unit: (v) => String(v) },
  { key: 'tbtMs', audit: 'total-blocking-time', missing: 'frozen time', budget: BUDGETS.tbtMs,
    show: (v) => `frozen ${Math.round(v)} ms`, problem: (v) => `frozen ${Math.round(v)} ms`, unit: (v) => `${v} ms` },
];

const num = (x) => typeof x === 'number' && Number.isFinite(x);

function urlParts(u) {
  try {
    const url = new URL(u);
    return { host: url.host, path: url.pathname + url.search, full: url.href };
  } catch {
    return { host: '', path: u, full: u };
  }
}

export function evaluatePages(lhrs) {
  const groups = new Map();
  for (const l of lhrs) {
    if (!groups.has(l.requestedUrl)) groups.set(l.requestedUrl, []);
    groups.get(l.requestedUrl).push(l);
  }
  const multiHost = new Set([...groups.keys()].map((u) => urlParts(u).host)).size > 1;

  const records = [];
  for (const [requested, runs] of groups) {
    const req = urlParts(requested);
    const stage = `Speed: ${multiHost ? req.full : req.path}`;
    const good = runs.filter((r) => !r.runtimeError);
    if (good.length === 0) {
      const msg = runs[0].runtimeError?.message ?? 'unknown error';
      records.push({ stage, status: 'FAIL', detail: `Page could not be measured: ${msg}` });
      continue;
    }

    const values = {};
    const missing = [];
    for (const m of METRICS) {
      const vals = good.map((r) => r.audits?.[m.audit]?.numericValue).filter(num);
      if (vals.length === 0) missing.push(m.missing);
      else values[m.key] = median(vals);
    }
    if (missing.length > 0) {
      records.push({ stage, status: 'FAIL', detail: `Page could not be measured: ${missing.join(', ')} missing` });
      continue;
    }

    let status = 'PASS';
    const problems = [];
    for (const m of METRICS) {
      const v = values[m.key];
      if (v > m.budget.fail) {
        status = 'FAIL';
        problems.push(`${m.problem(v)} (limit ${m.unit(m.budget.fail)})`);
      } else if (v > m.budget.warn) {
        if (status === 'PASS') status = 'WARN';
        problems.push(`${m.problem(v)} (aim under ${m.unit(m.budget.warn)})`);
      }
    }
    let detail = problems.length > 0
      ? problems.join('; ')
      : METRICS.map((m) => m.show(values[m.key])).join(', ');

    const finalUrl = good[0].finalDisplayedUrl ?? good[0].finalUrl;
    if (finalUrl) {
      const fin = urlParts(finalUrl);
      const a = new URL(requested);
      const b = new URL(finalUrl);
      if (a.pathname !== b.pathname || a.host !== b.host) {
        const where = fin.host !== req.host ? fin.full : fin.path;
        detail = `Measured ${where} instead (redirected). ${detail}`;
        if (status === 'PASS') status = 'WARN';
      }
    }
    records.push({ stage, status, detail });
  }
  return records;
}

export function evaluateTimings(entries, { warnOnly = false } = {}) {
  const { warn, fail } = BUDGETS.actionMs;
  return entries.map(({ label, ms }) => {
    const stage = `Action: ${label}`;
    if (ms > fail) {
      return { stage, status: warnOnly ? 'WARN' : 'FAIL', detail: `Took ${sec(ms)} s (limit ${sec(fail)} s)` };
    }
    if (ms > warn) return { stage, status: 'WARN', detail: `Took ${sec(ms)} s (aim under ${sec(warn)} s)` };
    return { stage, status: 'PASS', detail: `Took ${sec(ms)} s` };
  });
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const records = [];
  if (a['lhr-dir']) {
    const files = existsSync(a['lhr-dir'])
      ? readdirSync(a['lhr-dir']).filter((f) => f.startsWith('lhr-') && f.endsWith('.json')).sort()
      : [];
    if (files.length === 0) {
      records.push({ stage: 'Speed: pages', status: 'MISSING', detail: 'No Lighthouse results found.' });
    } else {
      records.push(...evaluatePages(files.map((f) => JSON.parse(readFileSync(join(a['lhr-dir'], f), 'utf8')))));
    }
  }
  if (a.timings && existsSync(a.timings)) {
    const entries = readFileSync(a.timings, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    records.push(...evaluateTimings(entries, { warnOnly: Boolean(a['warn-only']) }));
  }
  for (const r of records) {
    appendResult(a.results, r);
    console.log(`${r.status}: ${r.stage} - ${r.detail}`);
  }
}
