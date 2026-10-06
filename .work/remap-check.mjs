import fs from 'node:fs';
import path from 'node:path';

const folder = process.argv[2];
const report = JSON.parse(fs.readFileSync(path.join('.work', `report-${folder}.json`), 'utf8'));

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p.split(path.sep).join('/'));
  }
  return acc;
}
const onDisk = walk(folder).map((p) => p.replace(new RegExp(`^${folder}/`), ''));

console.log(`on disk: ${onDisk.length} files`);
for (const f of report.failures) {
  const base = f.relPath.split('/').pop();
  const hits = onDisk.filter((p) => p.split('/').pop() === base);
  console.log(`${f.relPath.padEnd(30)} -> ${hits.length ? hits.join('  |  ') : '(no basename match)'}`);
}
