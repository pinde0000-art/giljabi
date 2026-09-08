import type { BusStop, LngLat, TransitLeg, TransitPlan, Vehicle } from "../types";
import { pathLength } from "../lib/geo";

/**
 * 대중교통 경로 탐색 — Transitous (MOTIS) 공개 인스턴스.
 *
 * Transitous 는 전 세계 GTFS 피드를 모아 돌리는 커뮤니티 운영 서비스이고,
 * 한국은 국가교통DB(KTDB) 피드가 들어가 있어서 **전국 시내버스 + 도시철도의
 * 실제 시각표**로 경로를 낸다. API 키가 필요 없고 CORS 도 열려 있다.
 *
 * 여기서 얻는 것:
 *   - 몇 번 버스를 타는지 (routeShortName)
 *   - 어느 정류장에서 타고 어디서 내리는지 (from / to)
 *   - 중간에 지나는 정류장 (intermediateStops)
 *   - 환승 지점과 환승 도보
 *   - 실제 출발/도착 시각
 */

const BASE = "https://api.transitous.org/api/v1";

export class MotisError extends Error {
  code: "network" | "no_route";
  constructor(code: MotisError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* 인코딩된 폴리라인 디코딩 (precision 7)                                */
/* ------------------------------------------------------------------ */

export function decodePolyline(str: string, precision = 7): LngLat[] {
  if (!str) return [];
  const factor = Math.pow(10, precision);
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  // 주의: precision 7 + 경도 127도면 지그재그 값이 2^31 을 넘어가서
  // 비트 연산(<<, >>, |)을 쓰면 부호가 뒤집힌다. 그래서 곱셈/나눗셈으로만 푼다.
  const readDelta = (): number => {
    let result = 0;
    let shift = 1;
    let b: number;
    do {
      b = str.charCodeAt(index++) - 63;
      result += (b & 0x1f) * shift;
      shift *= 32;
    } while (b >= 0x20);
    return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  };

  while (index < str.length) {
    lat += readDelta();
    lng += readDelta();
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 모드 정규화                                                          */
/* ------------------------------------------------------------------ */

/**
 * 한국 KTDB 피드는 시내버스를 GTFS route_type 0(트램)으로 넣어 두었다.
 * 그래서 MOTIS 가 TRAM 으로 돌려주는데, 실제로는 전부 버스다.
 * 다행히 정류장 ID 가 `kr-korea_BS_...`(버스정류장) / `kr-korea_RS_...`(철도역)
 * 로 갈리기 때문에 그걸로 바로잡는다. 한국 밖에서는 GTFS 모드를 그대로 쓴다.
 */
function vehicleOf(mode: string, stopId?: string): Vehicle {
  if (stopId?.startsWith("kr-korea_")) {
    if (stopId.includes("_BS_")) return "bus";
    if (stopId.includes("_RS_")) return "subway";
  }
  switch (mode) {
    case "BUS":
    case "COACH":
      return "bus";
    case "TRAM":
      return "tram";
    case "SUBWAY":
    case "METRO":
      return "subway";
    case "RAIL":
    case "REGIONAL_RAIL":
    case "REGIONAL_FAST_RAIL":
    case "LONG_DISTANCE":
    case "HIGHSPEED_RAIL":
    case "NIGHT_RAIL":
      return "train";
    case "FERRY":
      return "ferry";
    default:
      return "other";
  }
}

export function vehicleLabel(v: Vehicle | undefined): string {
  switch (v) {
    case "bus":
      return "버스";
    case "subway":
      return "지하철";
    case "train":
      return "기차";
    case "tram":
      return "트램";
    case "ferry":
      return "배";
    default:
      return "대중교통";
  }
}

/** 노선 번호/종류로 뱃지 색을 고른다 (한국 버스 관례에 맞춤) */
function colorKeyOf(ref: string, vehicle: Vehicle): "b" | "g" | "r" | "y" {
  if (vehicle === "subway" || vehicle === "train") return "y";
  // 광역/직행버스는 붉은색, 마을/지선은 초록색, 간선은 파란색
  if (/^[0-9]{4}$/.test(ref) || /^M/.test(ref) || /광역|직행/.test(ref)) return "r";
  if (/^[0-9]{2}$/.test(ref) || /마을|지선/.test(ref)) return "g";
  return "b";
}

/* ------------------------------------------------------------------ */
/* 변환                                                                */
/* ------------------------------------------------------------------ */

function toStop(s: any, fallbackName: string): BusStop {
  return {
    id: typeof s?.stopId === "string" ? hashId(s.stopId) : 0,
    name: s?.name && s.name !== "START" && s.name !== "END" ? s.name : fallbackName,
    ref: s?.stopId,
    coord: [s?.lon ?? 0, s?.lat ?? 0],
  };
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const ms = (iso?: string) => (iso ? Date.parse(iso) : undefined);

function convert(it: any, origin: LngLat, dest: LngLat): TransitPlan {
  const legs: TransitLeg[] = [];

  for (const l of it.legs ?? []) {
    const geometry = decodePolyline(l.legGeometry?.points ?? "", l.legGeometry?.precision ?? 7);
    const isWalk = l.mode === "WALK" || l.mode === "BIKE" || l.mode === "CAR";

    const fromName =
      l.from?.name && l.from.name !== "START" ? l.from.name : "출발지";
    const toName = l.to?.name && l.to.name !== "END" ? l.to.name : "도착지";

    if (isWalk) {
      legs.push({
        kind: "walk",
        from: { name: fromName, coord: [l.from?.lon ?? origin[0], l.from?.lat ?? origin[1]] },
        to: { name: toName, coord: [l.to?.lon ?? dest[0], l.to?.lat ?? dest[1]] },
        distance: l.distance ?? pathLength(geometry),
        duration: l.duration ?? 0,
        geometry,
        startTime: ms(l.startTime),
        endTime: ms(l.endTime),
      });
      continue;
    }

    const vehicle = vehicleOf(l.mode, l.from?.stopId);
    const ref: string = (l.routeShortName || l.displayName || l.routeLongName || "").trim();

    const rideStops: BusStop[] = [
      toStop(l.from, fromName),
      ...(l.intermediateStops ?? []).map((s: any) => toStop(s, "정류장")),
      toStop(l.to, toName),
    ];

    legs.push({
      kind: "ride",
      from: { name: fromName, coord: [l.from?.lon ?? 0, l.from?.lat ?? 0] },
      to: { name: toName, coord: [l.to?.lon ?? 0, l.to?.lat ?? 0] },
      distance: l.distance ?? pathLength(geometry),
      duration: l.duration ?? 0,
      geometry,
      ref,
      headsign: l.headsign || l.tripTo?.name || undefined,
      vehicle,
      colorKey: colorKeyOf(ref, vehicle),
      agency: l.agencyName || undefined,
      rideStops,
      startTime: ms(l.startTime),
      endTime: ms(l.endTime),
    });
  }

  const rides = legs.filter((l) => l.kind === "ride");
  return {
    legs,
    totalDistance: legs.reduce((s, l) => s + (l.distance || pathLength(l.geometry)), 0),
    totalDuration: it.duration ?? legs.reduce((s, l) => s + l.duration, 0),
    walkDistance: legs.filter((l) => l.kind === "walk").reduce((s, l) => s + l.distance, 0),
    transfers: it.transfers ?? Math.max(0, rides.length - 1),
    lineRefs: rides.map((l) => l.ref ?? ""),
    startTime: ms(it.startTime),
    endTime: ms(it.endTime),
  };
}

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */

export interface MotisOptions {
  /** 버스만 쓸지 (한국 피드는 버스가 TRAM 으로 들어와 있어 둘 다 넣는다) */
  busOnly?: boolean;
  /** 출발 시각 (기본: 지금) */
  time?: Date;
  count?: number;
}

export async function planTransitMotis(
  origin: LngLat,
  dest: LngLat,
  opts: MotisOptions = {},
  signal?: AbortSignal
): Promise<TransitPlan[]> {
  const url = new URL(`${BASE}/plan`);
  url.searchParams.set("fromPlace", `${origin[1]},${origin[0]}`);
  url.searchParams.set("toPlace", `${dest[1]},${dest[0]}`);
  url.searchParams.set("numItineraries", String(opts.count ?? 4));
  if (opts.busOnly) url.searchParams.set("transitModes", "BUS,TRAM,COACH");
  if (opts.time) url.searchParams.set("time", opts.time.toISOString());

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new MotisError("network", "대중교통 경로 서버에 연결하지 못했습니다.");
  }
  if (!res.ok) throw new MotisError("network", `대중교통 경로 서버 오류 (${res.status})`);

  const data = await res.json();
  const its: any[] = data?.itineraries ?? [];

  const plans = its
    .filter((it) => (it.legs ?? []).some((l: any) => l.mode !== "WALK"))
    .map((it) => convert(it, origin, dest));

  // 같은 노선 조합은 하나만
  const seen = new Set<string>();
  const out: TransitPlan[] = [];
  for (const p of plans) {
    const sig = p.lineRefs.join(">");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}
