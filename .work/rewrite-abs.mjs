import fs from 'node:fs';
import path from 'node:path';
import { md5hex, stripComments, splitDeclaredMd5 } from './common-lib.mjs';

const RAW = 'https://raw.giteeusercontent.com/zcchu/tvbox/raw/master/';

const report = JSON.parse(fs.readFileSync('.work/report-common.json', 'utf8'));
const okMap = new Map();
for (const a of [...report.added, ...report.unchanged]) okMap.set(a.url, { dir: a.dir, file: a.file });
const failSet = new Set(report.failed.map((f) => f.url));

const TARGETS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function classify(s) {
  if (typeof s !== 'string' || !s) return null;
  const { url, declaredMd5 } = splitDeclaredMd5(s);
  if (!/^https?:\/\//i.test(url)) return null;
  if (url.startsWith(RAW)) return null;
  const suffix = declaredMd5 ? ';md5;' + declaredMd5 : '';
  const hit = okMap.get(url);
  if (hit) return { kind: 'ok', url, suffix, newUrl: RAW + 'common/' + hit.dir + '/' + hit.file + suffix };
  if (failSet.has(url)) return { kind: 'fail', url, suffix };
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

for (const t of TARGETS) {
  const file = path.join(t.folder, t.entry);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = [];
  let i = 0;
  while (i < lines.length && (lines[i].trim().startsWith('\u002f\u002f') || lines[i].trim() === '')) {
    header.push(lines[i]);
    i++;
  }
  const obj = JSON.parse(
    lines
      .slice(i)
      .filter((l) => !l.trim().startsWith('\u002f\u002f'))
      .join('\n'),
  );

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

  // top-level absolute refs that failed (spider / wallpaper / logo ...)
  const topFailed = [];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      const r = classify(v);
      if (r && r.kind === 'fail') topFailed.push({ field: k, url: v });
    }
  }

  const mapped = mapStrings(obj);
  fs.writeFileSync(file, header.join('\n') + '\n' + JSON.stringify(mapped, null, 2) + '\n', 'utf8');

  const rewritten = (JSON.stringify(mapped).match(/raw\.giteeusercontent\.com\/zcchu\/tvbox\/raw\/master\/common\//g) || []).length;
  console.log(`=== ${t.folder}: pruned ${JSON.stringify(summary)} ; common/ refs rewritten: ${rewritten} ===`);
  for (const d of dropped) console.log(`  - [${d.where}] ${d.key} :: ${d.missing.join(', ')}`);
  if (topFailed.length) console.log('  top-level field failed (kept as-is):', JSON.stringify(topFailed));
}
