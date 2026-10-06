import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SKIP_PREFIXES = [
  'https://raw.giteeusercontent.com/zcchu/tvbox/',
  'https://gitee.com/zcchu/tvbox/',
];

export function md5hex(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

export function codeMd5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

export function stripComments(txt) {
  const lines = txt.split(/\r?\n/);
  return lines.filter((l) => !l.trim().startsWith('\u002f\u002f')).join('\n');
}

export function loadConfigs(folders) {
  const out = [];
  for (const f of folders) {
    const dir = f.folder;
    const entry = f.entry;
    const p = path.join(dir, entry);
    if (!fs.existsSync(p)) continue;
    out.push({ folder: dir, entry, file: p, text: fs.readFileSync(p, 'utf8') });
  }
  return out;
}

export function collectUrls(text) {
  const stripped = stripComments(text);
  const urls = new Set();
  for (const m of stripped.matchAll(/"(https?:\/\/[^"]+)"/g)) urls.add(m[1]);
  return [...urls];
}

export function splitDeclaredMd5(urlStr) {
  const i = urlStr.indexOf(';md5;');
  if (i < 0) return { url: urlStr, declaredMd5: null };
  return { url: urlStr.slice(0, i), declaredMd5: urlStr.slice(i + 5).trim().toLowerCase() };
}

export function isDownloadable(rawUrl) {
  const { url } = splitDeclaredMd5(rawUrl);
  if (!/^https?:\/\//i.test(url)) return false;
  for (const p of SKIP_PREFIXES) if (url.startsWith(p)) return false;
  if (/[{}]/.test(url)) return false;
  if (/[,;\s]/.test(url)) return false;
  if (/\?/.test(url)) return false;
  if (/127\.0\.0\.1|localhost/i.test(url)) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  if (!/\.[A-Za-z0-9]{1,6}$/.test(seg)) return false;
  return true;
}

export function basenameOf(rawUrl) {
  const { url } = splitDeclaredMd5(rawUrl);
  const u = new URL(url);
  const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  return seg.replace(/[\\/:*?"<>|]/g, '_');
}

export async function fetchOnce(url, timeout = 45000) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, status: res.status, buf, finalUrl: res.url };
}
