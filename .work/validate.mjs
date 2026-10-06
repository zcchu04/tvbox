import fs from 'node:fs';

const DEAD = [
  'd.kstore.space',
  'ghfast.top',
  'github.moeyy.xyz',
  '肥猫.live',
  'myd666.tv',
  'taopianapi.com',
  'up.mediy.cn',
];

for (const [f, label] of [
  ['cvkkj/1.json', 'cvkkj'],
  ['liucn/m.json', 'liucn'],
  ['wex/wex.json', 'wex'],
  ['qist/jsm.json', 'qist'],
  ['gao/js.json', 'gao'],
]) {
  if (!fs.existsSync(f)) {
    console.log(`${label.padEnd(6)} (missing)`);
    continue;
  }
  const t = fs.readFileSync(f, 'utf8');
  try {
    const o = JSON.parse(t.split(/\r?\n/).filter((l) => !l.trim().startsWith('\u002f\u002f')).join('\n'));
    const commentLines = t.split(/\r?\n/).filter((l) => l.trim().startsWith('\u002f\u002f')).length;
    const leftover = (t.match(/"(?:\.\.?\/)/g) || []).length;
    console.log(
      `${label.padEnd(6)} OK  sites=${(o.sites || []).length} lives=${(o.lives || []).length} commentLines=${commentLines} leftoverRelative=${leftover}`,
    );
  } catch (e) {
    console.log(`${label.padEnd(6)} PARSE FAIL ${e.message}`);
  }
  for (const d of DEAD) if (t.includes(d)) console.log(`   !! still contains ${d}`);
}
