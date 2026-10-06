import fs from 'node:fs';
import path from 'node:path';
import {
  loadProject,
  readConfig,
  parseConfig,
  writeConfig,
  readState,
  writeState,
  splitDeclaredMd5,
} from './lib.mjs';

// Step 3 for one source: point its absolute references at this repo's common/ snapshot,
// and drop entries whose absolute reference could not be snapshotted.
//   node tools/common-rewrite.mjs <folder>
// Run tools/common-snapshot.mjs first (that report decides ok vs unusable).
// Addresses that are templated, carry a query string, have no file extension or are
// not reachable are outside the rule and are left untouched.

const folderArg = process.argv[2];
const project = loadProject();
const spec = project.sources.find((s) => s.folder === folderArg);
if (!spec) {
  console.error('usage: node tools/common-rewrite.mjs <folder>   (folder from tools/sources.json)');
  process.exit(1);
}
const RAW = project.rawPrefix;
const report = readState('common-report.json');

const okMap = new Map();
for (const a of [...report.added, ...report.unchanged]) okMap.set(a.url, { dir: a.dir, file: a.file });
const failSet = new Set(report.failed.map((f) => f.url));

function classify(str) {
  if (typeof str !== 'string' || !str) return null;
  const { url, declaredMd5 } = splitDeclaredMd5(str);
  if (!/^https?:\/\//i.test(url) || url.startsWith(RAW)) return null;
  const suffix = declaredMd5 ? ';md5;' + declaredMd5 : '';
  const hit = okMap.get(url);
  if (hit) return { kind: 'ok', newUrl: RAW + 'common/' + hit.dir + '/' + hit.file + suffix };
  if (failSet.has(url)) return { kind: 'fail', url };
  return null;
}

function refsOf(v, acc = []) {
  if (typeof v === 'string') {
    const r = classify(v);
    if (r) acc.push(r);
  } else if (Array.isArray(v)) v.forEach((x) => refsOf(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => refsOf(x, acc));
  return acc;
}

function mapStrings(v) {
  if (typeof v === 'string') {
    const r = classify(v);
    return r && r.kind === 'ok' ? r.newUrl : v;
  }
  if (Array.isArray(v)) return v.map(mapStrings);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = mapStrings(x);
    return o;
  }
  return v;
}

const { header, obj } = parseConfig(readConfig(spec.folder, spec.entry).text);
const dropped = [];
const summary = {};
for (const key of ['sites', 'lives', 'parses', 'rules', 'flags', 'ijk', 'doh', 'ads', 'headers']) {
  if (!Array.isArray(obj[key])) continue;
  const before = obj[key].length;
  obj[key] = obj[key].filter((item) => {
    const bad = refsOf(item).filter((r) => r.kind === 'fail');
    if (bad.length) {
      dropped.push({ where: key, key: item.key || item.name, missing: [...new Set(bad.map((b) => b.url))] });
      return false;
    }
    return true;
  });
  if (before !== obj[key].length) summary[key] = `${before} -> ${obj[key].length}`;
}

// top-level fields (spider / wallpaper / logo ...) can only be reported, not dropped
const topFailed = [];
for (const [k, v] of Object.entries(obj)) {
  if (typeof v === 'string') {
    const r = classify(v);
    if (r && r.kind === 'fail') topFailed.push({ field: k, url: v });
  }
}

const mapped = mapStrings(obj);
writeConfig(path.join(spec.folder, spec.entry), header, mapped);

const count = (JSON.stringify(mapped).match(/raw\.giteeusercontent\.com\/zcchu\/tvbox\/raw\/master\/common\//g) || []).length;
console.log(`=== ${spec.folder}: pruned ${JSON.stringify(summary) || '{}'}; common refs rewritten: ${count} ===`);
for (const d of dropped) console.log(`  dropped [${d.where}] ${d.key}  (${d.missing.join(', ')})`);
if (topFailed.length) console.log('  top-level field unreachable (left as-is):', JSON.stringify(topFailed));
writeState(`dropped-abs-${spec.folder}.json`, dropped);
