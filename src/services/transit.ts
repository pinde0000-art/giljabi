import type { LngLat, TransitPlan } from "../types";
import { distance } from "../lib/geo";
import { MotisError, planTransitMotis } from "./motis";
import { nearbyStops, planTransitOsm, TransitError } from "./transitOsm";

/**
 * 대중교통 경로 오케스트레이터.
 *
 *  1순위 Transitous(MOTIS) — 실제 GTFS 시각표. 한국은 국가교통DB 가 들어가 있어
 *        전국 시내버스 + 도시철도가 다 잡히고, 응답도 보통 1초 안쪽이다.
 *  2순위 OpenStreetMap 노선 관계 — MOTIS 서버 자체에 못 닿을 때만.
 *
 * 중요: MOTIS 가 "정상 응답했는데 결과가 0건" 인 경우는 폴백 대상이 아니다.
 * 그건 서버 문제가 아니라 "그 시간에 갈 수 있는 편이 없다" 는 답이다.
 * 예전에는 이때도 OSM 엔진으로 내려가면서 Overpass 를 최대 70초까지 기다렸고,
 * 가까운 거리를 검색할 때마다 앱이 멈춘 것처럼 보였다.
 */

export interface TransitResult {
  plans: TransitPlan[];
  /** 어느 엔진이 만든 결과인지 */
  source: "motis" | "osm";
  /** 실제 시각표를 쓴 결과인지 (false 면 평균 속도 추정) */
  scheduled: boolean;
  /** 노선 도형이 없어 정류장을 직선으로 이은 구간이 있는지 (OSM 엔진에서만) */
  approximateShape: boolean;
  /** 지금은 운행이 끝나서 다음 운행 시간대로 찾은 결과인지 */
  laterDeparture?: boolean;
}

export { TransitError, nearbyStops };

/** 이보다 가까우면 버스를 기다리는 시간이 걷는 시간보다 길다 */
const TOO_CLOSE = 700;

/** 검색 창(초). 넓힐수록 대안이 많아진다. */
const SEARCH_WINDOW = 7200;

/** 다음 첫차 시간대 — 오늘 05:30 이 지났으면 내일 05:30 */
function nextServiceTime(now = new Date()): Date {
  const t = new Date(now);
  t.setHours(5, 30, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t;
}

/** 심야인지 (막차가 끊겼을 가능성이 큰 시간대) */
function isLateNight(now = new Date()): boolean {
  const h = now.getHours();
  return h >= 22 || h < 5;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new TransitError("network", message)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function planTransit(
  origin: LngLat,
  dest: LngLat,
  signal?: AbortSignal
): Promise<TransitResult> {
  // 아주 가까우면 애초에 버스를 찾을 이유가 없다. 네트워크도 안 탄다.
  if (distance(origin, dest) < TOO_CLOSE) {
    throw new TransitError(
      "no_route",
      "걸어서 갈 수 있는 거리라 버스 노선을 찾지 않았어요."
    );
  }

  let motisAnswered = false;

  try {
    // 1) 버스 위주
    let plans = await planTransitMotis(
      origin,
      dest,
      { busOnly: true, searchWindow: SEARCH_WINDOW },
      signal
    );
    motisAnswered = true;

    // 2) 버스만으로 안 되면 지하철 포함 (한국은 이 조합이 현실적이다)
    if (plans.length === 0) {
      plans = await planTransitMotis(
        origin,
        dest,
        { busOnly: false, searchWindow: SEARCH_WINDOW },
        signal
      );
    }
    if (plans.length > 0) {
      return { plans, source: "motis", scheduled: true, approximateShape: false };
    }

    // 3) 지금은 편이 없다. 심야면 다음 첫차 시간대로 한 번 더 찾아본다.
    if (isLateNight()) {
      const later = await planTransitMotis(
        origin,
        dest,
        { busOnly: false, time: nextServiceTime(), searchWindow: 10800 },
        signal
      );
      if (later.length > 0) {
        return {
          plans: later,
          source: "motis",
          scheduled: true,
          approximateShape: false,
          laterDeparture: true,
        };
      }
    }

    throw new TransitError(
      "no_route",
      isLateNight()
        ? "지금 시간대에는 이 구간을 다니는 편이 없습니다. 막차가 끊긴 것 같아요."
        : "이 두 지점을 잇는 대중교통 편을 찾지 못했습니다."
    );
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    if (e instanceof TransitError) throw e;

    // MOTIS 가 답을 주긴 했다면 데이터상 없는 것이므로 폴백해도 소용없다
    if (motisAnswered || !(e instanceof MotisError)) {
      throw new TransitError(
        "no_route",
        "대중교통 경로를 계산하지 못했습니다. 잠시 후 다시 시도해 주세요."
      );
    }

    // 여기까지 왔으면 MOTIS 서버 자체에 못 닿은 것. 이때만 OSM 엔진을 쓰되,
    // Overpass 가 밀려서 화면이 멈춘 것처럼 보이지 않도록 시간을 끊는다.
    return withTimeout(
      planTransitOsm(origin, dest, signal),
      25000,
      "대중교통 데이터 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요."
    );
  }
}
