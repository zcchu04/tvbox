import fs from 'node:fs';
import dns from 'node:dns/promises';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function get(url, headers = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    signal: AbortSignal.timeout(30000),
  });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

console.log('=== 1. fanty nav page: look for config links ===');
{
  const { buf } = await get('http://www.xn--sss604efuw.cc/');
  const html = buf.toString('utf8');
  const links = [...html.matchAll(/(?:href|url|src)\s*[=:]\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]);
  const cand = [...new Set(links)].filter((l) => /tv|json|box|api|clan|\.txt/i.test(l) && !/\.(css|js|png|jpg|jpeg|ico|webp|gif)/i.test(l));
  console.log('candidate links:', cand.slice(0, 40));
  const hits = [...new Set(html.match(/https?:\/\/[^\s"'<>]+/g) || [])].slice(0, 60);
  console.log('all urls sample:', hits.filter((u) => /json|tv|box|club|top|cf|xyz/i.test(u)).slice(0, 30));
  fs.writeFileSync('.work/fanty-home.html', buf);
}

console.log('\n=== 2. fty.xxooo.cf/tv payload: does it embed json? ===');
{
  const { buf, res } = await get('http://fty.xxooo.cf/tv');
  const txt = buf.toString('latin1');
  console.log('size', buf.length, 'type', res.headers.get('content-type'), 'magic', buf.subarray(0, 4).toString('hex'));
  console.log('contains "spider"?', txt.includes('spider'), ' contains "sites"?', txt.includes('sites'));
  const idx = txt.indexOf('spider');
  if (idx >= 0) console.log('json-ish tail:', txt.slice(idx - 40, idx + 400));
  fs.writeFileSync('.work/fanty-alt-tv.bin', buf);
}

console.log('\n=== 3. moyuer: try common config paths ===');
for (const p of ['', '/tv', '/tv.txt', '/m.json', '/box/m.json', '/tvbox.json', '/api.json']) {
  for (const host of ['http://xn--ihqu10cn4c.xn--v4q818bf34b.com']) {
    try {
      const { buf, res } = await get(host + p);
      const head = buf.toString('utf8').slice(0, 80).replace(/\s+/g, ' ');
      console.log(`${host}${p || '/'} -> ${res.status} ${buf.length}B ${res.headers.get('content-type')} :: ${head}`);
    } catch (e) {
      console.log(`${host}${p || '/'} -> ERR ${e.message}`);
    }
  }
}

console.log('\n=== 4. okcat: DNS ===');
for (const h of ['ok213.top', 'www.ok213.top']) {
  try {
    console.log(h, await dns.resolve4(h));
  } catch (e) {
    console.log(h, 'DNS ERR', e.code || e.message);
  }
}
for (const u of ['http://ok213.top/', 'https://ok213.top/']) {
  try {
    const { buf, res } = await get(u);
    console.log(`${u} -> ${res.status} ${buf.length}B ${res.headers.get('content-type')}`);
  } catch (e) {
    console.log(`${u} -> ERR ${e.message}`);
  }
}
