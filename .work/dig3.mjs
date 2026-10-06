import dns from 'node:dns/promises';

const UAS = {
  'tvbox-okhttp': 'okhttp/3.12.0',
  'okhttp381': 'okhttp/3.8.1',
  'empty': '',
};

async function tryUrl(label, url, ua) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: ua ? { 'User-Agent': ua } : {},
      signal: AbortSignal.timeout(25000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.toString('utf8').slice(0, 60).replace(/\s+/g, ' ');
    console.log(`${label} [${ua || 'no-ua'}] -> ${res.status} ${buf.length}B ${res.headers.get('content-type')} :: ${head}`);
    return buf;
  } catch (e) {
    console.log(`${label} [${ua || 'no-ua'}] -> ERR ${e.message}`);
  }
}

console.log('=== fanty with tvbox UAs ===');
for (const [n, ua] of Object.entries(UAS)) {
  await tryUrl('www.xn--sss604efuw.cc/tv', 'http://www.xn--sss604efuw.cc/tv', ua);
}
console.log('--- redirect behaviour (manual) ---');
for (const u of ['http://www.xn--sss604efuw.cc/tv', 'http://fty.xxooo.cf/tv']) {
  try {
    const res = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': 'okhttp/3.12.0' }, signal: AbortSignal.timeout(25000) });
    console.log(`${u} -> ${res.status} location=${res.headers.get('location')} type=${res.headers.get('content-type')}`);
  } catch (e) {
    console.log(`${u} -> ERR ${e.message}`);
  }
}
console.log('--- alt host with tvbox UA ---');
for (const [n, ua] of Object.entries(UAS)) {
  await tryUrl('fty.xxooo.cf/tv', 'http://fty.xxooo.cf/tv', ua);
}

console.log('\n=== moyuer with tvbox UA ===');
await tryUrl('moyuer /tv', 'http://xn--ihqu10cn4c.xn--v4q818bf34b.com/tv', 'okhttp/3.12.0');

console.log('\n=== okcat DNS record types ===');
const host = 'ok213.top';
for (const t of ['resolve4', 'resolve6', 'resolveCname', 'resolveNs', 'resolveMx']) {
  try {
    console.log(t, JSON.stringify(await dns[t](host)));
  } catch (e) {
    console.log(t, 'ERR', e.code || e.message);
  }
}
