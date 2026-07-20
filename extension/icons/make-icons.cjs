// Generates the extension's PNG icons (16/32/48/128) with no external deps.
//
// Draws the WorkSpace computer-monitor logo — the SAME mark as the web app's
// favicon (app/public/icons/icon.svg) — but COLOR-INVERTED: a gold (#e6a817)
// rounded-square tile with the monitor (screen frame, neck, perforated base)
// rendered in dark navy (#0e1730). The favicon is gold-on-navy; the extension
// is its exact inverse, navy-on-gold, so the two read as a matched pair.
//
// Pure-Node: a tiny software rasterizer + a zlib-backed PNG encoder. The monitor
// geometry is lifted verbatim from icon.svg (same path coordinates + group
// transform), so this stays faithful if the favicon ever changes.
// Re-run with:  node extension/icons/make-icons.cjs
//
// This file is a build helper for the icons and is NOT shipped/loaded by the
// extension at runtime — only the generated *.png files are.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ----------------------------- PNG encoder ---------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----------------------------- mini canvas ---------------------------------
function makeCanvas(size) {
  const buf = Buffer.alloc(size * size * 4, 0); // transparent
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // src-over alpha blend
    const sa = a / 255;
    const da = buf[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / oa);
    buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
    buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
    buf[i + 3] = Math.round(oa * 255);
  };
  return { buf, size, set };
}

// Coverage-based supersampled fill: paint(px,py) -> [r,g,b,a] | null
function fillSS(cv, paint, ss) {
  ss = ss || 4;
  const n = ss * ss;
  for (let y = 0; y < cv.size; y++) {
    for (let x = 0; x < cv.size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        hit = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const c = paint(px, py);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += c[3];
            hit++;
          }
        }
      }
      if (hit) cv.set(x, y, r / hit, g / hit, b / hit, a / n);
    }
  }
}

// --------------------------- colors (inverse of favicon) -------------------
const GOLD = [230, 168, 23]; // #e6a817 — tile background (was the favicon's mark)
const NAVY = [14, 23, 48]; //   #0e1730 — the monitor (was the favicon's tile)

// ------------------------- geometry (from icon.svg) ------------------------
// The favicon draws its mark inside a group transformed by
//   translate(60 60) scale(1.02) translate(-50 -49.75)
// within a 120x120 viewBox. We test each pixel by undoing that transform back
// to the path's local coordinates, then checking the original shapes.

const NECK = [
  [44, 64],
  [56, 64],
  [60, 75],
  [40, 75],
];
const BASE = [
  [23, 75],
  [77, 75],
  [87, 94],
  [13, 94],
];

// Perforations punched out of the base (even-odd holes in the SVG). Each circle
// in the path is "M sx sy a1.4 1.4 ..." → centre = (sx + 1.4, sy), radius 1.4.
const DOT_R = 1.4;
const DOT_ROWS = [
  { y: 79, sx: [23.99, 32.2, 40.4, 48.6, 56.8, 65, 73.21] },
  { y: 83, sx: [21.89, 29.52, 37.15, 44.78, 52.42, 60.05, 67.68, 75.31] },
  { y: 87, sx: [19.78, 26.99, 34.19, 41.4, 48.6, 55.8, 63.01, 70.21, 77.42] },
  { y: 91, sx: [17.68, 24.55, 31.42, 38.29, 45.16, 52.04, 58.91, 65.78, 72.65, 79.52] },
];
const DOTS = [];
for (const row of DOT_ROWS) for (const sx of row.sx) DOTS.push([sx + DOT_R, row.y]);

// Signed distance from a point to a rounded-rectangle's outline (centerline).
function sdRoundRect(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    const hits = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hits) inside = !inside;
  }
  return inside;
}

function inAnyDot(px, py) {
  for (const [cx, cy] of DOTS) {
    const dx = px - cx;
    const dy = py - cy;
    if (dx * dx + dy * dy <= DOT_R * DOT_R) return true;
  }
  return false;
}

/** Is this local-space point part of the monitor mark (screen ∪ neck ∪ base−dots)? */
function isMonitor(lx, ly) {
  // Screen: a rounded-rect OUTLINE (x 16..84, y 10..64, r 12) stroked at width 9.
  if (Math.abs(sdRoundRect(lx, ly, 50, 37, 34, 27, 12)) <= 4.5) return true;
  // Neck: the small trapezoid joining screen to base.
  if (pointInPoly(lx, ly, NECK)) return true;
  // Base: the wide trapezoid foot, with its perforations knocked out.
  if (pointInPoly(lx, ly, BASE) && !inAnyDot(lx, ly)) return true;
  return false;
}

// ------------------------------- artwork -----------------------------------
function drawIcon(size) {
  const cv = makeCanvas(size);
  const k = size / 120; // viewBox → pixels
  const toV = (p) => p / k; // pixels → viewBox

  // Gold rounded-square tile (viewBox rect 0,0,120,120 rx=26).
  fillSS(
    cv,
    (px, py) => {
      const vx = toV(px);
      const vy = toV(py);
      if (sdRoundRect(vx, vy, 60, 60, 60, 60, 26) > 0) return null;
      return [GOLD[0], GOLD[1], GOLD[2], 255];
    },
    4
  );

  // Navy monitor on top. Undo the group transform (viewBox → local path coords).
  fillSS(
    cv,
    (px, py) => {
      const vx = toV(px);
      const vy = toV(py);
      const lx = (vx - 60) / 1.02 + 50;
      const ly = (vy - 60) / 1.02 + 49.75;
      if (isMonitor(lx, ly)) return [NAVY[0], NAVY[1], NAVY[2], 255];
      return null;
    },
    4
  );

  return encodePng(size, size, cv.buf);
}

// ------------------------------- emit --------------------------------------
const outDir = __dirname;
for (const size of [16, 32, 48, 128]) {
  const png = drawIcon(size);
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log('wrote', file, png.length, 'bytes');
}
