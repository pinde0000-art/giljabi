import type { LngLat, RoadRoute, RoadStep, TravelMode } from "../types";
import { distance } from "../lib/geo";

/**
 * 도로 경로 탐색 — FOSSGIS 가 운영하는 공개 OSRM 인스턴스를 쓴다.
 * 프로필별로 도메인이 다르고, 셋 다 키 없이 CORS 가 열려 있다.
 */
const OSRM: Record<Exclude<TravelMode, "bus">, { base: string; profile: string }> = {
  walk: { base: "https://routing.openstreetmap.de/routed-foot", profile: "foot" },
  bike: { base: "https://routing.openstreetmap.de/routed-bike", profile: "bike" },
  car: { base: "https://routing.openstreetmap.de/routed-car", profile: "driving" },
};

export class RouteError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const DIR: Record<string, string> = {
  left: "왼쪽",
  right: "오른쪽",
  "slight left": "왼쪽 앞",
  "slight right": "오른쪽 앞",
  "sharp left": "왼쪽으로 크게",
  "sharp right": "오른쪽으로 크게",
  straight: "직진",
  uturn: "유턴",
};

function roadName(step: any): string {
  const n: string = step?.name ?? "";
  const ref: string = step?.ref ?? "";
  if (n && ref) return `${n}(${ref})`;
  return n || ref || "";
}

/** OSRM maneuver -> 한국어 안내문 */
function toKorean(step: any, isLast: boolean): string {
  const m = step?.maneuver ?? {};
  const type: string = m.type ?? "";
  const mod: string = m.modifier ?? "";
  const name = roadName(step);
  const on = name ? `${name} 으로 ` : "";
  const along = name ? `${name} 을(를) 따라 ` : "";

  switch (type) {
    case "depart":
      return name ? `${name} 방향으로 출발` : "출발";
    case "arrive":
      if (isLast) return "목적지 도착";
      return mod ? `${DIR[mod] ?? ""}에 목적지` : "도착";
    case "turn":
      if (mod === "straight") return `${along}직진`;
      if (mod === "uturn") return "유턴";
      return `${on}${DIR[mod] ?? "회전"} 방향으로 꺾기`;
    case "new name":
      return `${along}계속 직진`;
    case "continue":
      if (mod === "uturn") return "유턴";
      return name ? `${along}계속` : "계속 직진";
    case "merge":
      return `${on}합류`;
    case "on ramp":
      return `진입로로 ${DIR[mod] ?? ""} 진입${name ? ` (${name})` : ""}`;
    case "off ramp":
      return `${DIR[mod] ?? ""} 출구로 빠지기${name ? ` (${name})` : ""}`;
    case "fork":
      return `갈림길에서 ${DIR[mod] ?? "직진"} 방향`;
    case "end of road":
      return `길 끝에서 ${DIR[mod] ?? ""} 방향`;
    case "roundabout":
    case "rotary": {
      const exit = m.exit ? `${m.exit}번째 출구로 ` : "";
      return `회전교차로에서 ${exit}나가기${name ? ` (${name})` : ""}`;
    }
    case "roundabout turn":
      return `회전교차로에서 ${DIR[mod] ?? ""} 방향`;
    case "notification":
      return name ? `${along}이동` : "계속 이동";
    default:
      return name ? `${along}이동` : "계속 이동";
  }
}

function coordsParam(points: LngLat[]): string {
  return points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
}

/** 좌표 목록을 순서대로 잇는 경로. 2개면 단순 A→B. */
export async function routeRoad(
  mode: Exclude<TravelMode, "bus">,
  points: LngLat[],
  signal?: AbortSignal
): Promise<RoadRoute> {
  if (points.length < 2) throw new RouteError("bad_input", "출발지와 도착지가 필요합니다.");
  const cfg = OSRM[mode];
  const url =
    `${cfg.base}/route/v1/${cfg.profile}/${coordsParam(points)}` +
    `?overview=full&geometries=geojson&steps=true&alternatives=false`;

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new RouteError("network", "경로 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
  }
  if (!res.ok) throw new RouteError("http", `경로 서버 오류 (${res.status})`);

  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    if (data.code === "NoRoute")
      throw new RouteError("no_route", "이 두 지점을 잇는 길을 찾지 못했습니다.");
    throw new RouteError(data.code ?? "unknown", data.message ?? "경로를 계산하지 못했습니다.");
  }

  const r = data.routes[0];
  const steps: RoadStep[] = [];
  for (const leg of r.legs ?? []) {
    const list = leg.steps ?? [];
    list.forEach((s: any, i: number) => {
      const geom: LngLat[] = (s.geometry?.coordinates ?? []).map((c: number[]) => [c[0], c[1]]);
      const isLast = i === list.length - 1 && leg === r.legs[r.legs.length - 1];
      steps.push({
        instruction: toKorean(s, isLast),
        distance: s.distance ?? 0,
        duration: s.duration ?? 0,
        geometry: geom,
        modifier: s.maneuver?.modifier,
        type: s.maneuver?.type,
        name: s.name || undefined,
      });
    });
  }

  return {
    mode,
    distance: r.distance ?? 0,
    duration: r.duration ?? 0,
    geometry: (r.geometry?.coordinates ?? []).map((c: number[]) => [c[0], c[1]] as LngLat),
    steps,
  };
}

/** 도보 구간만 간단히 (대중교통 환승 도보 등에 사용) */
export async function walkLeg(
  a: LngLat,
  b: LngLat,
  signal?: AbortSignal
): Promise<{ geometry: LngLat[]; distance: number; duration: number }> {
  try {
    const r = await routeRoad("walk", [a, b], signal);
    return { geometry: r.geometry, distance: r.distance, duration: r.duration };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    // 도보 경로 서버가 실패하면 직선으로라도 잇는다 (거리는 실제 거리로)
    const d = distance(a, b);
    return { geometry: [a, b], distance: d, duration: d / 1.25 };
  }
}
