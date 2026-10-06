import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadProject } from './lib.mjs';

// For every csp_ site, check that the spider class it asks for really exists in the jar it
// points at. JarLoader does `loadClass("com.github.catvod.spider." + api.split("csp_")[1])`
// against the site's jar only, so a name that is missing from that jar silently becomes an
// empty spider at runtime. Misses inherited from the upstream config are expected; use this
// to tell them apart from mistakes of your own.
//   node tools/check-jars.mjs [configFile]     (default hb.json)

const project = loadProject();
const RAW = project.rawPrefix;
const file = process.argv[2] || 'hb.json';
const config = JSON.parse(fs.readFileSync(file, 'utf8'));

function zipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    out.push({
      name: buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
      method: buf.readUInt16LE(p + 10),
      compSize: buf.readUInt32LE(p + 20),
      localOffset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const cache = new Map();
function classesOf(localPath) {
  if (cache.has(localPath)) return cache.get(localPath);
  let set = new Set();
  try {
    const buf = fs.readFileSync(localPath);
    for (const e of zipEntries(buf)) {
      if (!e.name.endsWith('.dex')) continue;
      const nameLen = buf.readUInt16LE(e.localOffset + 26);
      const extraLen = buf.readUInt16LE(e.localOffset + 28);
      const start = e.localOffset + 30 + nameLen + extraLen;
      const raw = buf.subarray(start, start + e.compSize);
      const dex = e.method === 8 ? zlib.inflateRawSync(raw) : raw;
      for (const m of dex.toString('latin1').matchAll(/Lcom\/github\/catvod\/spider\/([A-Za-z0-9_$]+);/g)) set.add(m[1]);
    }
  } catch (err) {
    console.log(`  cannot read ${localPath}: ${err.message}`);
    set = null;
  }
  cache.set(localPath, set);
  return set;
}

const perJar = new Map();
const missing = [];
for (const site of config.sites || []) {
  const api = String(site.api || '');
  if (!api.startsWith('csp_') || !site.jar) continue;
  const rel = site.jar.replace(RAW, '').split(';md5;')[0];
  const classes = classesOf(rel);
  const stat = perJar.get(rel) || { ok: 0, miss: 0 };
  if (classes && classes.has(api.slice(4))) stat.ok++;
  else {
    stat.miss++;
    missing.push(`${api.slice(4)}  (site ${site.key}, jar ${rel})`);
  }
  perJar.set(rel, stat);
}

console.log(`=== ${file}: csp_ sites per jar ===`);
for (const [jar, s] of [...perJar.entries()].sort((a, b) => b[1].miss - a[1].miss)) {
  console.log(`${String(s.miss).padStart(4)} missing / ${String(s.ok + s.miss).padStart(4)}  ${jar}`);
}
const total = [...perJar.values()].reduce((n, s) => n + s.ok + s.miss, 0);
console.log(`\n${missing.length} of ${total} csp_ sites ask for a class their jar does not contain`);
if (missing.length) console.log(missing.join('\n'));
