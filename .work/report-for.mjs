import fs from 'node:fs';

const report = JSON.parse(fs.readFileSync('.work/report-common.json', 'utf8'));
const folder = process.argv[2] || 'gao';
console.log(`=== ${folder}: urls in report ===`);
for (const a of [...report.added, ...report.unchanged]) {
  if (a.folders && a.folders.includes(folder)) console.log(' OK   ', a.file, '  <-', a.url);
  else if (!a.folders && a.url) console.log(' OK   ', a.file, '  <-', a.url);
}
for (const f of report.failed) {
  if (!f.folders || f.folders.includes(folder)) console.log(' FAIL ', f.status, f.err || '', ' <-', f.url);
}
