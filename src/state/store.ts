import { create } from "zustand";
import type {
  BusStop,
  ElevProfile,
  LngLat,
  MapDim,
  Place,
  RoadRoute,
  TransitPlan,
  TravelMode,
} from "../types";
import { routeRoad, RouteError } from "../services/routing";
import { buildElevationProfile } from "../services/elevation";
import { nearbyStops, planTransit, TransitError, type TransitResult } from "../services/transit";
import { reverseGeocode } from "../services/geocode";
import { getCurrentFix, positionSource, type Fix } from "../services/geolocation";
import { distance, nearestOnPath } from "../lib/geo";

export type Phase = "idle" | "planning" | "result" | "error";

export interface AppError {
  title: string;
  message: string;
  kind: "warn" | "err";
}

interface NavState {
  active: boolean;
  legIndex: number;
  onboard: boolean;
  /** 하차 임박 알림을 이미 띄웠는지 */
  alertedAlight: boolean;
}

interface Store {
  mode: TravelMode;
  dim: MapDim;
  origin: Place | null;
  dest: Place | null;

  fix: Fix | null;
  locating: boolean;

  phase: Phase;
  error: AppError | null;
  /** 결과는 있지만 알려줄 사정이 있을 때 (예: 버스 대신 도보 제안) */
  notice: string | null;

  road: RoadRoute | null;
  elev: ElevProfile | null;
  transit: TransitResult | null;
  planIndex: number;
  /** 노선 데이터가 없을 때 대신 보여줄 주변 정류장 */
  fallbackStops: BusStop[];

  /** 지도에서 출발지를 직접 찍는 중인지 */
  picking: boolean;
  pickCoord: LngLat | null;
  pickAddr: { name: string; detail: string } | null;

  nav: NavState;
  follow: boolean;
  toast: string | null;
  /** 지도를 경로 전체에 맞춰야 한다는 신호 (증가할 때마다 MapView 가 반응) */
  fitSignal: number;
  /** 지도를 특정 지점으로 옮기라는 신호 */
  focusCoord: LngLat | null;
  focusSignal: number;

  setMode: (m: TravelMode) => void;
  setDim: (d: MapDim) => void;
  setOrigin: (p: Place | null) => void;
  setDest: (p: Place | null) => void;
  swap: () => void;
  setFollow: (v: boolean) => void;
  toast_: (msg: string | null) => void;

  locateMe: () => Promise<Place | null>;
  startPick: () => void;
  cancelPick: () => void;
  setPickCoord: (c: LngLat) => void;
  confirmPick: () => Promise<void>;
  plan: () => Promise<void>;
  reset: () => void;
  selectPlan: (i: number) => void;

  startNav: () => void;
  stopNav: () => void;
  board: () => void;
  alight: () => void;
  nextLeg: () => void;

  onFix: (f: Fix) => void;
  currentPlan: () => TransitPlan | null;
}

let inflight: AbortController | null = null;

export const useStore = create<Store>((set, get) => ({
  mode: "walk",
  dim: "2d",
  origin: null,
  dest: null,

  fix: null,
  locating: false,

  phase: "idle",
  error: null,
  notice: null,

  road: null,
  elev: null,
  transit: null,
  planIndex: 0,
  fallbackStops: [],

  picking: false,
  pickCoord: null,
  pickAddr: null,

  nav: { active: false, legIndex: 0, onboard: false, alertedAlight: false },
  follow: false,
  toast: null,
  fitSignal: 0,
  focusCoord: null,
  focusSignal: 0,

  setMode: (m) => {
    if (get().mode === m) return;
    set({ mode: m });
    const { origin, dest } = get();
    if (origin && dest) void get().plan();
    else set({ phase: "idle", road: null, elev: null, transit: null, error: null, notice: null });
  },

  setDim: (d) => set({ dim: d }),

  setOrigin: (p) =>
    set({ origin: p, phase: "idle", road: null, elev: null, transit: null, error: null, notice: null }),
  setDest: (p) =>
    set({ dest: p, phase: "idle", road: null, elev: null, transit: null, error: null, notice: null }),

  swap: () => {
    const { origin, dest } = get();
    set({
      origin: dest,
      dest: origin,
      phase: "idle",
      road: null,
      elev: null,
      transit: null,
      error: null,
      notice: null,
    });
  },

  setFollow: (v) => set({ follow: v }),
  toast_: (msg) => {
    set({ toast: msg });
    if (msg) window.setTimeout(() => set((s) => (s.toast === msg ? { toast: null } : s)), 3800);
  },

  async locateMe() {
    set({ locating: true });
    try {
      const fix = await getCurrentFix();
      set({ fix });
      // 이름은 반드시 "현재 위치" 로 둔다. 역지오코딩이 주는 지물 이름을 그대로
      // 쓰면 근처 가게 이름이 붙어서 엉뚱한 데를 잡은 것처럼 보인다.
      let detail = `${fix.coord[1].toFixed(5)}, ${fix.coord[0].toFixed(5)}`;
      try {
        const g = await reverseGeocode(fix.coord);
        detail = g.detail || g.name || detail;
      } catch {
        /* 주소를 못 얻어도 좌표로 진행 */
      }
      const place: Place = { name: "현재 위치", detail, coord: fix.coord, isCurrent: true };
      set({
        origin: place,
        locating: false,
        phase: "idle",
        road: null,
        transit: null,
        error: null,
        notice: null,
        // 지도를 그리로 옮겨서, 엉뚱한 데를 잡았으면 바로 눈에 띄게 한다
        focusCoord: fix.coord,
        focusSignal: get().focusSignal + 1,
      });
      return place;
    } catch (e) {
      set({
        locating: false,
        error: {
          title: "현재 위치를 못 잡았어요",
          message: (e as Error).message,
          kind: "err",
        },
        phase: "error",
      });
      return null;
    }
  },

  startPick: () => {
    const s = get();
    const seed = s.origin?.coord ?? s.fix?.coord ?? null;
    set({ picking: true, pickCoord: seed, pickAddr: null, follow: false });
  },

  cancelPick: () => set({ picking: false, pickCoord: null, pickAddr: null }),

  setPickCoord: (c) => {
    if (!get().picking) return;
    set({ pickCoord: c, pickAddr: null });
    // 지도를 멈춘 뒤 한 번만 주소를 물어본다
    const mine = c;
    window.setTimeout(async () => {
      if (!get().picking) return;
      const now = get().pickCoord;
      if (!now || now[0] !== mine[0] || now[1] !== mine[1]) return;
      try {
        const g = await reverseGeocode(mine);
        const still = get().pickCoord;
        if (get().picking && still && still[0] === mine[0] && still[1] === mine[1]) {
          set({ pickAddr: g });
        }
      } catch {
        /* 주소를 못 얻어도 좌표로 지정할 수 있다 */
      }
    }, 650);
  },

  async confirmPick() {
    const { pickCoord, pickAddr } = get();
    if (!pickCoord) return;
    let detail = pickAddr?.detail;
    if (!detail) {
      try {
        detail = (await reverseGeocode(pickCoord)).detail;
      } catch {
        detail = undefined;
      }
    }
    set({
      origin: {
        name: "지도에서 지정한 위치",
        detail: detail || `${pickCoord[1].toFixed(5)}, ${pickCoord[0].toFixed(5)}`,
        coord: pickCoord,
      },
      picking: false,
      pickCoord: null,
      pickAddr: null,
      phase: "idle",
      road: null,
      elev: null,
      transit: null,
      error: null,
      notice: null,
      focusCoord: pickCoord,
      focusSignal: get().focusSignal + 1,
    });
  },

  async plan() {
    const { origin, dest, mode } = get();
    if (!origin || !dest) return;

    inflight?.abort();
    const ac = new AbortController();
    inflight = ac;

    set({
      phase: "planning",
      error: null,
      notice: null,
      road: null,
      elev: null,
      transit: null,
      fallbackStops: [],
      planIndex: 0,
      nav: { active: false, legIndex: 0, onboard: false, alertedAlight: false },
    });

    try {
      if (mode === "bus") {
        const res = await planTransit(origin.coord, dest.coord, ac.signal);
        if (ac.signal.aborted) return;
        set({ transit: res, phase: "result", fitSignal: get().fitSignal + 1 });
      } else {
        const r = await routeRoad(mode, [origin.coord, dest.coord], ac.signal);
        if (ac.signal.aborted) return;
        set({ road: r, phase: "result", fitSignal: get().fitSignal + 1 });
        // 고도 프로필은 뒤늦게 채워 넣는다 (경로 표시를 막지 않는다)
        if (mode !== "car") {
          void buildElevationProfile(r.geometry).then((p) => {
            if (!ac.signal.aborted && p) set({ elev: p });
          });
        }
      }
    } catch (e) {
      if (ac.signal.aborted || (e as Error)?.name === "AbortError") return;

      if (e instanceof TransitError) {
        // 짧은 거리라면 버스를 못 찾은 게 아니라 걸어가는 편이 나은 경우가 많다.
        // 그럴 땐 에러 대신 도보 경로를 바로 내준다.
        if (e.code !== "network") {
          try {
            const walk = await routeRoad("walk", [origin.coord, dest.coord], ac.signal);
            if (!ac.signal.aborted && walk.duration <= 2400) {
              set({
                road: walk,
                phase: "result",
                fitSignal: get().fitSignal + 1,
                notice:
                  "이 구간은 버스로 이어지는 노선을 찾지 못했어요. 대신 걸어가는 길을 안내합니다.",
              });
              void buildElevationProfile(walk.geometry).then((p) => {
                if (!ac.signal.aborted && p) set({ elev: p });
              });
              return;
            }
          } catch {
            /* 도보도 실패하면 아래 에러 처리로 */
          }
        }

        // 노선 데이터가 없는 지역이면 정류장이라도 찍어준다
        if (e.code === "no_lines" || e.code === "no_route") {
          try {
            const stops = await nearbyStops(origin.coord, 1000, ac.signal);
            if (!ac.signal.aborted) set({ fallbackStops: stops });
          } catch {
            /* 무시 */
          }
        }
        set({
          phase: "error",
          error: {
            title:
              e.code === "no_lines"
                ? "이 지역 버스 노선 정보가 없어요"
                : e.code === "no_stops"
                  ? "주변에 정류장이 없어요"
                  : e.code === "no_route"
                    ? "버스로 이어지는 길을 못 찾았어요"
                    : "대중교통 정보를 불러오지 못했어요",
            message: e.message,
            kind: e.code === "network" ? "err" : "warn",
          },
        });
        return;
      }

      const msg =
        e instanceof RouteError ? e.message : ((e as Error).message ?? "경로를 찾지 못했습니다.");
      set({ phase: "error", error: { title: "경로를 찾지 못했어요", message: msg, kind: "err" } });
    }
  },

  reset: () => {
    inflight?.abort();
    set({
      phase: "idle",
      error: null,
      notice: null,
      road: null,
      elev: null,
      transit: null,
      fallbackStops: [],
      nav: { active: false, legIndex: 0, onboard: false, alertedAlight: false },
      follow: false,
    });
  },

  selectPlan: (i) =>
    set({
      planIndex: i,
      nav: { active: false, legIndex: 0, onboard: false, alertedAlight: false },
      fitSignal: get().fitSignal + 1,
    }),

  startNav: () => {
    positionSource.startWatch();
    set({
      nav: { active: true, legIndex: 0, onboard: false, alertedAlight: false },
      follow: true,
      dim: "3d",
    });
  },

  stopNav: () =>
    set({
      nav: { active: false, legIndex: 0, onboard: false, alertedAlight: false },
      follow: false,
    }),

  board: () => {
    const plan = get().currentPlan();
    const nav = get().nav;
    const leg = plan?.legs[nav.legIndex];
    set({ nav: { ...nav, onboard: true, alertedAlight: false } });
    if (leg?.ref) get().toast_(`${leg.ref} 승차. ${leg.to.name} 에서 내리세요.`);
  },

  alight: () => {
    const nav = get().nav;
    get().toast_("하차 완료. 다음 단계로 넘어갑니다.");
    set({ nav: { ...nav, legIndex: nav.legIndex + 1, onboard: false, alertedAlight: false } });
  },

  nextLeg: () => {
    const nav = get().nav;
    const plan = get().currentPlan();
    const max = (plan?.legs.length ?? 1) - 1;
    set({ nav: { ...nav, legIndex: Math.min(max, nav.legIndex + 1), onboard: false } });
  },

  currentPlan: () => {
    const { transit, planIndex } = get();
    return transit?.plans[planIndex] ?? null;
  },

  /** GPS 가 갱신될 때마다 안내 단계를 자동으로 넘긴다 */
  onFix: (f) => {
    set({ fix: f });
    const st = get();
    if (!st.nav.active) return;

    if (st.mode !== "bus") return; // 도보/자동차/자전거는 지도 추적만
    const plan = st.currentPlan();
    if (!plan) return;
    const nav = st.nav;
    const leg = plan.legs[nav.legIndex];
    if (!leg) return;

    if (leg.kind === "walk") {
      if (distance(f.coord, leg.to.coord) < 32 && nav.legIndex < plan.legs.length - 1) {
        set({ nav: { ...nav, legIndex: nav.legIndex + 1, onboard: false, alertedAlight: false } });
        const nextLeg = plan.legs[nav.legIndex + 1];
        if (nextLeg?.ref) st.toast_(`${leg.to.name} 도착. ${nextLeg.ref} 을(를) 타세요.`);
      }
      return;
    }

    // 승차 구간
    if (!nav.onboard) {
      const nearStop = distance(f.coord, leg.from.coord) < 60;
      const along = nearestOnPath(leg.geometry, f.coord);
      const movedIn = along.dist < 45 && along.along > 140;
      const fast = (f.speed ?? 0) > 4.2;
      if ((nearStop && fast) || movedIn) {
        set({ nav: { ...nav, onboard: true, alertedAlight: false } });
        st.toast_(`${leg.ref} 승차 확인. ${leg.to.name} 에서 내리세요.`);
      }
      return;
    }

    // 탑승 중
    const toStop = distance(f.coord, leg.to.coord);
    if (toStop < 260 && !nav.alertedAlight) {
      set({ nav: { ...nav, alertedAlight: true } });
      st.toast_(`곧 ${leg.to.name} 입니다. 내릴 준비하세요.`);
    }
    if (toStop < 40 && (f.speed ?? 0) < 2.2) {
      const isLast = nav.legIndex >= plan.legs.length - 1;
      set({
        nav: {
          ...nav,
          legIndex: Math.min(plan.legs.length - 1, nav.legIndex + 1),
          onboard: false,
          alertedAlight: false,
        },
      });
      if (!isLast) st.toast_(`${leg.to.name} 하차. 안내를 계속합니다.`);
    }
  },
}));

/** 경로 전체 좌표 (지도 맞춤용) */
export function planCoords(s: {
  road: RoadRoute | null;
  transit: TransitResult | null;
  planIndex: number;
  origin: Place | null;
  dest: Place | null;
}): LngLat[] {
  const out: LngLat[] = [];
  if (s.origin) out.push(s.origin.coord);
  if (s.dest) out.push(s.dest.coord);
  if (s.road) out.push(...s.road.geometry);
  const p = s.transit?.plans[s.planIndex];
  if (p) for (const l of p.legs) out.push(...l.geometry);
  return out;
}

// dev 에서 콘솔로 상태를 확인/조작하기 위한 창구
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__store = useStore;
}
