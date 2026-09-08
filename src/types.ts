/** [경도, 위도] — GeoJSON / MapLibre 순서를 그대로 쓴다. */
export type LngLat = [number, number];

export type TravelMode = "walk" | "bus" | "car" | "bike";
export type MapDim = "2d" | "3d";

export interface Place {
  /** 화면에 보여줄 이름 */
  name: string;
  /** 주소 등 부가 설명 */
  detail?: string;
  coord: LngLat;
  /** 현재 위치로 잡힌 지점인지 */
  isCurrent?: boolean;
}

/** OSRM 한 구간 안내 */
export interface RoadStep {
  instruction: string;
  distance: number;
  duration: number;
  /** 이 구간의 폴리라인 */
  geometry: LngLat[];
  modifier?: string;
  type?: string;
  name?: string;
}

export interface RoadRoute {
  mode: Exclude<TravelMode, "bus">;
  distance: number;
  duration: number;
  geometry: LngLat[];
  steps: RoadStep[];
}

/** 고도 프로필 한 점 */
export interface ElevPoint {
  /** 출발점부터의 누적 거리(m) */
  d: number;
  /** 해발 고도(m) */
  e: number;
  /** 직전 구간 경사도(비율, 0.08 = 8%) */
  grade: number;
}

export interface ElevProfile {
  points: ElevPoint[];
  gain: number;
  loss: number;
  min: number;
  max: number;
  maxGrade: number;
  minGrade: number;
}

/* ---------------- 대중교통 ---------------- */

export interface BusStop {
  id: number;
  name: string;
  /** 정류장 고유번호(있으면) */
  ref?: string;
  coord: LngLat;
}

export interface BusLine {
  id: number;
  /** 노선 번호 (예: "108") */
  ref: string;
  name: string;
  /** 방면 (마지막 정류장 또는 to 태그) */
  to?: string;
  from?: string;
  colorKey: "b" | "g" | "r" | "y";
  /** 순서대로의 정류장 목록 */
  stops: BusStop[];
}

export type TransitLegKind = "walk" | "ride";

/** 탈것 종류 — 표시 문구와 아이콘을 고른다 */
export type Vehicle = "bus" | "subway" | "train" | "tram" | "ferry" | "other";

export interface TransitLeg {
  kind: TransitLegKind;
  from: { name: string; coord: LngLat };
  to: { name: string; coord: LngLat };
  distance: number;
  duration: number;
  geometry: LngLat[];

  /* --- 승차 구간에서만 --- */
  /** 노선 번호 (예: "342", "서울2호선") */
  ref?: string;
  /** 방면 (종점 이름) */
  headsign?: string;
  vehicle?: Vehicle;
  colorKey?: "b" | "g" | "r" | "y";
  agency?: string;
  /** 지나는 정류장(승차~하차, 양끝 포함) */
  rideStops?: BusStop[];
  /** 시각표가 있을 때의 출발/도착 시각 (epoch ms) */
  startTime?: number;
  endTime?: number;
  /** OSM 폴백 엔진에서만 채워지는 원본 노선 정보 */
  line?: BusLine;
}

export interface TransitPlan {
  legs: TransitLeg[];
  totalDistance: number;
  totalDuration: number;
  walkDistance: number;
  transfers: number;
  /** 이 안이 쓰는 노선 번호들 */
  lineRefs: string[];
  /** 시각표 기반이면 출발/도착 시각 (epoch ms) */
  startTime?: number;
  endTime?: number;
}

/* ---------------- 안내 진행 상태 ---------------- */

export interface NavProgress {
  /** 현재 진행 중인 leg 인덱스 */
  legIndex: number;
  /** 사용자가 버스에 탑승한 상태인지 */
  onboard: boolean;
}
