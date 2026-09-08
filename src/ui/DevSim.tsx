import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { positionSource } from "../services/geolocation";
import { pathLength, pointAtDistance } from "../lib/geo";
import type { LngLat } from "../types";
import { IcPlay, IcStop, IcTarget } from "./Icons";

/**
 * 개발용 주행 시뮬레이터.
 * 실제로 걷거나 버스를 타지 않고도 안내 단계 전환·3D 카메라 추적을 검증할 수 있게
 * 계획된 경로를 따라 가짜 GPS 를 흘려보낸다. dev 빌드에서만 뜬다.
 */
export default function DevSim() {
  const [running, setRunning] = useState(false);
  const [mult, setMult] = useState(6);
  const timer = useRef<number | null>(null);
  const along = useRef(0);

  const road = useStore((s) => s.road);
  const transit = useStore((s) => s.transit);
  const planIndex = useStore((s) => s.planIndex);
  const origin = useStore((s) => s.origin);
  const mode = useStore((s) => s.mode);

  /** 시뮬레이션에 쓸 경로 + 구간별 속도(m/s) */
  function buildTrack(): { path: LngLat[]; speedAt: (d: number) => number } | null {
    if (mode !== "bus" && road) {
      const v = mode === "walk" ? 1.35 : mode === "bike" ? 4.5 : 11;
      return { path: road.geometry, speedAt: () => v };
    }
    const plan = transit?.plans[planIndex];
    if (plan) {
      const path: LngLat[] = [];
      const marks: { end: number; v: number }[] = [];
      let acc = 0;
      for (const leg of plan.legs) {
        const g = leg.geometry;
        if (g.length < 2) continue;
        if (path.length) path.push(...g.slice(1));
        else path.push(...g);
        acc += pathLength(g);
        marks.push({ end: acc, v: leg.kind === "ride" ? 8.5 : 1.35 });
      }
      if (path.length < 2) return null;
      return {
        path,
        speedAt: (d) => marks.find((m) => d <= m.end)?.v ?? 1.35,
      };
    }
    return null;
  }

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
  };

  const start = () => {
    const track = buildTrack();
    if (!track) return;
    const total = pathLength(track.path);
    if (along.current >= total) along.current = 0;

    setRunning(true);
    const dt = 0.25;
    timer.current = window.setInterval(() => {
      const v = track.speedAt(along.current);
      along.current += v * dt * mult;
      if (along.current >= total) {
        along.current = total;
        const p = pointAtDistance(track.path, total);
        positionSource.setMock(p.coord, p.heading, 0);
        stop();
        return;
      }
      const p = pointAtDistance(track.path, along.current);
      positionSource.setMock(p.coord, p.heading, v);
    }, dt * 1000);
  };

  useEffect(() => () => stop(), []);
  useEffect(() => {
    along.current = 0;
  }, [road, transit, planIndex]);

  const canRun = !!(road || transit);

  return (
    <div className="devbar">
      <span>시뮬</span>
      <button
        onClick={() => {
          if (!origin) return;
          along.current = 0;
          positionSource.setMock(origin.coord, 0, 0);
        }}
        title="출발지에 서기"
      >
        <IcTarget size={12} />
      </button>
      <button className={running ? "on" : ""} disabled={!canRun} onClick={running ? stop : start}>
        {running ? <IcStop size={11} /> : <IcPlay size={11} />}
      </button>
      <button onClick={() => setMult((m) => (m >= 16 ? 1 : m * 2))}>x{mult}</button>
      <button
        onClick={() => {
          stop();
          along.current = 0;
          positionSource.setMock(null);
        }}
      >
        GPS
      </button>
    </div>
  );
}
