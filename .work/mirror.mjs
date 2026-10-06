import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const RAW = 'https://raw.giteeusercontent.com/zcchu/tvbox/raw/master/';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const {
  folder,
  configUrl,
  baseUrl,
  fetchPrefix = '',
  selfOrigins = [],
  entry,
} = spec;

const OUT = path.resolve('.');

function enc(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function stripJsonComments(txt) {
  return txt
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('\u002f\u002f'))
    .join('\n')
    .replace(/^\s*/, '');
}

async function fetchUrl(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) return { ok: false, status: res.status, url };
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, status: res.status, buf, finalUrl: res.url, type: res.headers.get('content-type') };
}

async function tryFetch(relPath) {
  const primary = fetchPrefix + baseUrl + enc(relPath);
  let r = await fetchUrl(primary).catch((e) => ({ ok: false, status: 'ERR', err: e.message, url: primary }));
  if (r.ok) return r;
  for (const alt of spec.fallbacks || []) {
    const u = alt + enc(relPath);
    const r2 = await fetchUrl(u).catch((e) => ({ ok: false, status: 'ERR', err: e.message, url: u }));
    if (r2.ok) return { ...r2, viaFallback: alt };
    r = r2;
  }
  return r;
}

// ---- reference extraction -------------------------------------------------
function refsFromText(txt, isJson) {
  const out = [];
  if (isJson) {
    for (const m of txt.matchAll(/"(\.\.?\/[^"]*)"/g)) out.push(m[1]);
    for (const m of txt.matchAll(/"([^"]*)"/g)) {
      const v = m[1];
      for (const o of selfOrigins) if (v.startsWith(o)) out.push(v);
    }
  } else {
    for (const m of txt.matchAll(/(?:import\s+[^;]*?from|import|require)\s*\(\s*["'](\.\.?\/[^"']+)["']/g)) out.push(m[1]);
    for (const m of txt.matchAll(/from\s*["'](\.\.?\/[^"']+)["']/g)) out.push(m[1]);
  }
  return out;
}

function resolveRef(ref, fromDir, refFileDir) {
  // ref is relative to the file it appears in, or an absolute self-url
  if (ref.includes('$$$') || ref.includes(',') || ref.includes(' ')) return null;
  for (const o of selfOrigins) {
    if (ref.startsWith(o)) {
      const rel = ref.slice(baseUrl.length);
      return { relPath: rel.split('?')[0], rawRef: ref, absolute: true };
    }
  }
  const baseSegments = (fromDir ? fromDir.split('/') : []).filter(Boolean);
  const segs = [...baseSegments];
  for (const part of ref.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return { relPath: segs.join('/'), rawRef: ref, absolute: false };
}

function hasExtension(p) {
  const last = p.split('/').pop() || '';
  return /\.[A-Za-z0-9]{1,5}$/.test(last);
}

// ---- main -----------------------------------------------------------------
const downloaded = new Map(); // relPath -> {md5, size, bytes}
const skipped = [];
const failures = [];
const scanned = new Set();

const entryName = entry || configUrl.split('/').filter(Boolean).pop() || 'index.json';
const cfg = await fetchUrl(configUrl);
if (!cfg.ok) {
  console.log(`FATAL config fetch failed: ${configUrl} -> ${cfg.status} ${cfg.err || ''}`);
  process.exit(1);
}
console.log(`config ok: ${entryName} ${cfg.buf.length}B`);
fs.mkdirSync(path.join(folder), { recursive: true });
fs.writeFileSync(path.join(folder, entryName), cfg.buf);
downloaded.set(entryName, { md5: md5(cfg.buf), size: cfg.buf.length });

// queue of {relPath, dirOfFile}
const queue = [];
{
  const txt = cfg.buf.toString('utf8');
  const jsonish = cfg.buf.toString('utf8');
  const refs = refsFromText(jsonish, true);
  fs.writeFileSync(path.join('.work', `refs-${folder}.txt`), [...new Set(refs)].join('\n'));
  for (const r of refs) {
    const [filePart, expectMd5] = r.split(';md5;');
    const res = resolveRef(filePart, '', '');
    if (!res) continue;
    const { relPath } = res;
    if (!hasExtension(relPath)) {
      skipped.push({ ref: r, reason: 'no extension (dir/endpoint)' });
      continue;
    }
    queue.push({ relPath: relPath + (expectMd5 ? ';md5;' + expectMd5 : ''), from: entryName });
  }
  console.log(`config refs: ${new Set(refs).size} unique, ${queue.length} file candidates`);
}

const seen = new Set();
while (queue.length) {
  const { relPath, from } = queue.shift();
  if (seen.has(relPath)) continue;
  seen.add(relPath);
  if (downloaded.has(relPath)) continue;

  const [filePart, md5want] = relPath.split(';md5;');
  const dest = path.join(OUT, folder, ...filePart.split('/'));
  let buf = null;

  if (fs.existsSync(dest)) {
    buf = fs.readFileSync(dest);
  } else {
    const r = await tryFetch(filePart);
    if (!r.ok) {
      failures.push({ relPath: filePart, status: r.status, err: r.err, from });
      console.log(`FAIL  ${filePart}  (${r.status}${r.err ? ' ' + r.err : ''})  <- ${from}`);
      continue;
    }
    buf = r.buf;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    if (r.viaFallback) console.log(`OK*   ${filePart} ${buf.length}B via ${r.viaFallback}`);
  }

  const got = md5(buf);
  const md5ok = !md5want || got === md5want;
  downloaded.set(filePart, { md5: got, size: buf.length, md5want, md5ok });
  console.log(
    `${md5ok ? 'OK  ' : 'MD5!'} ${filePart} ${buf.length}B${md5want ? ` md5=${got}${md5ok ? '' : ` want=${md5want}`}` : ''}${fs.existsSync(dest) && !md5want ? '' : ''}`,
  );

  // scan for nested refs
  const ext = (filePart.split('.').pop() || '').toLowerCase();
  const isJson = ext === 'json';
  const isJs = ext === 'js';
  if ((isJson || isJs) && !scanned.has(filePart)) {
    scanned.add(filePart);
    const txt = buf.toString('utf8');
    const dirOfFile = filePart.split('/').slice(0, -1).join('/');
    for (const r of refsFromText(isJson ? stripJsonComments(txt) : txt, isJson)) {
      const [rFile, rMd5] = r.split(';md5;');
      const res = resolveRef(rFile, dirOfFile, dirOfFile);
      if (!res) continue;
      const { relPath: sub } = res;
      if (!hasExtension(sub)) {
        skipped.push({ ref: `${filePart} -> ${r}`, reason: 'no extension (dir/endpoint)' });
        continue;
      }
      if (sub.startsWith(folder + '/')) continue;
      if (!seen.has(sub)) queue.push({ relPath: sub + (rMd5 ? ';md5;' + rMd5 : ''), from: filePart });
    }
  }
}

const bad = [...downloaded.entries()].filter(([, v]) => v.md5ok === false);
console.log(`\n=== ${folder}: downloaded ${downloaded.size}, failures ${failures.length}, md5 mismatches ${bad.length} ===`);
if (bad.length) console.log('md5 mismatch:', bad.map(([k]) => k));
if (failures.length) console.log('failures:', JSON.stringify(failures, null, 1));
if (skipped.length) console.log('skipped:', JSON.stringify(skipped.slice(0, 20), null, 1));

fs.writeFileSync(
  path.join('.work', `report-${folder}.json`),
  JSON.stringify({ folder, entryName, downloaded: Object.fromEntries(downloaded), failures, skipped }, null, 2),
);
