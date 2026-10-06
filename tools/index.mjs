import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadProject, readState, md5hex, codeMd5 } from './lib.mjs';

// Rebuild common/url-index.tsv, the only mapping from original address to snapshot
// directory (configs hold the rewritten url, so the original is not recoverable from them).
// Rows from the previous index are carried over so the file accumulates, and any
// snapshot directory no longer referenced by the current report is flagged.
//   node tools/index.mjs

const project = loadProject();
const report = readState('common-report.json', { added: [], unchanged: [], changed: [], failed: [] });

const rows = []; // one row per (url, dir, file); two urls may share a dir via alias
const covered = new Set(); // dir/file that already has at least one row

function add(row) {
  const key = `${row.url || ''}|${row.dir}|${row.file}`;
  if (rows.some((r) => `${r.url || ''}|${r.dir}|${r.file}` === key)) return;
  rows.push(row);
  covered.add(`${row.dir}/${row.file}`);
}

// carry over what we already knew
const indexPath = path.join('common', 'url-index.tsv');
if (fs.existsSync(indexPath)) {
  for (const line of fs.readFileSync(indexPath, 'utf8').split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [url, dir, file, size, md5, note] = line.split('\t');
    add({ url, dir, file, size, md5, note: note || '' });
  }
}

for (const a of report.added) {
  if (a.aliasTo) {
    const [tdir, tfile] = a.aliasTo.replace(/^common\//, '').split('/');
    const p = path.join('common', tdir, tfile);
    add({
      url: a.url,
      dir: tdir,
      file: tfile,
      size: fs.existsSync(p) ? fs.statSync(p).size : '',
      md5: fs.existsSync(p) ? codeMd5(fs.readFileSync(p)) : '',
      note: `alias of ${a.aliasTo.replace(/^common\//, '')}`,
    });
  } else {
    const p = path.join('common', a.dir, a.file);
    add({
      url: a.url,
      dir: a.dir,
      file: a.file,
      size: fs.existsSync(p) ? fs.statSync(p).size : '',
      md5: fs.existsSync(p) ? codeMd5(fs.readFileSync(p)) : '',
      note: a.fetchedAs ? `fetched via ${a.fetchedAs}` : '',
    });
  }
}
for (const u of report.unchanged) {
  const p = path.join('common', u.dir, u.file);
  add({
    url: u.url,
    dir: u.dir,
    file: u.file,
    size: fs.existsSync(p) ? fs.statSync(p).size : '',
    md5: fs.existsSync(p) ? codeMd5(fs.readFileSync(p)) : '',
    note: '',
  });
}

// anything on disk that no row mentions stays in the index as unreferenced
for (const dir of fs.readdirSync('common', { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const files = fs.readdirSync(path.join('common', dir.name)).filter((f) => !f.endsWith('.md5'));
  for (const file of files) {
    if (covered.has(`${dir.name}/${file}`)) continue;
    const p = path.join('common', dir.name, file);
    add({
      url: '',
      dir: dir.name,
      file,
      size: fs.statSync(p).size,
      md5: codeMd5(fs.readFileSync(p)),
      note: 'not referenced by any current config',
    });
  }
}

const ordered = [...rows].sort((a, b) => String(a.url).localeCompare(String(b.url)));
const header = ['url', 'dir(=md5(url))', 'file', 'size', 'md5', 'note'].join('\t');
fs.writeFileSync(indexPath, header + '\n' + ordered.map((r) => [r.url, r.dir, r.file, r.size, r.md5, r.note].join('\t')).join('\n') + '\n');

let mismatch = 0;
for (const r of ordered) if (r.url && md5hex(r.url) !== r.dir) mismatch++;
console.log(`index rows: ${ordered.length}`);
console.log(`rows whose dir is not md5(url): ${mismatch} (expected only for alias rows)`);
console.log(`wrote ${indexPath}`);
