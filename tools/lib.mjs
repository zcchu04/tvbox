import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = process.cwd();
export const STATE = path.join('tools', '.state');
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function loadProject() {
  return JSON.parse(fs.readFileSync(path.join('tools', 'sources.json'), 'utf8'));
}

export function statePath(name) {
  fs.mkdirSync(STATE, { recursive: true });
  return path.join(STATE, name);
}

export function writeState(name, data) {
  const p = statePath(name);
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
  return p;
}

export function readState(name, fallback = null) {
  const p = path.join(STATE, name);
  if (!fs.existsSync(p)) {
    if (fallback !== null) return fallback;
    throw new Error(`missing state file ${p}; run the earlier step first`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function md5hex(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

export function codeMd5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

// config files carry line comments that JSON.parse rejects
export function stripComments(txt) {
  return txt
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('\u002f\u002f'))
    .join('\n');
}

/** split "path;md5;abcdef" into the path and the declared md5 */
export function splitDeclaredMd5(s) {
  const i = s.indexOf(';md5;');
  if (i < 0) return { url: s, declaredMd5: null };
  return { url: s.slice(0, i), declaredMd5: s.slice(i + 5).trim().toLowerCase() };
}

export function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

export async function fetchUrl(url, timeout = 40000, extraHeaders = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: '*/*', ...extraHeaders },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) return { ok: false, status: res.status, url };
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, status: res.status, buf, finalUrl: res.url, type: res.headers.get('content-type') };
}

/** all http(s) urls that appear as JSON string values */
export function collectAbsoluteUrls(text) {
  const urls = new Set();
  for (const m of stripComments(text).matchAll(/"(https?:\/\/[^"]+)"/g)) urls.add(m[1]);
  return [...urls];
}

export function readConfig(folder, entry) {
  const file = path.join(folder, entry);
  return { file, text: fs.readFileSync(file, 'utf8') };
}

/** split a config into its leading comment block and the parsed body */
export function parseConfig(text) {
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
  return { header, obj: JSON.parse(body) };
}

export function writeConfig(file, header, obj) {
  const head = header.filter((l) => l.trim() !== '');
  fs.writeFileSync(file, (head.length ? head.join('\n') + '\n' : '') + JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export function isRemoteEntry(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}
