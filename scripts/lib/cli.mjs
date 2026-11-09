import { pathToFileURL } from 'node:url';

// True when the file at `metaUrl` was started directly (not imported).
export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === metaUrl;
}

// Reads a boolean flag: bare (--x) or "true" is on; "false", "" or absent is off.
export function flag(value) {
  return value === true || (typeof value === 'string' && ['true', '1', 'yes'].includes(value.trim().toLowerCase()));
}

// Parses --flag value and bare --flag (true) arguments.
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
