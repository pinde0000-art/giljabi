import type { BusLine, BusStop, LngLat, TransitLeg, TransitPlan } from "../types";
import type { TransitResult } from "./transit";
import { bboxOf, distance, nearestOnPath } from "../lib/geo";
import { walkLeg } from "./routing";

/**
 * 버스 경로 탐색.
 *
 * 데이터: OpenStreetMap 의 대중교통 노선 관계(relation type=route, route=bus).
 *   - 정류장 순서가 관계 멤버로 들어 있어서 "어디서 타고 어디서 내리는지"를 실제 데이터로 뽑는다.
 *   - 시각표(GTFS)는 없기 때문에 소요시간은 정류장 간 실거리 + 평균 표정속도로 추정한다.
 *     화면에서 "추정"임을 반드시 밝힌다.
 *
 * 알고리즘: RAPTOR 축소판. 라운드마다 (탑승 -> 하차) 를 한 번씩 확장하고
 * 라운드 사이에 도보 환승을 허용한다. 최대 2회 환승.
 */

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** 도보 속도 m/s */
export const WALK_SPEED = 1.25;
/** 버스 주행 평균 속도 m/s (약 25km/h) */
const BUS_SPEED = 7.0;
/** 정류장 정차 손실 초 */
const DWELL = 18;
/** 첫 승차 대기 추정 초 */
const FIRST_WAIT = 300;
/** 환승 대기 추정 초 */
const TRANSFER_WAIT = 240;
/** 환승 도보 최대 거리 m */
const TRANSFER_WALK = 350;
/** 최대 환승 횟수 */
const MAX_TRANSFERS = 2;

export class TransitError extends Error {
  code: "no_stops" | "no_lines" | "no_route" | "network";
  info?: { stopsNear: number; linesFound: number };
  constructor(code: TransitError["code"], message: string, info?: TransitError["info"]) {
    super(message);
    this.code = code;
    this.info = info;
  }
}

/* ------------------------------------------------------------------ */
/* Overpass                                                            */
/* ------------------------------------------------------------------ */

const queryCache = new Map<string, Promise<any>>();

/** Overpass 응답이 HTML(과부하 안내)인지 */
function looksLikeError(text: string) {
  return text.trimStart().startsWith("<");
}

async function fetchOverpass(ep: string, query: string, signal: AbortSignal): Promise<any> {
  const res = await fetch(ep, {
    method: "POST",
    body: new URLSearchParams({ data: query }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (looksLikeError(text)) throw new Error("overpass busy");
  return JSON.parse(text);
}

/**
 * Overpass 질의.
 *
 * 공개 미러는 자주 과부하가 나서 한 대만 붙잡고 기다리면 1분 넘게 멈춘다.
 * 그래서 첫 미러를 먼저 때리고, 응답이 늦으면 STAGGER 간격으로 다음 미러를
 * 하나씩 추가로 붙여 먼저 성공한 응답을 쓴다(hedged request).
 * 같은 질의는 세션 동안 캐시한다.
 */
async function overpass(query: string, signal?: AbortSignal): Promise<any> {
  const cached = queryCache.get(query);
  if (cached) return cached;

  const STAGGER = 6500;
  const OVERALL = 70000;

  const run = (async () => {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    let settled = false;
    const errors: string[] = [];

    try {
      return await new Promise<any>((resolve, reject) => {
        let pending = 0;
        let started = 0;
        const timers: number[] = [];

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          timers.forEach((t) => window.clearTimeout(t));
          fn();
        };

        const launch = (ep: string) => {
          pending++;
          started++;
          fetchOverpass(ep, query, ac.signal)
            .then((data) => finish(() => resolve(data)))
            .catch((e) => {
              errors.push(`${new URL(ep).host}: ${(e as Error).message}`);
              pending--;
              if (pending === 0 && started === OVERPASS.length) {
                finish(() =>
                  reject(
                    new TransitError(
                      "network",
                      "대중교통 노선 데이터 서버(Overpass)가 지금 응답하지 않습니다. 잠시 후 다시 시도해 주세요."
                    )
                  )
                );
              }
            });
        };

        launch(OVERPASS[0]);
        for (let i = 1; i < OVERPASS.length; i++) {
          timers.push(
            window.setTimeout(() => {
              if (!settled) launch(OVERPASS[i]);
            }, STAGGER * i)
          );
        }
        timers.push(
          window.setTimeout(() => {
            finish(() =>
              reject(
                new TransitError(
                  "network",
                  "대중교통 노선 데이터를 가져오는 데 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요."
                )
              )
            );
          }, OVERALL)
        );
      });
    } finally {
      signal?.removeEventListener("abort", onAbort);
      // 이긴 응답 말고 나머지는 끊는다
      ac.abort();
    }
  })();

  queryCache.set(query, run);
  run.catch(() => queryCache.delete(query));
  return run;
}

function buildQuery(o: LngLat, d: LngLat, ro: number, rd: number): string {
  const oa = `${o[1].toFixed(6)},${o[0].toFixed(6)}`;
  const da = `${d[1].toFixed(6)},${d[0].toFixed(6)}`;
  return `[out:json][timeout:90];
(
  node(around:${ro},${oa})["highway"="bus_stop"];
  node(around:${ro},${oa})["public_transport"~"^(platform|stop_position)$"];
  node(around:${rd},${da})["highway"="bus_stop"];
  node(around:${rd},${da})["public_transport"~"^(platform|stop_position)$"];
)->.seed;
rel(bn.seed)["type"="route"]["route"~"^(bus|trolleybus|minibus|share_taxi)$"]->.rr;
.rr out body qt;
node(r.rr)->.rn;
.rn out body qt;
.seed out body qt;`;
}

/* ------------------------------------------------------------------ */
/* 파싱                                                                */
/* ------------------------------------------------------------------ */

function colorKeyFor(ref: string, tags: Record<string, string>): BusLine["colorKey"] {
  const c = (tags["colour"] || tags["color"] || "").toLowerCase();
  if (c.includes("green") || c.startsWith("#0") || c.startsWith("#3c")) return "g";
  if (c.includes("red") || c.startsWith("#e")) return "r";
  if (c.includes("yellow") || c.includes("orange")) return "y";
  // 한국 시내버스 관례: 광역/직행은 붉은색, 마을버스는 초록색
  const n = tags["network"] || "";
  if (/광역|직행|좌석/.test(n) || /^[0-9]{4}$/.test(ref)) return "r";
  if (/마을|지선/.test(n)) return "g";
  return "b";
}

interface Parsed {
  lines: BusLine[];
  stopsNearOrigin: number;
  seedStops: BusStop[];
}

function parse(data: any, o: LngLat, ro: number): Parsed {
  const nodes = new Map<number, { coord: LngLat; tags: Record<string, string> }>();
  const rels: any[] = [];
  const seedIds = new Set<number>();

  for (const el of data?.elements ?? []) {
    if (el.type === "node" && typeof el.lat === "number") {
      nodes.set(el.id, { coord: [el.lon, el.lat], tags: el.tags ?? {} });
      const t = el.tags ?? {};
      if (t.highway === "bus_stop" || t.public_transport) seedIds.add(el.id);
    } else if (el.type === "relation") {
      rels.push(el);
    }
  }

  const lines: BusLine[] = [];
  for (const rel of rels) {
    const tags: Record<string, string> = rel.tags ?? {};
    const ref = (tags.ref || tags.name || "").trim();
    if (!ref) continue;

    const raw: BusStop[] = [];
    for (const m of rel.members ?? []) {
      if (m.type !== "node") continue;
      const role: string = m.role ?? "";
      if (role && !/^(stop|platform)/.test(role)) continue;
      const nd = nodes.get(m.ref);
      if (!nd) continue;
      const nm = nd.tags["name"] || nd.tags["name:ko"] || "";
      if (!role && !nd.tags.highway && !nd.tags.public_transport) continue;
      raw.push({
        id: m.ref,
        name: nm || "이름 없는 정류장",
        ref: nd.tags["ref"],
        coord: nd.coord,
      });
    }

    // stop_position + platform 이 같은 정류장을 두 번 넣는 경우가 흔하다 -> 인접 중복 병합
    const stops: BusStop[] = [];
    for (const s of raw) {
      const prev = stops[stops.length - 1];
      if (prev && (prev.name === s.name || distance(prev.coord, s.coord) < 60)) {
        if (prev.name === "이름 없는 정류장" && s.name !== "이름 없는 정류장") prev.name = s.name;
        if (!prev.ref && s.ref) prev.ref = s.ref;
        continue;
      }
      stops.push({ ...s });
    }
    if (stops.length < 2) continue;

    lines.push({
      id: rel.id,
      ref: ref.replace(/^버스\s*/, ""),
      name: tags.name || ref,
      to: tags.to || stops[stops.length - 1].name,
      from: tags.from || stops[0].name,
      colorKey: colorKeyFor(ref, tags),
      stops,
    });
  }

  const seedStops: BusStop[] = [];
  for (const id of seedIds) {
    const nd = nodes.get(id);
    if (!nd) continue;
    seedStops.push({
      id,
      name: nd.tags["name"] || nd.tags["name:ko"] || "이름 없는 정류장",
      ref: nd.tags["ref"],
      coord: nd.coord,
    });
  }
  const stopsNearOrigin = seedStops.filter((s) => distance(o, s.coord) <= ro).length;

  return { lines, stopsNearOrigin, seedStops };
}

/* ------------------------------------------------------------------ */
/* 탐색                                                                */
/* ------------------------------------------------------------------ */

interface RideRef {
  lineIdx: number;
  fromPos: number;
  toPos: number;
}
interface PlanLegRaw {
  kind: "walk" | "ride";
  ride?: RideRef;
  fromCoord: LngLat;
  toCoord: LngLat;
  fromName: string;
  toName: string;
  walkDist: number;
}
interface Journey {
  stopKey: number;
  coord: LngLat;
  cost: number;
  walkDist: number;
  rides: number;
  legs: PlanLegRaw[];
  usedLines: Set<number>;
}

function rideTime(line: BusLine, a: number, b: number): number {
  let d = 0;
  for (let i = a + 1; i <= b; i++) d += distance(line.stops[i - 1].coord, line.stops[i].coord);
  return d / BUS_SPEED + (b - a) * DWELL;
}

function rideDistance(line: BusLine, a: number, b: number): number {
  let d = 0;
  for (let i = a + 1; i <= b; i++) d += distance(line.stops[i - 1].coord, line.stops[i].coord);
  return d;
}

/** 간단한 공간 격자 — 근처 정류장 조회용 */
class Grid {
  private cell = 0.004; // 약 400m
  private m = new Map<string, BusStop[]>();
  constructor(stops: BusStop[]) {
    for (const s of stops) {
      const k = this.key(s.coord);
      const arr = this.m.get(k);
      if (arr) arr.push(s);
      else this.m.set(k, [s]);
    }
  }
  private key(c: LngLat) {
    return `${Math.floor(c[0] / this.cell)}:${Math.floor(c[1] / this.cell)}`;
  }
  near(c: LngLat, radius: number): BusStop[] {
    const out: BusStop[] = [];
    const cx = Math.floor(c[0] / this.cell);
    const cy = Math.floor(c[1] / this.cell);
    const span = Math.max(1, Math.ceil(radius / 350));
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        const arr = this.m.get(`${cx + dx}:${cy + dy}`);
        if (!arr) continue;
        for (const s of arr) if (distance(c, s.coord) <= radius) out.push(s);
      }
    }
    return out;
  }
}

function search(
  lines: BusLine[],
  origin: LngLat,
  dest: LngLat,
  originRadius: number,
  destRadius: number
): Journey[] {
  // 정류장 인덱스
  const stopById = new Map<number, BusStop>();
  const linesAt = new Map<number, Array<[number, number]>>();
  lines.forEach((ln, li) => {
    ln.stops.forEach((s, pi) => {
      if (!stopById.has(s.id)) stopById.set(s.id, s);
      const arr = linesAt.get(s.id);
      if (arr) arr.push([li, pi]);
      else linesAt.set(s.id, [[li, pi]]);
    });
  });
  const allStops = [...stopById.values()];
  const grid = new Grid(allStops);

  const bestAt = new Map<number, number>();
  const results: Journey[] = [];

  const consider = (j: Journey) => {
    const prev = bestAt.get(j.stopKey);
    // 같은 정류장에 더 싸게 도착한 기록이 있으면 버린다 (60초 여유)
    if (prev !== undefined && prev <= j.cost - 1) return false;
    bestAt.set(j.stopKey, Math.min(prev ?? Infinity, j.cost));
    return true;
  };

  // 라운드 0: 출발지에서 걸어갈 수 있는 정류장
  let frontier: Journey[] = [];
  for (const s of grid.near(origin, originRadius)) {
    const wd = distance(origin, s.coord);
    const j: Journey = {
      stopKey: s.id,
      coord: s.coord,
      cost: wd / WALK_SPEED,
      walkDist: wd,
      rides: 0,
      legs: [
        {
          kind: "walk",
          fromCoord: origin,
          toCoord: s.coord,
          fromName: "출발지",
          toName: s.name,
          walkDist: wd,
        },
      ],
      usedLines: new Set(),
    };
    if (consider(j)) frontier.push(j);
  }
  if (frontier.length === 0) return [];

  for (let round = 0; round <= MAX_TRANSFERS; round++) {
    const next: Journey[] = [];
    for (const j of frontier) {
      const at = linesAt.get(j.stopKey);
      if (!at) continue;
      for (const [li, pi] of at) {
        if (j.usedLines.has(li)) continue;
        const line = lines[li];
        const wait = j.rides === 0 ? FIRST_WAIT : TRANSFER_WAIT;
        for (let pj = pi + 1; pj < line.stops.length; pj++) {
          const target = line.stops[pj];
          const rt = rideTime(line, pi, pj);
          if (rt > 5400) break; // 90분 넘게 타는 안은 버린다
          const cost = j.cost + wait + rt;
          const nj: Journey = {
            stopKey: target.id,
            coord: target.coord,
            cost,
            walkDist: j.walkDist,
            rides: j.rides + 1,
            legs: [
              ...j.legs,
              {
                kind: "ride",
                ride: { lineIdx: li, fromPos: pi, toPos: pj },
                fromCoord: line.stops[pi].coord,
                toCoord: target.coord,
                fromName: line.stops[pi].name,
                toName: target.name,
                walkDist: 0,
              },
            ],
            usedLines: new Set([...j.usedLines, li]),
          };
          // 목적지 근처면 결과로
          const dw = distance(target.coord, dest);
          if (dw <= destRadius) {
            results.push({ ...nj, cost: nj.cost + dw / WALK_SPEED, walkDist: nj.walkDist + dw });
          }
          if (consider(nj)) next.push(nj);
        }
      }
    }

    if (round === MAX_TRANSFERS) break;

    // 라운드 사이 도보 환승
    const withWalk: Journey[] = [];
    for (const j of next) {
      withWalk.push(j);
      for (const s of grid.near(j.coord, TRANSFER_WALK)) {
        if (s.id === j.stopKey) continue;
        const wd = distance(j.coord, s.coord);
        if (wd < 25) continue;
        const nj: Journey = {
          stopKey: s.id,
          coord: s.coord,
          cost: j.cost + wd / WALK_SPEED + 30,
          walkDist: j.walkDist + wd,
          rides: j.rides,
          legs: [
            ...j.legs,
            {
              kind: "walk",
              fromCoord: j.coord,
              toCoord: s.coord,
              fromName: j.legs[j.legs.length - 1].toName,
              toName: s.name,
              walkDist: wd,
            },
          ],
          usedLines: new Set(j.usedLines),
        };
        if (consider(nj)) withWalk.push(nj);
      }
    }

    // 폭주 방지: 비용 낮은 순으로 상위만 남긴다
    withWalk.sort((a, b) => a.cost - b.cost);
    frontier = withWalk.slice(0, 1200);
    if (frontier.length === 0) break;
  }

  results.sort((a, b) => a.cost - b.cost);
  return results;
}

/* ------------------------------------------------------------------ */
/* 노선 실제 주행 경로(geometry)                                        */
/* ------------------------------------------------------------------ */

const geomCache = new Map<number, LngLat[] | null>();

/** 관계의 way 들을 이어붙여 노선 폴리라인을 만든다 */
function stitch(ways: LngLat[][]): LngLat[] {
  if (ways.length === 0) return [];
  const used = new Array(ways.length).fill(false);
  let line = ways[0].slice();
  used[0] = true;
  let added = true;
  while (added) {
    added = false;
    for (let i = 0; i < ways.length; i++) {
      if (used[i]) continue;
      const w = ways[i];
      if (w.length < 2) {
        used[i] = true;
        continue;
      }
      const head = line[0];
      const tail = line[line.length - 1];
      const ws = w[0];
      const we = w[w.length - 1];
      const near = (a: LngLat, b: LngLat) => distance(a, b) < 30;
      if (near(tail, ws)) {
        line = line.concat(w.slice(1));
      } else if (near(tail, we)) {
        line = line.concat(w.slice(0, -1).reverse());
      } else if (near(head, we)) {
        line = w.slice(0, -1).concat(line);
      } else if (near(head, ws)) {
        line = w.slice(1).reverse().concat(line);
      } else {
        continue;
      }
      used[i] = true;
      added = true;
    }
  }
  return line;
}

async function fetchLineGeometry(relId: number, signal?: AbortSignal): Promise<LngLat[] | null> {
  if (geomCache.has(relId)) return geomCache.get(relId)!;
  try {
    const data = await overpass(`[out:json][timeout:60];rel(${relId});out geom;`, signal);
    const rel = (data?.elements ?? []).find((e: any) => e.type === "relation");
    const ways: LngLat[][] = [];
    for (const m of rel?.members ?? []) {
      if (m.type !== "way" || !m.geometry) continue;
      if (m.role && /^(stop|platform)/.test(m.role)) continue;
      ways.push(m.geometry.map((g: any) => [g.lon, g.lat] as LngLat));
    }
    const line = stitch(ways);
    const out = line.length >= 2 ? line : null;
    geomCache.set(relId, out);
    return out;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    geomCache.set(relId, null);
    return null;
  }
}

/** 노선 폴리라인에서 승차~하차 구간만 잘라낸다 */
function sliceBetween(line: LngLat[], a: LngLat, b: LngLat): LngLat[] | null {
  const pa = nearestOnPath(line, a);
  const pb = nearestOnPath(line, b);
  if (pa.dist > 120 || pb.dist > 120) return null;
  if (pb.along <= pa.along) return null;

  const out: LngLat[] = [pa.coord];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = distance(line[i - 1], line[i]);
    const at = acc + seg;
    if (at > pa.along && acc < pb.along) out.push(line[i]);
    acc = at;
    if (acc > pb.along) break;
  }
  out.push(pb.coord);
  return out.length >= 2 ? out : null;
}

/* ------------------------------------------------------------------ */
/* 공개 API                                                            */
/* ------------------------------------------------------------------ */



export async function planTransitOsm(
  origin: LngLat,
  dest: LngLat,
  signal?: AbortSignal
): Promise<TransitResult> {
  const straight = distance(origin, dest);
  const originRadius = straight < 2000 ? 700 : 1000;
  const destRadius = straight < 2000 ? 800 : 1100;

  const data = await overpass(buildQuery(origin, dest, originRadius, destRadius), signal);
  const { lines, stopsNearOrigin, seedStops } = parse(data, origin, originRadius);

  if (seedStops.length === 0) {
    throw new TransitError(
      "no_stops",
      "출발지·도착지 주변에서 버스 정류장을 찾지 못했습니다. 조금 더 큰길 쪽으로 지점을 옮겨 보세요."
    );
  }
  if (lines.length === 0) {
    throw new TransitError(
      "no_lines",
      "이 지역은 OpenStreetMap 에 버스 노선(어느 정류장을 어떤 순서로 지나는지) 정보가 아직 등록돼 있지 않습니다. 정류장 위치는 지도에 표시했습니다.",
      { stopsNear: stopsNearOrigin, linesFound: 0 }
    );
  }

  const journeys = search(lines, origin, dest, originRadius, destRadius);
  if (journeys.length === 0) {
    throw new TransitError(
      "no_route",
      "환승 2회 안에 도착지까지 이어지는 버스 노선을 찾지 못했습니다.",
      { stopsNear: stopsNearOrigin, linesFound: lines.length }
    );
  }

  // 노선 조합이 겹치는 안은 하나만 남긴다
  const picked: Journey[] = [];
  const seen = new Set<string>();
  for (const j of journeys) {
    const sig = j.legs
      .filter((l) => l.kind === "ride")
      .map((l) => lines[l.ride!.lineIdx].ref)
      .join(">");
    if (seen.has(sig)) continue;
    seen.add(sig);
    picked.push(j);
    if (picked.length >= 3) break;
  }

  let approximateShape = false;
  const plans: TransitPlan[] = [];

  for (const j of picked) {
    const legs: TransitLeg[] = [];

    // 마지막 도보(하차 정류장 -> 목적지) 를 붙인다
    const rawLegs: PlanLegRaw[] = [...j.legs];
    const lastStop = rawLegs[rawLegs.length - 1];
    rawLegs.push({
      kind: "walk",
      fromCoord: lastStop.toCoord,
      toCoord: dest,
      fromName: lastStop.toName,
      toName: "도착지",
      walkDist: distance(lastStop.toCoord, dest),
    });

    for (const raw of rawLegs) {
      if (raw.kind === "walk") {
        const w = await walkLeg(raw.fromCoord, raw.toCoord, signal);
        legs.push({
          kind: "walk",
          from: { name: raw.fromName, coord: raw.fromCoord },
          to: { name: raw.toName, coord: raw.toCoord },
          distance: w.distance,
          duration: w.duration,
          geometry: w.geometry,
        });
      } else {
        const { lineIdx, fromPos, toPos } = raw.ride!;
        const line = lines[lineIdx];
        const rideStops = line.stops.slice(fromPos, toPos + 1);
        const full = await fetchLineGeometry(line.id, signal);
        let geom = full ? sliceBetween(full, raw.fromCoord, raw.toCoord) : null;
        if (!geom) {
          geom = rideStops.map((s) => s.coord);
          approximateShape = true;
        }
        legs.push({
          kind: "ride",
          from: { name: raw.fromName, coord: raw.fromCoord },
          to: { name: raw.toName, coord: raw.toCoord },
          distance: rideDistance(line, fromPos, toPos),
          duration: rideTime(line, fromPos, toPos),
          geometry: geom,
          ref: line.ref,
          headsign: line.to,
          vehicle: "bus",
          colorKey: line.colorKey,
          rideStops,
          line,
        });
      }
    }

    const totalDistance = legs.reduce((s, l) => s + l.distance, 0);
    const walkDistance = legs.filter((l) => l.kind === "walk").reduce((s, l) => s + l.distance, 0);
    const rides = legs.filter((l) => l.kind === "ride");
    const totalDuration =
      legs.reduce((s, l) => s + l.duration, 0) +
      FIRST_WAIT +
      Math.max(0, rides.length - 1) * TRANSFER_WAIT;

    plans.push({
      legs,
      totalDistance,
      totalDuration,
      walkDistance,
      transfers: Math.max(0, rides.length - 1),
      lineRefs: rides.map((l) => l.ref ?? ""),
    });
  }

  return { plans, source: "osm", scheduled: false, approximateShape };
}

/** 주변 정류장만 따로 (노선 데이터가 없을 때 지도에 뿌려주기 위함) */
export async function nearbyStops(
  center: LngLat,
  radius = 900,
  signal?: AbortSignal
): Promise<BusStop[]> {
  const q = `[out:json][timeout:40];node(around:${radius},${center[1].toFixed(6)},${center[0].toFixed(
    6
  )})["highway"="bus_stop"];out body;`;
  const data = await overpass(q, signal);
  return (data?.elements ?? [])
    .filter((e: any) => e.type === "node")
    .map((e: any) => ({
      id: e.id,
      name: e.tags?.name || e.tags?.["name:ko"] || "이름 없는 정류장",
      ref: e.tags?.ref,
      coord: [e.lon, e.lat] as LngLat,
    }));
}

export { bboxOf };
