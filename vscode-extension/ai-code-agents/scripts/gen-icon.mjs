#!/usr/bin/env node
// Generate a 128x128 PNG icon for the VS Code extension
import { createWriteStream } from "fs";
import { deflateSync } from "zlib";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, "..", "media", "icon.png");

const W = 128, H = 128;

// RGBA pixel data
const data = new Uint8Array(W * H * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = a;
}

function blendPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  const alpha = a / 255;
  data[i]   = Math.round(data[i]   * (1 - alpha) + r * alpha);
  data[i+1] = Math.round(data[i+1] * (1 - alpha) + g * alpha);
  data[i+2] = Math.round(data[i+2] * (1 - alpha) + b * alpha);
  data[i+3] = Math.min(255, data[i+3] + a);
}

function drawCircle(cx, cy, r, r2, g2, b2, a2, fill = false) {
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (fill) {
        if (dist <= r) blendPixel(x, y, r2, g2, b2, a2);
      } else {
        const edge = Math.abs(dist - r);
        if (edge <= 1.2) blendPixel(x, y, r2, g2, b2, Math.round(a2 * Math.max(0, 1 - edge)));
      }
    }
  }
}

function drawRect(x1, y1, x2, y2, r, g, b, a) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      blendPixel(x, y, r, g, b, a);
    }
  }
}

// Background: dark navy
drawCircle(64, 64, 62, 26, 31, 46, 255, true);

// Outer ring: cyan
drawCircle(64, 64, 58, 0, 229, 204, 100);

// Shield shape
function drawShield(cx, cy, w, h, r, g, b, a, fill = true) {
  const top = cy - h / 2;
  const bot = cy + h / 2;
  for (let py = Math.floor(top); py <= Math.ceil(bot); py++) {
    const t = (py - top) / h;
    let halfW;
    if (t < 0.3) {
      halfW = (w / 2) * (0.7 + t);
    } else if (t < 0.75) {
      halfW = w / 2;
    } else {
      halfW = (w / 2) * (1 - (t - 0.75) / 0.25 * 0.9);
    }
    for (let px = Math.floor(cx - halfW); px <= Math.ceil(cx + halfW); px++) {
      const edgeX = Math.min(px - (cx - halfW), (cx + halfW) - px);
      const edgeY = Math.min(py - top, bot - py);
      const edge = Math.min(edgeX, edgeY);
      if (fill) {
        blendPixel(px, py, r, g, b, a);
      } else if (edge <= 1.5) {
        blendPixel(px, py, r, g, b, Math.round(a * Math.max(0, edge / 1.5)));
      }
    }
  }
}

// Shield fill
drawShield(64, 64, 60, 68, 10, 20, 20, 240, true);

// Shield border cyan
drawShield(64, 64, 60, 68, 0, 229, 204, 200, false);

// Code brackets: < / >
function drawText(pixels) {
  // < bracket at x=30, / at x=52, > at x=72 — y centered around 68
  // Simple pixel font for </>
  const glyphs = {
    '<': [
      [0,0,0,1],[0,0,1,0],[0,1,0,0],[1,0,0,0],
      [0,1,0,0],[0,0,1,0],[0,0,0,1]
    ],
    '/': [
      [0,0,1],[0,0,1],[0,1,0],[0,1,0],[1,0,0],[1,0,0]
    ],
    '>': [
      [1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],
      [0,0,1,0],[0,1,0,0],[1,0,0,0]
    ]
  };

  // Draw each char larger (scale 5)
  const scale = 5;
  const chars = ['<', '/', '>'];
  const startX = [30, 52, 68];

  for (let ci = 0; ci < chars.length; ci++) {
    const glyph = glyphs[chars[ci]];
    const ox = startX[ci];
    const oy = 44;
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col]) {
          const px = ox + col * scale;
          const py = oy + row * scale;
          drawRect(px, py, px + scale - 1, py + scale - 1, 0, 229, 204, 230);
        }
      }
    }
  }
}

drawText();

// Small magnifier (scan indicator) top-left
drawCircle(26, 26, 9, 0, 229, 204, 180);
drawCircle(26, 26, 5, 0, 180, 160, 150);
// Handle
for (let i = 0; i < 6; i++) {
  blendPixel(32 + i, 32 + i, 0, 229, 204, 200);
  blendPixel(33 + i, 32 + i, 0, 229, 204, 150);
}

// Corner dots
const dots = [[20, 64], [108, 64], [64, 20], [64, 108]];
for (const [dx, dy] of dots) {
  drawCircle(dx, dy, 3, 0, 229, 204, 180, true);
}

// Build PNG
function crc32(buf) {
  let crc = -1;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcVal = Buffer.allocUnsafe(4);
  crcVal.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crcVal]);
}

// IHDR
const ihdr = Buffer.allocUnsafe(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// IDAT - raw scanlines with filter byte 0
const raw = Buffer.allocUnsafe(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter None
  for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 4;
    const di = y * (1 + W * 3) + 1 + x * 3;
    // Blend with dark background
    const alpha = data[si + 3] / 255;
    raw[di]     = Math.round(data[si]     * alpha + 26  * (1 - alpha));
    raw[di + 1] = Math.round(data[si + 1] * alpha + 31  * (1 - alpha));
    raw[di + 2] = Math.round(data[si + 2] * alpha + 46  * (1 - alpha));
  }
}

const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

import { writeFileSync } from "fs";
writeFileSync(OUT, png);
console.log(`Icon written to ${OUT} (${png.length} bytes)`);
