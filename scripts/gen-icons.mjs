#!/usr/bin/env node
/**
 * Renders the MixDeck app icon (two overlapping records on a dark tile) into the PNGs and SVG used by the
 * web manifest, the iOS Home Screen and the favicon. Dependency-free: a tiny shape rasteriser with 4×4
 * supersampling plus a hand-rolled PNG encoder (RGBA, deflate via node:zlib). Run with `npm run icons`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'icons');

const BG = '#0b0d12';
const CYAN = '#4fd1ff';
const PINK = '#ff6fae';

/** Supersamples per axis (4×4 = 16 per pixel). */
const SS = 4;
/** Corner radius of the tile for "any" icons; maskable / apple-touch are full-bleed (the OS rounds them). */
const TILE_RADIUS = 0.2;
/**
 * Artwork scale for maskable icons. At 1 the records reach 0.388 of the size from the centre; 0.88 brings
 * that to 0.341, well inside the 0.4-radius safe zone (central 80 %).
 */
const MASKABLE_ART = 0.88;

const TARGETS = [
  { file: 'apple-touch-icon-180.png', size: 180, fullBleed: true, art: 1 },
  { file: 'icon-192.png', size: 192, fullBleed: false, art: 1 },
  { file: 'icon-512.png', size: 512, fullBleed: false, art: 1 },
  { file: 'icon-512-maskable.png', size: 512, fullBleed: true, art: MASKABLE_ART },
];

/** Paint-ordered layers in a 0..1 space. Every layer is opaque, so the topmost hit decides a sample. */
function design({ fullBleed, art }) {
  const at = (v) => 0.5 + (v - 0.5) * art;
  const r = 0.24 * art;
  const layers = [{ kind: 'tile', radius: fullBleed ? 0 : TILE_RADIUS, color: BG }];
  const records = [
    { cx: at(0.385), cy: at(0.44), color: CYAN },
    { cx: at(0.615), cy: at(0.56), color: PINK },
  ];
  records.forEach(({ cx, cy, color }, i) => {
    // A thin background-coloured gap makes the second record read as lying on top of the first.
    if (i > 0) layers.push({ kind: 'circle', cx, cy, r: r + 0.018 * art, color: BG });
    layers.push({ kind: 'circle', cx, cy, r, color });
    const groove = mix(color, BG, 0.3);
    layers.push({ kind: 'ring', cx, cy, r: r * 0.8, width: r * 0.04, color: groove });
    layers.push({ kind: 'ring', cx, cy, r: r * 0.6, width: r * 0.04, color: groove });
    layers.push({ kind: 'circle', cx, cy, r: r * 0.32, color: mix(color, '#ffffff', 0.35) });
    layers.push({ kind: 'circle', cx, cy, r: r * 0.09, color: BG });
  });
  return layers;
}

function covers(layer, u, v) {
  switch (layer.kind) {
    case 'tile': {
      const inner = 0.5 - layer.radius;
      const dx = Math.abs(u - 0.5) - inner;
      const dy = Math.abs(v - 0.5) - inner;
      return dx <= 0 || dy <= 0 || dx * dx + dy * dy <= layer.radius * layer.radius;
    }
    case 'circle':
      return (u - layer.cx) ** 2 + (v - layer.cy) ** 2 <= layer.r * layer.r;
    case 'ring':
      return Math.abs(Math.hypot(u - layer.cx, v - layer.cy) - layer.r) <= layer.width / 2;
    default:
      throw new Error(`unknown layer ${layer.kind}`);
  }
}

/** Rasterises layers to straight (non-premultiplied) RGBA at size×size with SS×SS supersampling. */
function render(size, layers) {
  const rgb = layers.map((l) => hexToRgb(l.color));
  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          for (let i = layers.length - 1; i >= 0; i--) {
            if (!covers(layers[i], u, v)) continue;
            r += rgb[i][0];
            g += rgb[i][1];
            b += rgb[i][2];
            hits++;
            break;
          }
        }
      }
      const o = (y * size + x) * 4;
      if (hits === 0) continue;
      out[o] = Math.round(r / hits);
      out[o + 1] = Math.round(g / hits);
      out[o + 2] = Math.round(b / hits);
      out[o + 3] = Math.round((255 * hits) / n);
    }
  }
  return out;
}

/** Same layers as SVG on a 512 grid (used as the favicon). */
function toSvg(layers) {
  const S = 512;
  const f = (v) => String(Math.round(v * S * 100) / 100);
  const body = layers.map((l) => {
    switch (l.kind) {
      case 'tile':
        return `<rect width="${S}" height="${S}" rx="${f(l.radius)}" fill="${l.color}"/>`;
      case 'circle':
        return `<circle cx="${f(l.cx)}" cy="${f(l.cy)}" r="${f(l.r)}" fill="${l.color}"/>`;
      case 'ring':
        return `<circle cx="${f(l.cx)}" cy="${f(l.cy)}" r="${f(l.r)}" fill="none" stroke="${l.color}" stroke-width="${f(l.width)}"/>`;
      default:
        throw new Error(`unknown layer ${l.kind}`);
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">\n  ${body.join('\n  ')}\n</svg>\n`;
}

// --- PNG encoding -------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- colour helpers -----------------------------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Mixes `a` toward `b` by t (0..1), returned as #rrggbb. */
function mix(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t];
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

// --- main ---------------------------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, fullBleed, art } of TARGETS) {
  writeFileSync(join(OUT_DIR, file), encodePng(size, render(size, design({ fullBleed, art }))));
  console.log(`icons/${file}  ${size}×${size}${fullBleed ? '  full-bleed' : ''}`);
}
writeFileSync(join(OUT_DIR, 'icon.svg'), toSvg(design({ fullBleed: false, art: 1 })));
console.log('icons/icon.svg');
