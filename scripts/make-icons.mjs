// PWA 아이콘 + iOS 스플래시 생성 — 외부 라이브러리 없이 RGBA 버퍼를 직접 그려 PNG 로 인코딩한다.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = resolve(HERE, "../public/icons");
const SPLASH = resolve(HERE, "../public/splash");
mkdirSync(ICONS, { recursive: true });
mkdirSync(SPLASH, { recursive: true });

/* ------------------------------------------------------------------ */
/* PNG 인코더                                                          */
/* ------------------------------------------------------------------ */

function crc32(buf) {
  let c;
  const table =
    crc32.table ??
    (crc32.table = (() => {
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

/* ------------------------------------------------------------------ */
/* 그리기                                                              */
/* ------------------------------------------------------------------ */

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

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * rgba 버퍼의 (ox, oy) 위치에 한 변이 `size` 인 로고를 그린다.
 * radiusRatio 0.5 면 원형(마스커블용), 0.225 면 iOS 스타일 라운드 사각형.
 */
function drawLogo(rgba, W, ox, oy, size, radiusRatio = 0.225, arrowScale = 0.27) {
  const S = 3;
  const r = size * radiusRatio;
  const cx = 0.5;
  const cy = 0.5;
  const arrow = [
    [cx, cy - 1.15 * arrowScale],
    [cx + 0.86 * arrowScale, cy + 1.0 * arrowScale],
    [cx, cy + 0.5 * arrowScale],
    [cx - 0.86 * arrowScale, cy + 1.0 * arrowScale],
  ].map(([x, y]) => [x * size, y * size]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgA = 0;
      let fgA = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          const hw = size / 2;
          const qx = Math.abs(px - size / 2) - (hw - r);
          const qy = Math.abs(py - size / 2) - (hw - r);
          const d =
            Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
          if (d <= 0) bgA++;
          if (inPoly(px, py, arrow)) fgA++;
        }
      }
      const n = S * S;
      if (bgA === 0) continue;
      const gx = ox + x;
      const gy = oy + y;
      const i = (gy * W + gx) * 4;
      if (i < 0 || i + 3 >= rgba.length) continue;

      const t = (x / size) * 0.75 + (y / size) * 0.25;
      const [gr, gg, gb] = gradAt(t);
      const a = bgA / n;
      const f = fgA / n;
      const cr = Math.round(gr * (1 - f) + 255 * f);
      const cg = Math.round(gg * (1 - f) + 255 * f);
      const cb = Math.round(gb * (1 - f) + 255 * f);

      // 기존 배경 위에 알파 합성
      const br = rgba[i];
      const bg2 = rgba[i + 1];
      const bb = rgba[i + 2];
      rgba[i] = Math.round(cr * a + br * (1 - a));
      rgba[i + 1] = Math.round(cg * a + bg2 * (1 - a));
      rgba[i + 2] = Math.round(cb * a + bb * (1 - a));
      rgba[i + 3] = Math.max(rgba[i + 3], Math.round(a * 255));
    }
  }
}

function makeIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = maskable ? Math.round(size * 0.14) : 0;
  drawLogo(
    rgba,
    size,
    inset,
    inset,
    size - inset * 2,
    maskable ? 0.5 : 0.225,
    maskable ? 0.2 : 0.27
  );
  return encodePNG(size, size, rgba);
}

/** iOS 실행화면 — 앱 배경색 위에 로고 하나 */
function makeSplash(w, h) {
  const rgba = Buffer.alloc(w * h * 4);
  const [br, bg, bb] = [0x0a, 0x0a, 0x0d];
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = br;
    rgba[i * 4 + 1] = bg;
    rgba[i * 4 + 2] = bb;
    rgba[i * 4 + 3] = 255;
  }
  const size = Math.round(Math.min(w, h) * 0.26);
  drawLogo(rgba, w, Math.round((w - size) / 2), Math.round((h - size) / 2), size);
  return encodePNG(w, h, rgba);
}

/* ------------------------------------------------------------------ */

for (const [name, size, maskable] of [
  ["icon-180.png", 180, false],
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-512-maskable.png", 512, true],
]) {
  writeFileSync(resolve(ICONS, name), makeIcon(size, maskable));
  console.log("icon", name);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#5b7cfa"/><stop offset="38%" stop-color="#7b5cf6"/>
    <stop offset="68%" stop-color="#b34fdc"/><stop offset="100%" stop-color="#ec4899"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path d="M32 15 L47 47 L32 40 L17 47 Z" fill="#fff"/>
</svg>`;
writeFileSync(resolve(ICONS, "icon.svg"), svg);
console.log("icon icon.svg");

// 아이폰 실행화면 (세로). 기기별 픽셀 해상도.
const SPLASHES = [
  [750, 1334, "iPhone SE / 8"],
  [828, 1792, "iPhone XR / 11"],
  [1125, 2436, "iPhone X / XS / 11 Pro"],
  [1170, 2532, "iPhone 12 / 13 / 14"],
  [1179, 2556, "iPhone 14 Pro / 15 / 16"],
  [1284, 2778, "iPhone 12/13 Pro Max"],
  [1290, 2796, "iPhone 14 Pro Max / 15 Pro Max"],
  [1206, 2622, "iPhone 16 Pro"],
  [1320, 2868, "iPhone 16 Pro Max"],
];
for (const [w, h, label] of SPLASHES) {
  writeFileSync(resolve(SPLASH, `splash-${w}x${h}.png`), makeSplash(w, h));
  console.log("splash", `${w}x${h}`, label);
}
