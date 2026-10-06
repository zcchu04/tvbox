import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { md5hex } from './common-lib.mjs';

const report = JSON.parse(fs.readFileSync('.work/report-common.json', 'utf8'));
const rows = [];

function statOf(dir, file) {
  const p = path.join('common', dir, file);
  if (!fs.existsSync(p)) return { size: '', md5: '' };
  const buf = fs.readFileSync(p);
  return { size: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex') };
}

for (const a of report.added) {
  if (a.aliasTo) {
    const [tdir, tfile] = a.aliasTo.replace(/^common\//, '').split('/');
    const s = statOf(tdir, tfile);
    rows.push({ url: a.url, dir: tdir, file: tfile, size: s.size, md5: s.md5, note: `alias of ${a.aliasTo.replace(/^common\//, '')}` });
  } else {
    const s = statOf(a.dir, a.file);
    rows.push({ url: a.url, dir: a.dir, file: a.file, size: s.size, md5: s.md5, note: a.fetchedAs ? `fetched via ${a.fetchedAs}` : '' });
  }
}
for (const u of report.unchanged) {
  const s = statOf(u.dir, u.file);
  rows.push({ url: u.url, dir: u.dir, file: u.file, size: s.size, md5: s.md5, note: '' });
}

rows.sort((a, b) => a.url.localeCompare(b.url));
const header = ['url', 'dir(=md5(url))', 'file', 'size', 'md5', 'note'].join('\t');
const lines = rows.map((r) => [r.url, r.dir, r.file, r.size, r.md5, r.note].join('\t'));
fs.writeFileSync('common/url-index.tsv', header + '\n' + lines.join('\n') + '\n', 'utf8');

console.log(`index rows: ${rows.length}`);
let bad = 0;
for (const r of rows) if (md5hex(r.url) !== r.dir) { console.log('DIR MISMATCH', r.url); bad++; }
console.log('dir-vs-url md5 mismatches:', bad);
console.log(lines.slice(0, 4).join('\n'));
