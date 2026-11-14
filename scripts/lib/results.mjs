import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export function appendResult(file, record) {
  appendFileSync(file, JSON.stringify(record) + '\n');
}

export function readResults(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}
