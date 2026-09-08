import type { LngLat, TransitPlan } from "../types";
import { MotisError, planTransitMotis } from "./motis";
import { nearbyStops, planTransitOsm, TransitError } from "./transitOsm";

/**
 * 대중교통 경로 오케스트레이터.
 *
 *  1순위 Transitous(MOTIS) — 실제 GTFS 시각표. 한국은 국가교통DB 가 들어가 있어
 *        전국 시내버스 + 도시철도가 다 잡힌다.
 *  2순위 OpenStreetMap 노선 관계 — 시각표가 없는 지역용. 소요시간은 추정치.
 *
 * 두 엔진 모두 같은 TransitPlan 모양을 돌려주므로 UI 는 구분할 필요가 없다.
 * 다만 "시각표 기반인지"는 화면에 반드시 표시한다.
 */

export interface TransitResult {
  plans: TransitPlan[];
  /** 어느 엔진이 만든 결과인지 */
  source: "motis" | "osm";
  /** 실제 시각표를 쓴 결과인지 (false 면 평균 속도 추정) */
  scheduled: boolean;
  /** 노선 도형이 없어 정류장을 직선으로 이은 구간이 있는지 (OSM 엔진에서만) */
  approximateShape: boolean;
}

export { TransitError, nearbyStops };

export async function planTransit(
  origin: LngLat,
  dest: LngLat,
  signal?: AbortSignal
): Promise<TransitResult> {
  // 1) 버스 위주로 먼저 물어본다
  try {
    let plans = await planTransitMotis(origin, dest, { busOnly: true }, signal);

    // 버스만으로 못 가면 지하철 포함해서 다시 (한국은 이 조합이 현실적이다)
    if (plans.length === 0) {
      plans = await planTransitMotis(origin, dest, { busOnly: false }, signal);
    }
    if (plans.length > 0) {
      return { plans, source: "motis", scheduled: true, approximateShape: false };
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    if (!(e instanceof MotisError)) throw e;
    // 네트워크 실패면 OSM 엔진으로 내려간다
  }

  // 2) 폴백: OSM 노선 관계로 직접 계산
  return planTransitOsm(origin, dest, signal);
}
