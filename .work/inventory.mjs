import fs from 'node:fs';
import { loadConfigs, collectUrls, isDownloadable, md5hex } from './common-lib.mjs';

const FOLDERS = [
  { folder: 'cvkkj', entry: '1.json' },
  { folder: 'liucn', entry: 'm.json' },
  { folder: 'wex', entry: 'wex.json' },
  { folder: 'qist', entry: 'jsm.json' },
  { folder: 'gao', entry: 'js.json' },
];

const configs = loadConfigs(FOLDERS);
const all = new Map();
for (const c of configs) {
  const urls = collectUrls(c.text);
  const dl = urls.filter(isDownloadable);
  console.log(`${c.folder}/${c.entry}: ${urls.length} absolute urls, ${dl.length} file-like`);
  for (const u of dl) {
    if (!all.has(u)) all.set(u, []);
    all.get(u).push(c.folder);
  }
}
console.log(`\n=== unique file-like absolute urls: ${all.size} ===`);

const byHost = {};
for (const u of all.keys()) {
  const h = new URL(u).host;
  byHost[h] = (byHost[h] || 0) + 1;
}
const sorted = Object.entries(byHost).sort((a, b) => b[1] - a[1]);
console.log('top hosts:');
for (const [h, n] of sorted.slice(0, 30)) console.log(`  ${String(n).padStart(4)}  ${h}`);
console.log(`hosts total: ${sorted.length}`);

const templated = new Set();
for (const c of configs) {
  for (const u of collectUrls(c.text)) if (!isDownloadable(u)) templated.add(u);
}
console.log(`\nskipped (templated/non-file/self): ${templated.size}`);
for (const u of [...templated].slice(0, 15)) console.log('  skip:', u);

fs.writeFileSync(
  '.work/absolute-urls.json',
  JSON.stringify([...all.entries()].map(([url, folders]) => ({ url, dir: md5hex(url), folders })), null, 2),
);
console.log('\nwrote .work/absolute-urls.json');
