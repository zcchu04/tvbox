import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadProject } from './lib.mjs';

// Wrap a config in an image so what sits on the wire (and in gitee's blob view)
// is a picture, not JSON. Same layout the 饭太硬源 uses:
//
//   <valid PNG> + <8 alnum> + "**" + base64(utf8 of the config)
//
// The client reads it back in Decoder.getJson: Json.valid() fails on the binary
// head, then the "**" branch runs base64() -> extract() -> Base64.decode().
// The token is only a marker; base64 never contains '*', so the first
// [A-Za-z0-9]{8}\*\* in the file is always ours.

const TOKEN = 'kR7mQv2X';
const MARK = `${TOKEN}**`;
const MARKER_RE = /[A-Za-z0-9]{8}\*\*/;
const W = 256;
const H = 192;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function makePng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(H * (1 + W * 3));
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      const t = y / (H - 1);
      const s = x / (W - 1);
      raw[o++] = Math.round(18 + 40 * t + 24 * s);
      raw[o++] = Math.round(84 + 96 * t);
      raw[o++] = Math.round(150 + 70 * (1 - t));
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** walk the chunks, verify every CRC and the inflated pixel data; returns the image part length */
function checkPng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('bad PNG signature');
  const idat = [];
  let off = 8;
  let end = -1;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) throw new Error(`bad CRC in ${type}`);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') {
      end = off;
      break;
    }
  }
  if (end < 0) throw new Error('missing IEND');
  if (zlib.inflateSync(Buffer.concat(idat)).length !== H * (1 + W * 3)) throw new Error('unexpected pixel data size');
  return end;
}

function encode(text) {
  const img = makePng();
  const hit = img.toString('utf8').match(MARKER_RE);
  if (hit) throw new Error(`image bytes already contain a marker at ${img.toString('utf8').indexOf(hit[0])}`);
  return Buffer.concat([img, Buffer.from(MARK + Buffer.from(text, 'utf8').toString('base64'), 'latin1')]);
}

/** the client's path, byte for byte: body().string() is UTF-8, then extract() + Base64.decode() */
function decode(buf) {
  const text = buf.toString('utf8');
  const m = text.match(MARKER_RE);
  if (!m) throw new Error('no ** marker');
  return Buffer.from(text.substring(text.indexOf(m[0]) + 10).replace(/[\r\n]/g, ''), 'base64').toString('utf8');
}

function roundTrip(dest, text) {
  const png = encode(text);
  const imgLen = checkPng(png);
  const imgStr = png.subarray(0, imgLen).toString('utf8');
  if (png.toString('utf8').indexOf(MARK) !== imgStr.length) throw new Error('marker is not the first one in the file');
  if (decode(png) !== text) throw new Error('decoded payload differs from the source text');
  fs.writeFileSync(dest, png);
  return { imgLen, payload: png.length - imgLen, total: png.length };
}

const project = loadProject();
const jobs = [
  ...project.sources.map((s) => path.join(s.folder, s.entry)),
  ...project.merges.map((m) => m.output),
];

console.log('file'.padEnd(20) + 'image'.padStart(8) + 'base64'.padStart(10) + 'total'.padStart(10));
for (const rel of jobs) {
  const png = rel.replace(/\.json$/, '.png');
  const r = roundTrip(png, fs.readFileSync(rel, 'utf8'));
  console.log(png.padEnd(20) + String(r.imgLen).padStart(8) + String(r.payload).padStart(10) + String(r.total).padStart(10));
}

// source.json stays as it is; source.png is the same index with every mirrored
// config repointed at its .png copy, so a client can be handed the image world.
const remap = [
  ...project.sources.map((s) => path.join(s.folder, s.entry)),
  ...project.merges.map((m) => m.output),
].map((rel) => [project.rawPrefix + rel.split(path.sep).join('/'), project.rawPrefix + rel.split(path.sep).join('/').replace(/\.json$/, '.png')]);

let index = fs.readFileSync('source.json', 'utf8');
let swapped = 0;
for (const [from, to] of remap) {
  if (!index.includes(from)) continue;
  index = index.split(from).join(to);
  swapped++;
}
if (swapped !== remap.length) throw new Error(`source.json: expected ${remap.length} mirror urls, rewrote ${swapped}`);
const left = index.match(/\.json"/g);
if (left) throw new Error(`source.json still points at ${left.length} .json url(s)`);

const r = roundTrip('source.png', index);
console.log('source.png'.padEnd(20) + String(r.imgLen).padStart(8) + String(r.payload).padStart(10) + String(r.total).padStart(10) + `  ${swapped} urls repointed`);
