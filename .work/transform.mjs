import fs from 'node:fs';
import path from 'node:path';

const RAW = 'https://raw.giteeusercontent.com/zcchu/tvbox/raw/master/';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { folder, entry, selfOrigins } = spec;
const report = JSON.parse(fs.readFileSync(path.join('.work', `report-${folder}.json`), 'utf8'));
const failed = new Set(report.failures.map((f) => f.relPath));

const src = path.join(folder, entry);
const text = fs.readFileSync(src, 'utf8');
const lines = text.split(/\r?\n/);
const header = [];
let i = 0;
while (i < lines.length && (lines[i].trim().startsWith('\u002f\u002f') || lines[i].trim() === '')) {
  header.push(lines[i]);
  i++;
}
const body = lines
  .slice(i)
  .filter((l) => !l.trim().startsWith('\u002f\u002f'))
  .join('\n');
const obj = JSON.parse(body);

function normalize(ref) {
  const segs = [];
  for (const part of ref.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return segs.join('/');
}

function toRel(s) {
  if (typeof s !== 'string' || !s) return null;
  if (s.includes('$$$') || s.includes(',')) return null;
  const idx = s.indexOf(';md5;');
  const filePart = idx >= 0 ? s.slice(0, idx) : s;
  const md5 = idx >= 0 ? s.slice(idx) : '';
  let rel = null;
  if (filePart.startsWith('./') || filePart.startsWith('../')) {
    rel = normalize(filePart);
  } else {
    for (const o of selfOrigins) {
      if (filePart.startsWith(o)) {
        rel = filePart.slice(o.length);
        break;
      }
    }
  }
  if (rel === null) return null;
  const remap = (spec.pathRemap || {})[rel];
  if (remap) {
    appliedRemaps.set(rel, remap);
    rel = remap;
  }
  return { rel, md5, remapped: !!remap };
}

const appliedRemaps = new Map();

function collectRefs(v, acc = []) {
  if (typeof v === 'string') {
    const r = toRel(v);
    if (r) acc.push(r);
  } else if (Array.isArray(v)) {
    v.forEach((x) => collectRefs(x, acc));
  } else if (v && typeof v === 'object') {
    Object.values(v).forEach((x) => collectRefs(x, acc));
  }
  return acc;
}

function mapStrings(v) {
  if (typeof v === 'string') {
    const r = toRel(v);
    if (!r) return v;
    return RAW + folder + '/' + r.rel + r.md5;
  }
  if (Array.isArray(v)) return v.map(mapStrings);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = mapStrings(x);
    return out;
  }
  return v;
}

const dropped = [];
function pruneList(list, label) {
  const kept = [];
  for (const item of list || []) {
    const refs = collectRefs(item);
    const missing = refs.filter((r) => failed.has(r.rel));
    if (missing.length) {
      dropped.push({
        where: label,
        key: item.key || item.name,
        name: item.name,
        missing: [...new Set(missing.map((m) => m.rel))],
      });
      continue;
    }
    kept.push(item);
  }
  return kept;
}

const summary = {};
for (const key of ['sites', 'lives', 'parses', 'rules', 'flags', 'ijk', 'doh', 'ads']) {
  if (Array.isArray(obj[key])) {
    const before = obj[key].length;
    obj[key] = pruneList(obj[key], key);
    if (before !== obj[key].length) summary[key] = `${before} -> ${obj[key].length}`;
  }
}

const mapped = mapStrings(obj);
const outPath = path.join(folder, entry);
fs.writeFileSync(outPath, header.join('\n') + '\n' + JSON.stringify(mapped, null, 2) + '\n', 'utf8');

// verify no local refs survive and every rewritten ref exists locally
const survivor = [];
JSON.stringify(mapped).replace(/"((?:https:\/\/raw\.giteeusercontent\.com\/zcchu\/tvbox\/raw\/master\/[^"]*))"/g, (m, u) => {
  const rel = u.replace(RAW + folder + '/', '').split(';md5;')[0];
  if (!fs.existsSync(path.join(folder, rel))) survivor.push(rel);
  return m;
});
const leftoverLocal = (JSON.stringify(mapped).match(/"(?:\.\.?\/)[^"]*"/g) || []).length;

console.log(`=== ${folder}: pruned ${JSON.stringify(summary)} ===`);
console.log(`dropped entries (${dropped.length}):`);
for (const d of dropped) console.log(`  - [${d.where}] ${d.key || d.name} :: missing ${d.missing.join(', ')}`);
console.log(`leftover relative refs: ${leftoverLocal}`);
console.log(`rewritten refs pointing at missing files: ${survivor.length ? survivor : '(none)'}`);
if (appliedRemaps.size) console.log('path remaps:', JSON.stringify(Object.fromEntries(appliedRemaps), null, 1));
fs.writeFileSync(path.join('.work', `dropped-${folder}.json`), JSON.stringify(dropped, null, 2));
