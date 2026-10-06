import fs from 'node:fs';
import path from 'node:path';
import {
  loadProject,
  readConfig,
  collectAbsoluteUrls,
  splitDeclaredMd5,
  md5hex,
  codeMd5,
  fetchUrl,
  writeState,
} from './lib.mjs';

// Snapshot every absolute-url asset referenced by the mirrored configs into
//   common/<md5(url)>/<filename>      the file
//   common/<md5(url)>/<filename>.md5  md5 of its content
// Existing snapshots are never overwritten: a differing md5 is only reported as
// CHANGED so a human can decide whether to refresh it (see README).
//   node tools/common-snapshot.mjs
// tools/sources.json `urlOverrides` handle addresses that are unreachable here but
// whose content is available through another channel ({fetchAs}) or already snapshotted
// under a different address ({aliasTo}).

const project = loadProject();
const RAW = project.rawPrefix;
const overrides = project.urlOverrides || {};

function isDownloadable(str) {
  const { url } = splitDeclaredMd5(str);
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.startsWith(RAW)) return false;
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
  return /\.[A-Za-z0-9]{1,6}$/.test(seg);
}

function basenameOf(str) {
  const { url } = splitDeclaredMd5(str);
  const seg = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
  return seg.replace(/[\\/:*?"<>|]/g, '_');
}

const targets = new Map();
for (const spec of project.sources) {
  let text;
  try {
    text = readConfig(spec.folder, spec.entry).text;
  } catch {
    continue;
  }
  for (const u of collectAbsoluteUrls(text)) {
    if (!isDownloadable(u)) continue;
    if (!targets.has(u)) targets.set(u, []);
    targets.get(u).push(spec.folder);
  }
}

const report = { added: [], unchanged: [], changed: [], failed: [] };
console.log(`absolute-url targets: ${targets.size}`);

for (const [rawUrl, folders] of targets) {
  const { url, declaredMd5 } = splitDeclaredMd5(rawUrl);
  const override = overrides[url] || overrides[rawUrl];
  const dirId = md5hex(url);

  if (override && override.aliasTo) {
    const [tdir, tfile] = override.aliasTo.replace(/^common\//, '').split('/');
    report.added.push({ url, dir: tdir, file: tfile, folders, aliasTo: override.aliasTo });
    console.log(`ALIAS ${url}\n      -> ${override.aliasTo}`);
    continue;
  }

  const dir = path.join('common', dirId);
  const base = basenameOf(rawUrl);
  const filePath = path.join(dir, base);
  const md5Path = filePath + '.md5';

  if (fs.existsSync(filePath) && fs.existsSync(md5Path)) {
    const have = codeMd5(fs.readFileSync(filePath));
    const recorded = fs.readFileSync(md5Path, 'utf8').trim();
    if (have === recorded) {
      report.unchanged.push({ url, dir: dirId, file: base, folders });
      console.log(`SAME  ${base}`);
    } else {
      report.changed.push({ url, dir: dirId, file: base, recorded, actual: have, folders });
      console.log(`CHANGED (left as-is, decide manually)  ${base}  ${url}`);
    }
    continue;
  }

  let r;
  try {
    r = await fetchUrl(override && override.fetchAs ? override.fetchAs : url, 60000);
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
    dir: dirId,
    file: base,
    size: r.buf.length,
    md5: got,
    folders,
    fetchedAs: override && override.fetchAs ? override.fetchAs : undefined,
  });
  const tag = declaredMd5 ? (declaredMd5 === got ? ' [declared md5 OK]' : ` [!! declared md5 ${declaredMd5} != ${got}]`) : '';
  console.log(`ADD   ${base}  ${r.buf.length}B  ${got.slice(0, 12)}${tag}`);
}

console.log(`\n=== common: ${report.added.length} new, ${report.unchanged.length} unchanged, ${report.changed.length} changed, ${report.failed.length} failed ===`);
for (const f of report.failed) console.log(`  failed: ${f.status} ${f.url}`);
writeState('common-report.json', report);
console.log('report: tools/.state/common-report.json');
