import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadProject, UA } from './lib.mjs';

// Download the large binaries some sources need (spider jars, proxy cores).
// Public github proxies truncate big responses, so each file is verified against the
// expected byte count and its container format, and a short transfer is resumed
// with a Range request instead of being restarted.
//   node tools/fetch-large.mjs
// Entries live in tools/sources.json `largeFiles` ({dest, want, integrity, sources}).

const project = loadProject();
if (!process.argv.includes('--all')) {
  console.log('checking tools/sources.json largeFiles ...');
}

function checkIntegrity(file, kind) {
  if (kind === 'gzip') {
    const buf = fs.readFileSync(file);
    try {
      zlib.gunzipSync(buf.subarray(0, Math.min(buf.length, 1 << 22)));
    } catch {
      // gunzipSync cannot finish a partial stream; fall back to a streaming probe
    }
    try {
      zlib.gunzipSync(buf);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: `gzip: ${e.message}` };
    }
  }
  if (kind === 'zip') {
    const buf = fs.readFileSync(file);
    if (buf.subarray(0, 2).toString() !== 'PK') return { ok: false, reason: 'no PK magic' };
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) return { ok: false, reason: 'no end-of-central-directory (truncated?)' };
    return { ok: true };
  }
  return { ok: true };
}

async function download(url, dest, want) {
  let have = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  if (have > want) {
    fs.unlinkSync(dest);
    have = 0;
  }
  for (let attempt = 1; attempt <= 10 && have < want; attempt++) {
    const headers = { 'User-Agent': UA };
    if (have > 0) headers.Range = `bytes=${have}-`;
    let res;
    try {
      res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(300000) });
    } catch (e) {
      console.log(`  attempt ${attempt}: ${e.message}`);
      have = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
      continue;
    }
    if (!res.ok && res.status !== 206) {
      console.log(`  attempt ${attempt}: HTTP ${res.status}`);
      return false;
    }
    const body = Buffer.from(await res.arrayBuffer());
    fs.appendFileSync(dest, body);
    have = fs.statSync(dest).size;
    console.log(`  attempt ${attempt}: +${body.length}B -> ${have}/${want}`);
  }
  return have === want;
}

for (const item of project.largeFiles || []) {
  const { dest, want, integrity, sources } = item;
  if (fs.existsSync(dest) && fs.statSync(dest).size === want) {
    const chk = checkIntegrity(dest, integrity);
    if (chk.ok) {
      console.log(`OK    ${dest}  ${want}B`);
      continue;
    }
    console.log(`BAD   ${dest}  present but ${chk.reason}; re-downloading`);
  }

  let ok = false;
  for (const url of sources) {
    if (fs.existsSync(dest) && fs.statSync(dest).size !== want) fs.unlinkSync(dest);
    console.log(`FETCH ${dest}  <- ${url}`);
    ok = await download(url, dest, want);
    if (ok) {
      const chk = checkIntegrity(dest, integrity);
      if (chk.ok) break;
      console.log(`BAD   ${dest}  ${chk.reason}`);
      ok = false;
    }
  }
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${dest}  ${fs.existsSync(dest) ? fs.statSync(dest).size : 0}/${want}`);
}
