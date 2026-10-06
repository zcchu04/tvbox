import fs from 'node:fs';
import path from 'node:path';
import { readState } from './lib.mjs';

// Triage helper: for every reference tools/mirror.mjs could not download, look for a file
// with the same name elsewhere in the mirrored folder. A hit usually means upstream wrote
// the wrong directory and the entry can be kept by adding a sources.json `pathRemap`
// instead of dropping it.
//   node tools/remap-check.mjs <folder>

const folder = process.argv[2];
if (!folder) {
  console.error('usage: node tools/remap-check.mjs <folder>');
  process.exit(1);
}

const report = readState(`mirror-${folder}.json`);
const onDisk = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else onDisk.push(p.split(path.sep).join('/').slice(folder.length + 1));
  }
})(folder);

console.log(`${folder}: ${onDisk.length} files on disk, ${report.failures.length} failed references\n`);
const suggestions = [];
for (const f of report.failures) {
  const base = f.relPath.split('/').pop();
  const hits = onDisk.filter((p) => p.split('/').pop() === base);
  console.log(`${f.relPath.padEnd(34)} ${f.status}  ->  ${hits.length ? hits.join('  |  ') : '(no same-name file)'}`);
  if (hits.length === 1) suggestions.push([f.relPath, hits[0]]);
}
if (suggestions.length) {
  console.log('\nsuggested pathRemap entries:');
  for (const [from, to] of suggestions) console.log(`  "${from}": "${to}"`);
}
