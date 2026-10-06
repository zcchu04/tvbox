import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfigs,
  collectUrls,
  isDownloadable,
  basenameOf,
  splitDeclaredMd5,
  md5hex,
  codeMd5,
  fetchOnce,
} from './common-lib.mjs';

const FOLDERS = [
  { folder: 'cvkkj', entry: '1.json' },
  { folder: 'liucn', entry: 'm.json' },
  { folder: 'wex', entry: 'wex.json' },
  { folder: 'qist', entry: 'jsm.json' },
  { folder: 'gao', entry: 'js.json' },
];

const COMMON = 'common';
const configs = loadConfigs(FOLDERS);

// referencedUrl -> { fetchAs?: "<url>", aliasTo?: "common/<dir>/<file>" }
const overrides = fs.existsSync('.work/url-overrides.json')
  ? JSON.parse(fs.readFileSync('.work/url-overrides.json', 'utf8'))
  : {};

const urls = new Map();
for (const c of configs) {
  for (const u of collectUrls(c.text)) {
    if (!isDownloadable(u)) continue;
    if (!urls.has(u)) urls.set(u, []);
    urls.get(u).push(c.folder);
  }
}
console.log(`targets: ${urls.size} absolute urls`);

const report = { added: [], unchanged: [], changed: [], failed: [], md5DeclaredMismatch: [], declaredOk: [] };

for (const [rawUrl, folders] of urls) {
  const { url, declaredMd5 } = splitDeclaredMd5(rawUrl);
  const override = overrides[url] || overrides[rawUrl];

  if (override && override.aliasTo) {
    const [tdir, tfile] = override.aliasTo.replace(/^common\//, '').split('/');
    report.added.push({ url, dir: tdir, file: tfile, aliasTo: override.aliasTo, folders });
    console.log(`ALIAS ${url}  ->  ${override.aliasTo}`);
    continue;
  }

  const dir = path.join(COMMON, md5hex(url));
  const base = basenameOf(rawUrl);
  const filePath = path.join(dir, base);
  const md5Path = filePath + '.md5';

  if (fs.existsSync(filePath) && fs.existsSync(md5Path)) {
    const have = codeMd5(fs.readFileSync(filePath));
    const recorded = fs.readFileSync(md5Path, 'utf8').trim();
    if (have === recorded) {
      report.unchanged.push({ url, dir: md5hex(url), file: base });
      console.log(`SAME  ${base}  (${dir.slice(-8)})`);
      continue;
    }
    report.changed.push({ url, dir: md5hex(url), file: base, recorded, actual: have });
    console.log(`CHANGED (not overwritten)  ${base}  recorded=${recorded.slice(0, 8)} actual=${have.slice(0, 8)}  ${url}`);
    continue;
  }

  let r;
  try {
    r = await fetchOnce(override && override.fetchAs ? override.fetchAs : url);
  } catch (e) {
    r = { ok: false, status: 'ERR', err: e.message };
  }
  if (!r.ok) {
    report.failed.push({ url, status: r.status, err: r.err, folders });
    console.log(`FAIL  ${r.status}${r.err ? ' ' + r.err : ''}  ${url}`);
    continue;
  }
  const got = codeMd5(r.buf);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, r.buf);
  fs.writeFileSync(md5Path, got + '\n', 'utf8');
  report.added.push({
    url,
    dir: md5hex(url),
    file: base,
    size: r.buf.length,
    md5: got,
    fetchedAs: override && override.fetchAs ? override.fetchAs : undefined,
  });
  let note = '';
  if (declaredMd5) {
    if (declaredMd5 === got) {
      report.declaredOk.push({ url, md5: got });
      note = ' [declared md5 OK]';
    } else {
      report.md5DeclaredMismatch.push({ url, declaredMd5, actual: got });
      note = ` [!! declared md5 ${declaredMd5.slice(0, 8)} != actual ${got.slice(0, 8)}]`;
    }
  }
  console.log(`ADD   ${base}  ${r.buf.length}B  ${got.slice(0, 12)}${note}`);
}

console.log(`\n=== common: added ${report.added.length}, unchanged ${report.unchanged.length}, changed ${report.changed.length}, failed ${report.failed.length} ===`);
if (report.md5DeclaredMismatch.length) console.log('declared-md5 mismatches:', JSON.stringify(report.md5DeclaredMismatch, null, 1));
if (report.failed.length) console.log('failures:', JSON.stringify(report.failed, null, 1));
fs.writeFileSync('.work/report-common.json', JSON.stringify(report, null, 2));
