import fs from 'node:fs';
import path from 'node:path';
import { loadProject, parseConfig, codeMd5 } from './lib.mjs';

// End-to-end check of the mirror:
//   1. every config still parses (line comments allowed)
//   2. every rewritten repo reference resolves to a file that exists here
//   3. every ;md5; declared in a config matches the file it points at
//   4. every common/ file has a .md5 sidecar that matches, and no orphan sidecars
//   node tools/verify.mjs
// Exit code is non-zero when something is off.

const project = loadProject();
const RAW = project.rawPrefix;
const problems = [];
let refs = 0;
let declared = 0;

// configs = every mirrored source plus every merged output
const configs = [
  ...project.sources.map((s) => ({ label: s.folder, folder: s.folder, entry: s.entry })),
  ...(project.merges || []).map((m) => ({ label: path.basename(m.output, '.json'), file: m.output })),
];

for (const spec of configs) {
  const file = spec.file || path.join(spec.folder, spec.entry);
  if (!fs.existsSync(file)) {
    problems.push(`missing config ${file}`);
    continue;
  }
  let obj;
  try {
    obj = parseConfig(fs.readFileSync(file, 'utf8')).obj;
  } catch (e) {
    problems.push(`${file} does not parse: ${e.message}`);
    continue;
  }

  for (const m of JSON.stringify(obj).matchAll(/"(https:\/\/raw\.giteeusercontent\.com\/zcchu\/tvbox\/raw\/master\/[^"]+)"/g)) {
    const rel = m[1].slice(RAW.length);
    const [relPath, want] = rel.split(';md5;');
    // a "$$$"-joined value is a packed field list; only its first field is a path
    const first = relPath.split('$$$')[0];
    const p = first.split('/').join(path.sep);
    if (!fs.existsSync(p)) {
      problems.push(`${file}: ${first} does not exist`);
      continue;
    }
    refs++;
    if (want) {
      declared++;
      const got = codeMd5(fs.readFileSync(p));
      if (got !== want) problems.push(`${file}: ${first} md5 ${got} != declared ${want}`);
    }
  }
  console.log(
    `${spec.label.padEnd(6)} sites=${(obj.sites || []).length} lives=${(obj.lives || []).length} parses=${(obj.parses || []).length} rules=${(obj.rules || []).length}`,
  );
}

let snapshots = 0;
if (fs.existsSync('common')) {
  for (const dir of fs.readdirSync('common', { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join('common', dir.name))) {
      if (name.endsWith('.md5')) continue;
      snapshots++;
      const p = path.join('common', dir.name, name);
      const sidecar = p + '.md5';
      if (!fs.existsSync(sidecar)) {
        problems.push(`common/${dir.name}/${name} has no .md5 sidecar`);
        continue;
      }
      const got = codeMd5(fs.readFileSync(p));
      const recorded = fs.readFileSync(sidecar, 'utf8').trim();
      if (got !== recorded) problems.push(`common/${dir.name}/${name} md5 ${got} != sidecar ${recorded}`);
    }
    for (const name of fs.readdirSync(path.join('common', dir.name))) {
      if (!name.endsWith('.md5')) continue;
      const target = path.join('common', dir.name, name.slice(0, -4));
      if (!fs.existsSync(target)) problems.push(`common/${dir.name}/${name} has no file next to it`);
    }
  }
}

console.log(`\nrepo refs checked: ${refs} (declared md5: ${declared})`);
console.log(`common snapshots: ${snapshots}`);
if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('all checks passed');
