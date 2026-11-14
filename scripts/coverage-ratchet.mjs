import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { appendResult } from './lib/results.mjs';
import { flag, isMain, parseArgs } from './lib/cli.mjs';

const toSlash = (p) => p.split(String.fromCharCode(92)).join('/');
const isAbsolute = (p) => p.startsWith('/') || /^[a-zA-Z]:\//.test(p);

// Istanbul writes absolute file keys. Turn one into a repo-relative path with
// `/` separators, whatever the operating system that wrote it.
function repoRelative(key, root, repoRoot) {
  const k = toSlash(key);
  const base = toSlash(repoRoot).replace(/\/+$/, '');
  if (k.toLowerCase().startsWith(base.toLowerCase() + '/')) return k.slice(base.length + 1);
  if (!isAbsolute(k)) return path.posix.normalize(path.posix.join(toSlash(root || '.'), k));
  return k;
}

const one = (n) => n.toFixed(1);
const pctOf = (covered, total) => (total === 0 ? 100 : (covered / total) * 100);

export function evaluateCoverage({ summaries, floor, criticalGlobs = [], criticalEnforced = false, required = false, repoRoot = process.env.GITHUB_WORKSPACE || process.cwd() }) {
  if (typeof floor !== 'number' || !Number.isFinite(floor)) {
    return [{ stage: 'Coverage', status: 'FAIL', detail: 'No coverage floor set in ci.yml.' }];
  }
  if (summaries.length === 0) {
    const detail = 'No coverage file found. If the tests failed, fix them first; otherwise add the json-summary reporter.';
    return [required
      ? { stage: 'Coverage', status: 'FAIL', detail: `${detail} (required for this project)` }
      : { stage: 'Coverage', status: 'MISSING', detail }];
  }

  let total = 0;
  let covered = 0;
  const files = [];
  for (const { root, data } of summaries) {
    total += data.total?.lines?.total ?? 0;
    covered += data.total?.lines?.covered ?? 0;
    for (const [key, value] of Object.entries(data)) {
      if (key === 'total' || !value?.lines) continue;
      files.push({ file: repoRelative(key, root, repoRoot), total: value.lines.total, covered: value.lines.covered });
    }
  }

  if (total === 0) {
    return [{ stage: 'Coverage', status: 'MISSING', detail: 'Coverage file has no measured lines.' }];
  }
  const pct = pctOf(covered, total);
  const records = [];
  if (pct < floor) {
    // Rounded down, so a share just under the floor never prints as the floor.
    const shown = (Math.floor((covered * 1000) / total) / 10).toFixed(1);
    records.push({ stage: 'Coverage', status: 'FAIL', detail: `${shown}% of lines are tested, below this project's floor of ${floor}%.` });
  } else {
    let detail = `${one(pct)}% of lines are tested (floor ${floor}%).`;
    if (Math.floor(pct) >= floor + 2) detail += ` Raise the floor to ${Math.floor(pct)}.`;
    records.push({ stage: 'Coverage', status: 'PASS', detail });
  }

  if (criticalGlobs.length > 0) {
    const stage = 'Critical-path coverage';
    const matched = files.filter((f) => criticalGlobs.some((g) => path.posix.matchesGlob(f.file, g)));
    if (matched.length === 0) {
      records.push({ stage, status: 'WARN', detail: 'No files match the critical-path list. Check the globs in ci.yml.' });
    } else {
      const cTotal = matched.reduce((s, f) => s + f.total, 0);
      const cCovered = matched.reduce((s, f) => s + f.covered, 0);
      if (cTotal === 0) {
        records.push({ stage, status: 'MISSING', detail: 'Files on the critical-path list have no measured lines.' });
      } else if (cCovered >= cTotal) {
        records.push({
          stage,
          status: 'PASS',
          detail: '100% of money, login and permission code is tested.' + (criticalEnforced ? '' : ' Set critical_enforced: true.'),
        });
      } else {
        const base = `${one(pctOf(cCovered, cTotal))}% of money, login and permission code is tested. Target is 100%.`;
        if (criticalEnforced) {
          const below = matched.filter((f) => f.covered < f.total).map((f) => f.file).slice(0, 5);
          records.push({ stage, status: 'FAIL', detail: `${base} Below 100: ${below.join(', ')}.` });
        } else {
          records.push({ stage, status: 'WARN', detail: base });
        }
      }
    }
  }
  return records;
}

// An unset workflow input arrives as "" or a bare flag; both mean no floor.
function parseFloor(v) {
  return typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
}

const lines = (s) => (typeof s === 'string' ? s.split('\n').map((l) => l.trim()).filter(Boolean) : []);

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const cwd = a.cwd || process.cwd();
  const summaries = [];
  for (const f of lines(a.files)) {
    const full = path.resolve(cwd, f);
    if (!existsSync(full)) continue;
    const root = toSlash(path.relative(process.env.GITHUB_WORKSPACE || cwd, path.dirname(full))) || '.';
    summaries.push({ root, data: JSON.parse(readFileSync(full, 'utf8')) });
  }
  const records = evaluateCoverage({
    summaries,
    floor: parseFloor(a.floor),
    criticalGlobs: lines(a.critical),
    criticalEnforced: flag(a['critical-enforced']),
    required: flag(a.required),
  });
  for (const r of records) {
    appendResult(a.results, r);
    console.log(`${r.status}: ${r.stage} - ${r.detail}`);
  }
}
