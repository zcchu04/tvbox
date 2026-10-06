import dns from 'node:dns';
import { Resolver } from 'node:dns/promises';

for (const host of ['d.kstore.space', '9280.kstore.space', 'ghfast.top', 'github.moeyy.xyz']) {
  for (const servers of [['223.5.5.5'], ['8.8.8.8'], ['1.1.1.1']]) {
    const r = new Resolver();
    r.setServers(servers);
    try {
      const a = await r.resolve4(host);
      console.log(`${host} via ${servers[0]} -> ${a.join(', ')}`);
      break;
    } catch (e) {
      console.log(`${host} via ${servers[0]} -> ERR ${e.code}`);
    }
  }
}
