import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function grab(label, url, headers = {}) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
      signal: AbortSignal.timeout(30000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const hex = buf.subarray(0, 16).toString('hex');
    console.log(`\n### ${label}`);
    console.log(`url=${url}`);
    console.log(`final=${res.url} status=${res.status} size=${buf.length} type=${res.headers.get('content-type')}`);
    console.log(`magic=${hex}`);
    if (buf.subarray(0, 2).toString() === 'BM') {
      console.log('(BMP image detected)');
      return;
    }
    console.log('body:', buf.toString('utf8').slice(0, 1200).replace(/\s*\n\s*/g, ' '));
  } catch (e) {
    console.log(`\n### ${label}\nurl=${url}\nERR ${e.name}: ${e.message}`);
  }
}

await grab('fanty /tv as-is', 'http://www.xn--sss604efuw.cc/tv');
await grab('fanty /tv json-accept', 'http://www.xn--sss604efuw.cc/tv', { Accept: 'application/json' });
await grab('fanty root', 'http://www.xn--sss604efuw.cc/');
await grab('fanty-alt /tv raw', 'http://fty.xxooo.cf/tv');
await grab('moyuer root', 'http://xn--ihqu10cn4c.xn--v4q818bf34b.com/');
await grab('okcat http', 'http://ok213.top/tv');
await grab('okcat https', 'https://ok213.top/tv');
await grab('okcat www', 'http://www.ok213.top/tv');
await grab('qist jsdelivr', 'https://cdn.jsdelivr.net/gh/qist/tvbox@master/jsm.json');
await grab('gao jsdelivr', 'https://cdn.jsdelivr.net/gh/gaotianliuyun/gao@master/js.json');
await grab('qist ghproxy', 'https://ghproxy.net/https://raw.githubusercontent.com/qist/tvbox/master/jsm.json');
