import type { ElevPoint, ElevProfile, LngLat } from "../types";
import { distance, pointAtDistance, pathLength } from "../lib/geo";

/**
 * 고도(DEM) 샘플러.
 * AWS Open Data 의 Terrain Tiles(terrarium 인코딩, 256px, CORS 열림)를 직접 받아
 * 캔버스로 픽셀을 읽어 해발고도를 뽑는다. 지도의 3D 지형과 같은 소스라
 * 화면에 보이는 언덕과 프로필 그래프가 어긋나지 않는다.
 *
 *   elevation(m) = (R * 256 + G + B / 256) - 32768
 */

const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

export const DEM_ZOOM = 14;
const TILE_SIZE = 256;

const cache = new Map<string, Promise<Float32Array | null>>();

function lngLatToPixel(lng: number, lat: number, z: number): { px: number; py: number } {
  const scale = TILE_SIZE * Math.pow(2, z);
  const x = ((lng + 180) / 360) * scale;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { px: x, py: y };
}

function loadTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const p = (async (): Promise<Float32Array | null> => {
    try {
      const res = await fetch(TILE_URL(z, x, y), { mode: "cors" });
      if (!res.ok) return null;
      const blob = await res.blob();

      // 중요: 브라우저가 PNG 에 컬러 프로파일 변환을 걸면 픽셀값이 바뀌어
      // 고도가 통째로 망가진다. colorSpaceConversion 을 꺼서 원본 바이트를 그대로 읽는다.
      const bmp = await createImageBitmap(blob, {
        colorSpaceConversion: "none",
        premultiplyAlpha: "none",
      });

      const cv = document.createElement("canvas");
      cv.width = TILE_SIZE;
      cv.height = TILE_SIZE;
      const ctx = cv.getContext("2d", {
        willReadFrequently: true,
        colorSpace: "srgb",
      }) as CanvasRenderingContext2D | null;
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, TILE_SIZE, TILE_SIZE);
      bmp.close?.();

      const d = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE, { colorSpace: "srgb" }).data;
      const out = new Float32Array(TILE_SIZE * TILE_SIZE);
      for (let i = 0, j = 0; i < out.length; i++, j += 4) {
        out[i] = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
      }
      return out;
    } catch {
      return null;
    }
  })();

  cache.set(key, p);
  return p;
}

/** 한 지점의 해발고도(m). 타일을 못 받으면 null. */
export async function elevationAt(coord: LngLat, z = DEM_ZOOM): Promise<number | null> {
  const { px, py } = lngLatToPixel(coord[0], coord[1], z);
  return sampleBilinear(px, py, z);
}

async function sampleBilinear(px: number, py: number, z: number): Promise<number | null> {
  const x0 = Math.floor(px - 0.5);
  const y0 = Math.floor(py - 0.5);
  const fx = px - 0.5 - x0;
  const fy = py - 0.5 - y0;

  const vals: number[] = [];
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const v = await sampleNearest(x0 + dx, y0 + dy, z);
      if (v === null) return null;
      vals.push(v);
    }
  }
  const top = vals[0] * (1 - fx) + vals[1] * fx;
  const bot = vals[2] * (1 - fx) + vals[3] * fx;
  return top * (1 - fy) + bot * fy;
}

async function sampleNearest(px: number, py: number, z: number): Promise<number | null> {
  const max = TILE_SIZE * Math.pow(2, z);
  const cx = ((px % max) + max) % max;
  const cy = Math.max(0, Math.min(max - 1, py));
  const tx = Math.floor(cx / TILE_SIZE);
  const ty = Math.floor(cy / TILE_SIZE);
  const data = await loadTile(z, tx, ty);
  if (!data) return null;
  const ix = Math.floor(cx) % TILE_SIZE;
  const iy = Math.floor(cy) % TILE_SIZE;
  return data[iy * TILE_SIZE + ix];
}

/**
 * 표면고도(DSM) -> 지면고도(DTM) 근사.
 *
 * terrarium 타일의 원본은 SRTM 계열이라 "지표면"이 아니라 "표면"이다.
 * 즉 고층빌딩·숲이 그대로 언덕으로 찍힌다(강남 테헤란로가 129m 로 나오는 이유).
 * 그래서:
 *   1) 일정 구간의 최솟값(하부 포락선)을 구하고
 *   2) 그보다 눈에 띄게 높이 솟은 표본만 "건물에 얹힌 값"으로 보고 버린 뒤
 *   3) 남은 표본을 이어 붙여 지면 곡선을 만든다.
 * 최솟값으로 통째로 갈아끼우지 않기 때문에 실제 언덕(남산 오르막 등)은 그대로 남는다.
 */
function toGround(raw: number[], windowRadius: number): number[] {
  const n = raw.length;

  const floorLine = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let mn = Infinity;
    const a = Math.max(0, i - windowRadius);
    const b = Math.min(n - 1, i + windowRadius);
    for (let j = a; j <= b; j++) if (raw[j] < mn) mn = raw[j];
    floorLine[i] = mn;
  }

  // 하부 포락선보다 10m 넘게 솟은 표본 = 건물/수목 위를 읽은 값
  const clean: (number | null)[] = raw.map((v, i) => (v - floorLine[i] > 10 ? null : v));

  // 버린 자리는 양옆의 성한 값으로 선형 보간
  const filled = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (clean[i] !== null) {
      filled[i] = clean[i] as number;
      continue;
    }
    let l = i - 1;
    while (l >= 0 && clean[l] === null) l--;
    let r = i + 1;
    while (r < n && clean[r] === null) r++;
    if (l < 0 && r >= n) filled[i] = floorLine[i];
    else if (l < 0) filled[i] = clean[r] as number;
    else if (r >= n) filled[i] = clean[l] as number;
    else {
      const t = (i - l) / (r - l);
      filled[i] = (clean[l] as number) * (1 - t) + (clean[r] as number) * t;
    }
  }

  // 가벼운 삼각 가중 평활 (DEM 해상도 한계에서 오는 계단 제거)
  const out = new Array<number>(n);
  const r = Math.max(1, Math.round(windowRadius * 0.5));
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
      const w = 1 - Math.abs(i - j) / (r + 1);
      s += filled[j] * w;
      c += w;
    }
    out[i] = s / c;
  }
  return out;
}

/** 경로 전체의 고도 프로필. 실패하면 null (UI 에서 조용히 감춘다). */
export async function buildElevationProfile(
  path: LngLat[],
  maxSamples = 220
): Promise<ElevProfile | null> {
  if (path.length < 2) return null;
  const total = pathLength(path);
  if (total < 60) return null;

  const spacing = Math.max(15, total / maxSamples);
  const n = Math.max(12, Math.round(total / spacing) + 1);
  const step = total / (n - 1);

  const coords: LngLat[] = [];
  for (let i = 0; i < n; i++) coords.push(pointAtDistance(path, i * step).coord);

  const raw = await Promise.all(coords.map((c) => elevationAt(c)));
  if (raw.some((v) => v === null)) return null;

  // 건물 높이를 걷어내고 지면 곡선을 뽑는다 (창 반경 = 약 80m)
  const winR = Math.max(3, Math.round(140 / step));
  const ground = toGround(raw as number[], winR);

  const points: ElevPoint[] = [];
  let gain = 0;
  let loss = 0;
  let maxGrade = 0;
  let minGrade = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < n; i++) {
    const d = i * step;
    const el = ground[i];
    let grade = 0;
    if (i > 0) {
      const dz = el - ground[i - 1];
      const dd = distance(coords[i - 1], coords[i]) || step;
      // 실제 도로에서 나올 수 없는 값은 자른다 (DEM 해상도 한계)
      grade = Math.max(-0.35, Math.min(0.35, dz / dd));
      if (dz > 0.3) gain += dz;
      else if (dz < -0.3) loss += -dz;
      if (grade > maxGrade) maxGrade = grade;
      if (grade < minGrade) minGrade = grade;
    }
    if (el < min) min = el;
    if (el > max) max = el;
    points.push({ d, e: el, grade });
  }

  return { points, gain, loss, min, max, maxGrade, minGrade };
}

/** 경사도(비율) -> 사람 말 */
export function gradeLabel(g: number): string {
  const p = Math.abs(g) * 100;
  if (p < 2) return "평지";
  const dir = g > 0 ? "오르막" : "내리막";
  if (p < 5) return `완만한 ${dir}`;
  if (p < 9) return `${dir}`;
  if (p < 15) return `가파른 ${dir}`;
  return `아주 가파른 ${dir}`;
}

/** 경사도 -> 경로선 색 (초록=평지, 주황=오르막, 파랑=내리막) */
export function gradeColor(g: number): string {
  const p = g * 100;
  if (p > 12) return "#dc2626";
  if (p > 7) return "#f97316";
  if (p > 3) return "#fbbf24";
  if (p > -3) return "#4ade80";
  if (p > -7) return "#38bdf8";
  return "#3b82f6";
}
