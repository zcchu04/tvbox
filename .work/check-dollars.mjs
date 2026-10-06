import fs from 'node:fs';

const PAIRS = [
  ['cvkkj/1.json', null],
  ['liucn/m.json', '.work/liucn-m.orig.json'],
  ['qist/jsm.json', '.work/qist-jsm.orig.json'],
  ['gao/js.json', '.work/gao-js.orig.json'],
  ['wex/wex.json', null],
];

for (const [cur, orig] of PAIRS) {
  const c = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : '';
  const o = orig && fs.existsSync(orig) ? fs.readFileSync(orig, 'utf8') : null;
  const dollars = (c.match(/\$\$\$/g) || []).length;
  const mangled = (c.match(/https?:\/[^/\s"]/g) || []).length;
  const origDollars = o === null ? '(no baseline)' : (o.match(/\$\$\$/g) || []).length;
  console.log(`${cur}: current $$$=${dollars} mangledSingleSlash=${mangled} | baseline $$$=${origDollars}`);
}
