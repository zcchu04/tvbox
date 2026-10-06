import fs from 'node:fs';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const targets = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const outDir = '.work';

async function probe(name, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(30000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    const isJson = /^\s*[{[]/.test(text.replace(/^\s*(\u002f\u002f[^\n]*\n)+/, ''));
    if (res.ok) {
      const dest = path.join(outDir, `${name}.json`);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(dest, buf);
    }
    return {
      name,
      url,
      finalUrl: res.url,
      status: res.status,
      size: buf.length,
      type: res.headers.get('content-type'),
      looksJson: isJson,
      ms: Date.now() - started,
      head: res.ok && isJson ? text.slice(0, 300).replace(/\s+/g, ' ') : '',
      bodyHead: res.ok ? '' : text.slice(0, 120).replace(/\s+/g, ' '),
    };
  } catch (e) {
    return { name, url, status: 'ERR', error: e.name + ': ' + e.message, ms: Date.now() - started };
  }
}

const results = [];
for (const t of targets) {
  const r = await probe(t.name, t.url);
  results.push(r);
  console.log(JSON.stringify(r));
}
fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(results, null, 2));
