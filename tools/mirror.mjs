import fs from 'node:fs';
import path from 'node:path';
import {
  UA,
  loadProject,
  writeState,
  md5hex,
  codeMd5,
  encodePath,
  fetchUrl,
  stripComments,
} from './lib.mjs';

// Mirror one source: fetch its config plus every file it references by a relative path,
// keeping the same folder layout under <folder>/, and verify declared ;md5; values.
//   node tools/mirror.mjs <folder>
// Relative references found inside downloaded .js/.json files are followed too.
// Run tools/probe.mjs first to confirm the source still serves a config.

const folderArg = process.argv[2];
if (!folderArg) {
  console.error('usage: node tools/mirror.mjs <folder>   (folder from tools/sources.json)');
  process.exit(1);
}
const project = loadProject();
const spec = project.sources.find((s) => s.folder === folderArg);
if (!spec) {
  console.error(`unknown folder "${folderArg}"; known: ${project.sources.map((s) => s.folder).join(', ')}`);
  process.exit(1);
}

const { folder, entry, configUrl, baseUrl, selfOrigins, fetchPrefix = '', fallbacks = [] } = spec;

function hasExtension(p) {
  return /\.[A-Za-z0-9]{1,6}$/.test(p.split('/').pop() || '');
}

// A `$$$`-joined value is a packed field list (gao/token.json style), not a path.
// Returns { rel, fromRoot }: rel is relative to the source root when fromRoot is true
// (an absolute self-url), otherwise relative to the file the reference appears in.
function resolveRef(ref) {
  if (ref.includes('$$$') || ref.includes(',') || ref.includes(' ')) return null;
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    for (const o of selfOrigins) {
      if (ref.startsWith(o)) return { rel: ref.slice(o.length).split('?')[0], fromRoot: true };
    }
    return null;
  }
  if (!ref.startsWith('./') && !ref.startsWith('../')) return null;
  const segs = [];
  for (const part of ref.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return { rel: segs.join('/'), fromRoot: false };
}

function refsInJson(text) {
  return [...stripComments(text).matchAll(/"(\.\.?\/[^"]*)"/g)].map((m) => m[1]);
}

function refsInJs(text) {
  const out = [];
  for (const m of text.matchAll(/(?:import\s+[^;]*?from|import|require)\s*\(\s*["'](\.\.?\/[^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/from\s*["'](\.\.?\/[^"']+)["']/g)) out.push(m[1]);
  return out;
}

async function fetchRel(relPath) {
  const url = fetchPrefix + baseUrl + encodePath(relPath);
  let r = await fetchUrl(url).catch((e) => ({ ok: false, status: 'ERR', err: e.message }));
  if (r.ok) return r;
  for (const alt of fallbacks) {
    const r2 = await fetchUrl(alt + encodePath(relPath)).catch((e) => ({ ok: false, status: 'ERR', err: e.message }));
    if (r2.ok) return { ...r2, viaFallback: alt };
    r = r2;
  }
  return r;
}

const cfg = await fetchUrl(configUrl, 60000).catch((e) => ({ ok: false, status: 'ERR', err: e.message }));
if (!cfg.ok) {
  console.error(`cannot fetch ${configUrl}: ${cfg.status} ${cfg.err || ''}`);
  process.exit(1);
}
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, entry), cfg.buf);
console.log(`config  ${folder}/${entry}  ${cfg.buf.length}B`);

const downloaded = new Map([[entry, { md5: codeMd5(cfg.buf), size: cfg.buf.length }]]);
const failures = [];
const skipped = [];
const seen = new Set();
const scanned = new Set();
const queue = [];

for (const raw of refsInJson(cfg.buf.toString('utf8'))) {
  const [filePart, declared] = raw.split(';md5;');
  const r = resolveRef(filePart);
  if (!r) continue;
  if (!hasExtension(r.rel)) {
    skipped.push({ ref: raw, reason: 'no file extension' });
    continue;
  }
  queue.push({ rel: r.rel + (declared ? ';md5;' + declared : ''), from: entry });
}

while (queue.length) {
  const { rel, from } = queue.shift();
  const [filePart, declared] = rel.split(';md5;');
  if (seen.has(filePart)) continue;
  seen.add(filePart);

  const dest = path.join(folder, ...filePart.split('/'));
  let buf;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    buf = fs.readFileSync(dest);
  } else {
    const r = await fetchRel(filePart);
    if (!r.ok) {
      failures.push({ relPath: filePart, status: r.status, err: r.err, from });
      console.log(`FAIL  ${filePart}  (${r.status}${r.err ? ' ' + r.err : ''})  <- ${from}`);
      continue;
    }
    buf = r.buf;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }

  const got = codeMd5(buf);
  const ok = !declared || got === declared;
  downloaded.set(filePart, { md5: got, size: buf.length, declared, md5ok: ok });
  console.log(`${ok ? 'OK  ' : 'MD5!'} ${filePart} ${buf.length}B${declared ? ` md5=${got}` : ''}`);

  const ext = (filePart.split('.').pop() || '').toLowerCase();
  if ((ext === 'json' || ext === 'js') && !scanned.has(filePart)) {
    scanned.add(filePart);
    const text = buf.toString('utf8');
    const dir = filePart.split('/').slice(0, -1).join('/');
    for (const raw of ext === 'json' ? refsInJson(text) : refsInJs(text)) {
      const [subFile, subMd5] = raw.split(';md5;');
      const r = resolveRef(subFile);
      if (!r || !hasExtension(r.rel)) continue;
      const resolved = r.fromRoot || !dir ? r.rel : dir + '/' + r.rel;
      if (!seen.has(resolved)) queue.push({ rel: resolved + (subMd5 ? ';md5;' + subMd5 : ''), from: filePart });
    }
  }
}

const bad = [...downloaded.entries()].filter(([, v]) => v.md5ok === false);
console.log(`\n=== ${folder}: ${downloaded.size} files, ${failures.length} failures, ${bad.length} md5 mismatches ===`);
if (bad.length) console.log('md5 mismatch:', bad.map(([k]) => k));
if (skipped.length) console.log('skipped (no extension):', skipped.length);
writeState(`mirror-${folder}.json`, { folder, entry, downloaded: Object.fromEntries(downloaded), failures, skipped });
console.log(`report: tools/.state/mirror-${folder}.json`);
