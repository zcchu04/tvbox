import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RAW = 'https://raw.giteeusercontent.com/zcchu/tvbox/raw/master/';
const TARGETS = [
  { folder: 'cvkkj', entry: '1.json' },
  { folder: 'liucn', entry: 'm.json' },
  { folder: 'wex', entry: 'wex.json' },
  { folder: 'qist', entry: 'jsm.json' },
  { folder: 'gao', entry: 'js.json' },
];

const missing = [];
const mismatch = [];
let checked = 0;
let md5refs = 0;

for (const t of TARGETS) {
  const file = path.join(t.folder, t.entry);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/"(https:\/\/raw\.giteeusercontent\.com\/zcchu\/tvbox\/raw\/master\/[^"]+)"/g)) {
    const ref = m[1];
    const local = ref.replace(RAW, '');
    const [rel, declared] = local.split(';md5;');
    const p = rel.split('/').join(path.sep);
    if (!fs.existsSync(p)) {
      missing.push({ where: `${t.folder}/${t.entry}`, ref: rel });
      continue;
    }
    checked++;
    if (declared) {
      md5refs++;
      const actual = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
      if (actual !== declared) mismatch.push({ ref: rel, declared, actual });
    }
  }
}

console.log(`local refs checked: ${checked}`);
console.log(`refs with declared md5: ${md5refs}`);
console.log(`missing files: ${missing.length}`);
for (const x of missing) console.log('  MISSING', x.ref, `<- ${x.where}`);
console.log(`md5 mismatches: ${mismatch.length}`);
for (const x of mismatch) console.log('  MISMATCH', x.ref, x.declared, '!=', x.actual);
