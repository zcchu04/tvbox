import fs from 'node:fs';
import path from 'node:path';
import { loadProject, readConfig, parseConfig, writeState, fetchUrl } from './lib.mjs';

// Merge several mirrored sources into one config (tools/sources.json `merges`).
// The rules follow what the client (fongmi/tv api) actually does, so the merged file
// behaves the same as the individual ones:
//
//   sites    Site.equals compares `key` only and initSite skips a site already in the
//            list, so duplicates are resolved first-wins.
//   parses   initParse skips a parse already in the list -> dedup by name.
//   rules    dedup by name, except `proxy`: setRules applies EVERY rule named proxy by
//            adding its hosts to the http selector, so all of them are unioned here.
//   ads/flags/hosts   plain string lists, unioned.
//   doh/lives/headers dedup by name (headers by host).
//   spider   JarLoader.parseJar splits on ";md5;" and only reads the first two fields,
//            so the top level accepts exactly ONE jar. Every csp_ site therefore gets
//            the jar of the source it came from written into `sites[].jar`
//            (parseJar(site, spider) would have fallen back to that same jar).
//   ./*      Decoder.fix replaces every "./" in the config text with the config's own
//            directory, so a merged file at the repo root must not keep relative refs:
//            they are rewritten to the source folder before merging.
//
//   node tools/merge.mjs [mergeIndex]
//   node tools/merge.mjs --sources liucn,wex --output probe/x.json [--top liucn]
//     ad-hoc merge of a subset, for experiments (not registered anywhere)

const project = loadProject();
const merges = project.merges || [];

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

let merge;
const subset = argOf('--sources');
if (subset) {
  merge = {
    output: argOf('--output') || 'hb.json',
    name: 'ad-hoc',
    sources: subset.split(',').map((s) => s.trim()),
    topSpiderFrom: argOf('--top') || null,
  };
} else {
  const index = Number(process.argv[2] || 0);
  merge = merges[index];
}
if (!merge) {
  console.error(`no merge #${process.argv[2] || 0} in tools/sources.json`);
  process.exit(1);
}

const RAW = project.rawPrefix;
const parts = merge.sources.map((folder) => {
  const spec = project.sources.find((s) => s.folder === folder);
  if (!spec) throw new Error(`unknown source ${folder}`);
  const obj = parseConfig(readConfig(spec.folder, spec.entry).text).obj;
  return { spec, obj, base: RAW + spec.folder + '/' };
});

// --- relative refs: make them absolute for the source they came from -------------
function absolutize(v, base) {
  if (typeof v === 'string') return v.split('./').join(base).split('"../').join('"' + RAW);
  if (Array.isArray(v)) return v.map((x) => absolutize(x, base));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = absolutize(x, base);
    return o;
  }
  return v;
}
let rewritten = 0;
for (const p of parts) {
  const before = JSON.stringify(p.obj).match(/\.\//g)?.length || 0;
  p.obj = absolutize(p.obj, p.base);
  const after = JSON.stringify(p.obj).match(/\.\//g)?.length || 0;
  if (before !== after) console.log(`${p.spec.folder}: rewrote ${before - after} "./" refs to ${p.base}`);
  rewritten += before - after;
}

function dedup(list, keyOf) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const k = keyOf(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

const pick = (arr) => arr.find((x) => x !== undefined && x !== null && x !== '');

// --- sites: first-wins per key, each csp_ site keeps its own source jar -----------
const stats = { sitesIn: 0, sitesOut: 0, jarInjected: 0, bySource: {} };
const allSites = [];
for (const p of parts) {
  const spider = p.obj.spider;
  stats.bySource[p.spec.folder] = (p.obj.sites || []).length;
  stats.sitesIn += (p.obj.sites || []).length;
  for (const site of p.obj.sites || []) {
    let s = site;
    if (!s.jar && String(s.api || '').startsWith('csp_')) {
      s = { ...s, jar: spider };
      stats.jarInjected++;
    }
    allSites.push(s);
  }
}
const sites = dedup(allSites, (s) => s.key);
stats.sitesOut = sites.length;

// --- rules: proxy rules union their hosts ---------------------------------------
const ruleName = (r) => r.name;
const proxyHosts = [];
for (const p of parts) for (const r of p.obj.rules || []) if (r.name === 'proxy') proxyHosts.push(...(r.hosts || []));
const rules = dedup(
  parts.flatMap((p) => p.obj.rules || []).map((r) => (r.name === 'proxy' ? { ...r, hosts: [...new Set(proxyHosts)] } : r)),
  ruleName,
);

// --- wallpaper: first one that actually answers ---------------------------------
const walls = parts.map((p) => p.obj.wallpaper).filter(Boolean);
let wallpaper = walls[0];
for (const w of walls) {
  try {
    const r = await fetchUrl(w, 12000);
    if (r.ok || r.status === 403 || r.status === 401) {
      wallpaper = w;
      break;
    }
  } catch {
    /* keep looking */
  }
}

const strList = (key) => dedup(parts.flatMap((p) => p.obj[key] || []), (x) => String(x));
const objList = (key, keyOf) => dedup(parts.flatMap((p) => p.obj[key] || []), keyOf);

const merged = {};
merged.spider = parts.find((p) => p.spec.folder === merge.topSpiderFrom)?.obj.spider || parts[0].obj.spider;
merged.wallpaper = wallpaper;
const logo = pick(parts.map((p) => p.obj.logo));
if (logo) merged.logo = logo;
const notice = pick(parts.map((p) => p.obj.notice));
if (notice) merged.notice = notice;
const warningText = pick(parts.map((p) => p.obj.warningText));
if (warningText) merged.warningText = warningText;
const danmaku = pick(parts.map((p) => p.obj.danmaku));
if (danmaku) merged.danmaku = danmaku;
merged.sites = sites;
merged.parses = objList('parses', (x) => x.name);
merged.rules = rules;
const flags = strList('flags');
if (flags.length) merged.flags = flags;
const lives = objList('lives', (x) => x.name);
if (lives.length) merged.lives = lives;
const doh = objList('doh', (x) => x.name + '|' + x.url);
if (doh.length) merged.doh = doh;
const hosts = strList('hosts');
if (hosts.length) merged.hosts = hosts;
const headers = objList('headers', (x) => x.host);
if (headers.length) merged.headers = headers;
const ads = strList('ads');
if (ads.length) merged.ads = ads;

const outFile = merge.output;
const text = JSON.stringify(merged, null, 2) + '\n';
fs.writeFileSync(outFile, text, 'utf8');

// --- checks --------------------------------------------------------------------
const problems = [];
if (/\"\.\//.test(text)) problems.push('output still contains a "./" relative ref');
const noJar = sites.filter((s) => String(s.api || '').startsWith('csp_') && !s.jar);
if (noJar.length) problems.push(`${noJar.length} csp_ sites have no jar: ${noJar.slice(0, 5).map((s) => s.key).join(', ')}`);
const dupKeys = sites.length !== new Set(sites.map((s) => s.key)).size;
if (dupKeys) problems.push('duplicate site keys survived');

console.log(`\n=== ${outFile} ===`);
console.log(`sources: ${merge.sources.join(' -> ')}`);
console.log(`sites    : ${stats.sitesIn} in (${merge.sources.map((f) => `${f}=${stats.bySource[f]}`).join(' ')}) -> ${stats.sitesOut} after key dedup`);
for (const k of ['parses', 'rules', 'lives', 'doh', 'ads', 'flags', 'hosts', 'headers']) {
  const inCount = parts.reduce((n, p) => n + (p.obj[k]?.length || 0), 0);
  const outCount = Array.isArray(merged[k]) ? merged[k].length : 0;
  if (inCount) console.log(`${k.padEnd(9)}: ${inCount} -> ${outCount}`);
}
console.log(`spider   : ${merged.spider}`);
console.log(`wallpaper: ${merged.wallpaper}`);
console.log(`sites[].jar injected: ${stats.jarInjected}`);
console.log(`size: ${text.length}B`);
console.log(`relative refs rewritten: ${rewritten}`);
if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log('  ' + p);
  process.exitCode = 1;
} else {
  console.log('\nall checks passed');
}

writeState(`merge-${path.basename(outFile, '.json')}.json`, {
  output: outFile,
  sources: merge.sources,
  stats,
  spider: merged.spider,
  wallpaper: merged.wallpaper,
  counts: Object.fromEntries(['sites', 'parses', 'rules', 'lives', 'doh', 'ads', 'flags', 'hosts', 'headers'].map((k) => [k, merged[k]?.length || 0])),
});

console.log(`\nsource.json entry to add (first in "urls"):`);
console.log(`  { "name": ${JSON.stringify(merge.name)}, "url": ${JSON.stringify(RAW + outFile)} }`);
