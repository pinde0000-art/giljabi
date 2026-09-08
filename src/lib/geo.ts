import type { LngLat } from "../types";

export const R_EARTH = 6371008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** 두 점 사이 거리(m) — haversine */
export function distance(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * D2R;
  const dLng = (b[0] - a[0]) * D2R;
  const la1 = a[1] * D2R;
  const la2 = b[1] * D2R;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a 에서 b 를 볼 때의 방위각(0~360, 북=0) */
export function bearing(a: LngLat, b: LngLat): number {
  const la1 = a[1] * D2R;
  const la2 = b[1] * D2R;
  const dLng = (b[0] - a[0]) * D2R;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** 각도 보간 (짧은 쪽으로) */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

/** 폴리라인 총 길이(m) */
export function pathLength(path: LngLat[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += distance(path[i - 1], path[i]);
  return s;
}

/** 폴리라인에서 누적거리 d(m) 지점의 좌표 + 진행 방위각 */
export function pointAtDistance(
  path: LngLat[],
  d: number
): { coord: LngLat; heading: number; index: number } {
  if (path.length === 0) return { coord: [0, 0], heading: 0, index: 0 };
  if (path.length === 1) return { coord: path[0], heading: 0, index: 0 };
  if (d <= 0) return { coord: path[0], heading: bearing(path[0], path[1]), index: 0 };
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = distance(path[i - 1], path[i]);
    if (acc + seg >= d) {
      const t = seg === 0 ? 0 : (d - acc) / seg;
      const coord: LngLat = [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ];
      return { coord, heading: bearing(path[i - 1], path[i]), index: i - 1 };
    }
    acc += seg;
  }
  const n = path.length;
  return { coord: path[n - 1], heading: bearing(path[n - 2], path[n - 1]), index: n - 2 };
}

/** 점 p 에서 폴리라인까지의 최단거리(m)와 그 지점의 누적거리 */
export function nearestOnPath(
  path: LngLat[],
  p: LngLat
): { dist: number; along: number; coord: LngLat } {
  let best = { dist: Infinity, along: 0, coord: path[0] ?? p };
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const seg = distance(a, b);
    // 위경도를 로컬 평면으로 근사해서 사영
    const kx = Math.cos(((a[1] + b[1]) / 2) * D2R);
    const ax = a[0] * kx;
    const bx = b[0] * kx;
    const px = p[0] * kx;
    const vx = bx - ax;
    const vy = b[1] - a[1];
    const wx = px - ax;
    const wy = p[1] - a[1];
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    const proj: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = distance(p, proj);
    if (d < best.dist) best = { dist: d, along: acc + seg * t, coord: proj };
    acc += seg;
  }
  return best;
}

/** 좌표 목록을 감싸는 bbox — [w, s, e, n] */
export function bboxOf(coords: LngLat[], padMeters = 0): [number, number, number, number] {
  let w = 180,
    s = 90,
    e = -180,
    n = -90;
  for (const c of coords) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  if (padMeters > 0) {
    const dLat = (padMeters / R_EARTH) * R2D;
    const dLng = dLat / Math.max(0.2, Math.cos(((s + n) / 2) * D2R));
    w -= dLng;
    e += dLng;
    s -= dLat;
    n += dLat;
  }
  return [w, s, e, n];
}

/** 미터 단위 오프셋을 위경도로 */
export function offsetMeters(c: LngLat, dxEast: number, dyNorth: number): LngLat {
  const dLat = (dyNorth / R_EARTH) * R2D;
  const dLng = ((dxEast / R_EARTH) * R2D) / Math.cos(c[1] * D2R);
  return [c[0] + dLng, c[1] + dLat];
}

/** 폴리라인 단순화(Douglas–Peucker, 위경도 근사) */
export function simplify(path: LngLat[], toleranceMeters = 4): LngLat[] {
  if (path.length < 3) return path.slice();
  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = nearestOnPath([path[i0], path[i1]], path[i]).dist;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceMeters && idx > 0) {
      keep[idx] = 1;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  return path.filter((_, i) => keep[i]);
}

/* ---------------- 표시 형식 ---------------- */

export function fmtDistance(m: number): string {
  if (!isFinite(m)) return "-";
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

export function fmtDuration(sec: number): string {
  if (!isFinite(sec)) return "-";
  const m = Math.round(sec / 60);
  if (m < 1) return "1분 미만";
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}시간` : `${h}시간 ${r}분`;
}

export function fmtClock(sec: number, from = Date.now()): string {
  const t = new Date(from + sec * 1000);
  const h = t.getHours();
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${mm}`;
}
