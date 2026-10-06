import fs from 'node:fs';
import path from 'node:path';
import { fetchUrl, md5hex, stripComments, statePath, writeState } from './lib.mjs';

// Triage candidate source urls before adopting one.
//   node tools/probe.mjs candidates.json
// candidates.json: [{ "name": "...", "url": "..." }]
// A usable source answers 200 with a JSON body (optionally with leading // comments)
// that has a "sites" array; anything else (landing page, logo image, ad redirect)
// means the address no longer serves a config and should not be adopted.

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/probe.mjs <candidates.json>');
  process.exit(1);
}
const candidates = JSON.parse(fs.readFileSync(file, 'utf8'));

const results = [];
for (const c of candidates) {
  let r;
  try {
    r = await fetchUrl(c.url, 30000);
  } catch (e) {
    r = { ok: false, status: 'ERR', err: e.message };
  }

  const row = { name: c.name, url: c.url, status: r.status, err: r.err };
  if (r.ok) {
    const text = r.buf.toString('utf8');
    row.finalUrl = r.finalUrl;
    row.size = r.buf.length;
    row.type = r.type;
    row.md5 = md5hex(text);
    try {
      const obj = JSON.parse(stripComments(text));
      row.parsesAsJson = true;
      row.isConfig = Array.isArray(obj.sites);
      row.sites = (obj.sites || []).length;
      row.lives = (obj.lives || []).length;
      fs.writeFileSync(path.join(statePath('probe'), `${c.name}.json`), r.buf);
    } catch {
      row.parsesAsJson = false;
      row.isConfig = false;
      row.bodyHead = text.slice(0, 80).replace(/\s+/g, ' ');
    }
  } else if (r.buf) {
    row.bodyHead = r.buf.toString('utf8').slice(0, 80).replace(/\s+/g, ' ');
  }

  const verdict = row.isConfig ? 'USABLE' : 'REJECT';
  console.log(`${verdict.padEnd(6)} ${String(row.name).padEnd(12)} ${row.status} ${row.size || 0}B ${row.isConfig ? `sites=${row.sites} lives=${row.lives}` : row.bodyHead || row.err || ''}`);
  results.push(row);
}

writeState('probe-report.json', results);
console.log(`\n${results.filter((r) => r.isConfig).length}/${results.length} usable; report in tools/.state/probe-report.json`);
