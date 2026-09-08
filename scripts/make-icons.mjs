// PWA 아이콘 생성 — 외부 라이브러리 없이 RGBA 버퍼를 직접 그려 PNG 로 인코딩한다.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../public/icons");
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const GRAD = [
  [0.0, [91, 124, 250]],
  [0.38, [123, 92, 246]],
  [0.68, [179, 79, 220]],
  [1.0, [236, 72, 153]],
];

function gradAt(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < GRAD.length; i++) {
    if (t <= GRAD[i][0]) {
      const [t0, c0] = GRAD[i - 1];
      const [t1, c1] = GRAD[i];
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * k);
    }
  }
  return GRAD[GRAD.length - 1][1];
}

/** 점이 다각형 안인지 */
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function draw(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 3; // 슈퍼샘플링
  const inset = maskable ? size * 0.14 : 0;
  const r = maskable ? size * 0.5 : size * 0.225; // 라운드 사각형 반경

  // 화살표(내비 커서) 좌표 — 0..1 정규화
  const cx = 0.5,
    cy = 0.5;
  const scale = maskable ? 0.2 : 0.27;
  const arrow = [
    [cx, cy - 1.15 * scale],
    [cx + 0.86 * scale, cy + 1.0 * scale],
    [cx, cy + 0.5 * scale],
    [cx - 0.86 * scale, cy + 1.0 * scale],
  ].map(([x, y]) => [x * size, y * size]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgA = 0;
      let fgA = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          // 라운드 사각형 SDF
          const hw = size / 2 - inset;
          const qx = Math.abs(px - size / 2) - (hw - r);
          const qy = Math.abs(py - size / 2) - (hw - r);
          const d =
            Math.min(Math.max(qx, qy), 0) +
            Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
            r;
          if (d <= 0) bgA++;
          if (inPoly(px, py, arrow)) fgA++;
        }
      }
      const n = S * S;
      const i = (y * size + x) * 4;
      if (bgA === 0) continue;
      const t = (x / size) * 0.75 + (y / size) * 0.25;
      const [gr, gg, gb] = gradAt(t);
      const a = bgA / n;
      const f = fgA / n;
      rgba[i] = Math.round(gr * (1 - f) + 255 * f);
      rgba[i + 1] = Math.round(gg * (1 - f) + 255 * f);
      rgba[i + 2] = Math.round(gb * (1 - f) + 255 * f);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePNG(size, size, rgba);
}

for (const [name, size, maskable] of [
  ["icon-180.png", 180, false],
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-512-maskable.png", 512, true],
]) {
  writeFileSync(resolve(OUT, name), draw(size, maskable));
  console.log("wrote", name, size);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#5b7cfa"/><stop offset="38%" stop-color="#7b5cf6"/>
    <stop offset="68%" stop-color="#b34fdc"/><stop offset="100%" stop-color="#ec4899"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path d="M32 15 L47 47 L32 40 L17 47 Z" fill="#fff"/>
</svg>`;
writeFileSync(resolve(OUT, "icon.svg"), svg);
console.log("wrote icon.svg");
