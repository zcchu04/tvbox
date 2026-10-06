import fs from 'node:fs';
import path from 'node:path';
import { loadProject, readConfig, parseConfig, writeConfig, readState, writeState, splitDeclaredMd5 } from './lib.mjs';

// Step 2 for one source: drop entries whose referenced local file never downloaded,
// then rewrite every surviving local reference to this repo's raw url.
//   node tools/transform.mjs <folder>
// Needs the report from tools/mirror.mjs. Paths listed in sources.json `pathRemap`
// (upstream pointed at a directory that does not exist) are redirected to the file
// that actually exists instead of dropping the entry.
// References containing `$$$` or `,` are packed field lists, not paths, and are left alone.

const folderArg = process.argv[2];
const project = loadProject();
const spec = project.sources.find((s) => s.folder === folderArg);
if (!spec) {
  console.error(`usage: node tools/transform.mjs <folder>   (folder from tools/sources.json)`);
  process.exit(1);
}
const RAW = project.rawPrefix + spec.folder + '/';
const { header, obj } = parseConfig(readConfig(spec.folder, spec.entry).text);
const report = readState(`mirror-${spec.folder}.json`);
const missing = new Set(report.failures.map((f) => f.relPath));

const appliedRemaps = new Map();

function localRel(str) {
  if (typeof str !== 'string' || !str) return null;
  if (str.includes('$$$') || str.includes(',')) return null;
  const idx = str.indexOf(';md5;');
  const filePart = idx >= 0 ? str.slice(0, idx) : str;
  const suffix = idx >= 0 ? str.slice(idx) : '';
  let rel = null;
  if (filePart.startsWith('./') || filePart.startsWith('../')) {
    const segs = [];
    for (const part of filePart.split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') segs.pop();
      else segs.push(part);
    }
    rel = segs.join('/');
  } else {
    for (const o of spec.selfOrigins) {
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
  return { rel, suffix };
}

function refsOf(v, acc = []) {
  if (typeof v === 'string') {
    const r = localRel(v);
    if (r) acc.push(r);
  } else if (Array.isArray(v)) v.forEach((x) => refsOf(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => refsOf(x, acc));
  return acc;
}

function mapStrings(v) {
  if (typeof v === 'string') {
    const r = localRel(v);
    return r ? RAW + r.rel + r.suffix : v;
  }
  if (Array.isArray(v)) return v.map(mapStrings);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = mapStrings(x);
    return o;
  }
  return v;
}

const dropped = [];
const summary = {};
for (const key of ['sites', 'lives', 'parses', 'rules', 'flags', 'ijk', 'doh', 'ads', 'headers']) {
  if (!Array.isArray(obj[key])) continue;
  const before = obj[key].length;
  obj[key] = obj[key].filter((item) => {
    const gone = refsOf(item).filter((r) => missing.has(r.rel));
    if (gone.length) {
      dropped.push({ where: key, key: item.key || item.name, missing: [...new Set(gone.map((g) => g.rel))] });
      return false;
    }
    return true;
  });
  if (before !== obj[key].length) summary[key] = `${before} -> ${obj[key].length}`;
}

const mapped = mapStrings(obj);
writeConfig(path.join(spec.folder, spec.entry), header, mapped);

const leftover = (JSON.stringify(mapped).match(/"(?:\.\.?\/)[^"]*"/g) || []).length;
const unreachable = [];
JSON.stringify(mapped).replace(/"([^"]*raw\.giteeusercontent\.com\/zcchu\/tvbox\/raw\/master\/[^"]*)"/g, (m, u) => {
  const rel = u.replace(RAW, '').split(';md5;')[0];
  if (rel.startsWith('common/')) return m;
  if (!fs.existsSync(path.join(spec.folder, rel))) unreachable.push(rel);
  return m;
});

console.log(`=== ${spec.folder}: pruned ${JSON.stringify(summary) || '{}'} ===`);
for (const d of dropped) console.log(`  dropped [${d.where}] ${d.key}  (missing ${d.missing.join(', ')})`);
if (appliedRemaps.size) console.log('  path remaps:', JSON.stringify(Object.fromEntries(appliedRemaps)));
console.log(`  leftover relative refs: ${leftover}`);
console.log(`  refs pointing at missing files: ${unreachable.length ? [...new Set(unreachable)].join(', ') : '(none)'}`);
writeState(`dropped-${spec.folder}.json`, dropped);
