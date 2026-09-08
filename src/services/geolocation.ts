import type { LngLat } from "../types";

export interface Fix {
  coord: LngLat;
  accuracy: number;
  /** 진행 방위각(도). 모르면 null */
  heading: number | null;
  /** m/s */
  speed: number | null;
  at: number;
  /** 실제 GPS 가 아니라 시뮬레이터가 만든 값 */
  simulated?: boolean;
}

type Listener = (fix: Fix) => void;

/**
 * 위치 소스.
 * 실제 GPS(watchPosition)를 쓰되, 개발/테스트용 시뮬레이션 좌표가 주입되면
 * 그쪽이 우선한다. 앱 나머지 코드는 어느 쪽인지 신경 쓰지 않는다.
 */
class PositionSource {
  private listeners = new Set<Listener>();
  private watchId: number | null = null;
  private mock: Fix | null = null;
  last: Fix | null = null;
  error: string | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.last) fn(this.last);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(fix: Fix) {
    this.last = fix;
    for (const fn of this.listeners) fn(fix);
  }

  /** 시뮬레이션 좌표 주입 (null 이면 해제하고 실제 GPS 로 복귀) */
  setMock(coord: LngLat | null, heading: number | null = null, speed: number | null = null) {
    if (!coord) {
      this.mock = null;
      return;
    }
    this.mock = { coord, accuracy: 5, heading, speed, at: Date.now(), simulated: true };
    this.emit(this.mock);
  }

  get isMocked() {
    return this.mock !== null;
  }

  startWatch() {
    if (this.watchId !== null) return;
    if (!("geolocation" in navigator)) {
      this.error = "이 브라우저에서는 위치 기능을 쓸 수 없습니다.";
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        if (this.mock) return; // 시뮬레이션 중에는 무시
        this.error = null;
        this.emit({
          coord: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy ?? 30,
          heading: Number.isFinite(p.coords.heading as number) ? (p.coords.heading as number) : null,
          speed: Number.isFinite(p.coords.speed as number) ? (p.coords.speed as number) : null,
          at: p.timestamp,
        });
      },
      (err) => {
        this.error = describe(err);
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }

  stopWatch() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

function describe(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "위치 접근이 거부됐습니다. 설정 > Safari > 위치 에서 허용해 주세요.";
    case err.POSITION_UNAVAILABLE:
      return "지금은 위치를 확인할 수 없습니다. 실외로 나가거나 잠시 후 다시 시도해 주세요.";
    case err.TIMEOUT:
      return "위치를 가져오는 데 너무 오래 걸립니다.";
    default:
      return "위치를 가져오지 못했습니다.";
  }
}

export const positionSource = new PositionSource();

/** 한 번만 위치를 받아온다 */
export function getCurrentFix(timeoutMs = 15000): Promise<Fix> {
  if (positionSource.isMocked && positionSource.last) {
    return Promise.resolve(positionSource.last);
  }
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("이 브라우저에서는 위치 기능을 쓸 수 없습니다."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          coord: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy ?? 30,
          heading: Number.isFinite(p.coords.heading as number) ? (p.coords.heading as number) : null,
          speed: Number.isFinite(p.coords.speed as number) ? (p.coords.speed as number) : null,
          at: p.timestamp,
        }),
      (err) => reject(new Error(describe(err))),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: timeoutMs }
    );
  });
}
