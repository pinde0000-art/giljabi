import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { fmtClock, fmtDistance, fmtDuration } from "../lib/geo";
import ElevationChart from "./ElevationChart";
import {
  IcBike,
  IcBus,
  IcCar,
  IcCheck,
  IcClock,
  IcFlag,
  IcPlay,
  IcStop,
  IcTrain,
  IcWalk,
} from "./Icons";
import type { TransitLeg, TransitPlan } from "../types";
import { vehicleLabel } from "../services/motis";

const MODE_LABEL = { walk: "도보", bus: "버스", car: "자동차", bike: "자전거" } as const;

/** 오래 걸릴 때 "멈춘 게 아니라 찾는 중" 임을 보여준다 */
function Elapsed() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSec((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (sec < 3) return null;
  return <span style={{ color: "#6c6c7c" }}> · {sec}초째</span>;
}

function ModeIcon({ m, size = 16 }: { m: string; size?: number }) {
  if (m === "bus") return <IcBus size={size} />;
  if (m === "car") return <IcCar size={size} />;
  if (m === "bike") return <IcBike size={size} />;
  return <IcWalk size={size} />;
}

/* ------------------------------------------------------------------ */

function RoadResult() {
  const road = useStore((s) => s.road);
  const elev = useStore((s) => s.elev);
  const mode = useStore((s) => s.mode);
  const nav = useStore((s) => s.nav);
  const startNav = useStore((s) => s.startNav);
  const stopNav = useStore((s) => s.stopNav);
  const [showAll, setShowAll] = useState(false);
  if (!road) return null;

  const steps = showAll ? road.steps : road.steps.slice(0, 6);

  return (
    <>
      <div className="summary">
        <span className="big">{fmtDuration(road.duration)}</span>
        <span className="sub">{fmtDistance(road.distance)}</span>
        <span className="tag">
          {MODE_LABEL[mode as keyof typeof MODE_LABEL]} · 최적 경로
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: "#a0a0ae", display: "flex", gap: 6, alignItems: "center" }}>
        <IcClock size={13} />
        {fmtClock(road.duration)} 도착 예정
      </div>

      {elev && (mode === "walk" || mode === "bike") && (
        <>
          <div className="sec-title">고도 — 오르막·내리막</div>
          <ElevationChart elev={elev} />
        </>
      )}

      <button className="cta" onClick={nav.active ? stopNav : startNav} style={{ marginTop: 16 }}>
        {nav.active ? <IcStop /> : <IcPlay />}
        {nav.active ? "안내 멈추기" : "3D 로 따라가며 안내 받기"}
      </button>

      <div className="sec-title">turn-by-turn 안내</div>
      <div className="steps">
        {steps.map((s, i) => (
          <div key={i} className="step active">
            <div className="step-rail">
              <div className="step-ic">{i + 1}</div>
              <div className="step-line" />
            </div>
            <div className="step-body">
              <div className="step-t1">{s.instruction}</div>
              <div className="step-t2">
                {fmtDistance(s.distance)} · {fmtDuration(s.duration)}
              </div>
            </div>
          </div>
        ))}
      </div>
      {road.steps.length > 6 && (
        <button className="cta ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "접기" : `나머지 ${road.steps.length - 6}단계 더 보기`}
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

/** 시각을 "오후 5:03" 으로 */
function clock(t?: number): string {
  if (!t) return "";
  const d = new Date(t);
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${mm}`;
}

/** 승차 뱃지 문구 — 버스는 "342번", 지하철/기차는 노선명 그대로 */
function badge(leg: TransitLeg): string {
  const r = leg.ref ?? "";
  if (!r) return vehicleLabel(leg.vehicle);
  return leg.vehicle === "bus" ? `${r}번` : r;
}

function RideStep({ leg, state }: { leg: TransitLeg; state: "done" | "active" | "todo" }) {
  const [open, setOpen] = useState(false);
  const nav = useStore((s) => s.nav);
  const board = useStore((s) => s.board);
  const alight = useStore((s) => s.alight);
  const navActive = useStore((s) => s.nav.active);

  const stops = leg.rideStops ?? [];
  const mid = stops.slice(1, -1);
  const vlabel = vehicleLabel(leg.vehicle);
  const icon = leg.vehicle === "subway" || leg.vehicle === "train" ? <IcTrain size={16} /> : <IcBus size={16} />;

  return (
    <div className={`step ${state}`}>
      <div className="step-rail">
        <div className="step-ic">{state === "done" ? <IcCheck /> : icon}</div>
        <div className="step-line" />
      </div>
      <div className="step-body">
        <div className="step-t1">
          <span className={`busno ${leg.colorKey ?? "b"}`}>{badge(leg)}</span>
          {leg.from.name} 승차
        </div>
        <div className="step-t2">
          {leg.headsign ? `${leg.headsign} 방면 · ` : ""}
          {Math.max(1, stops.length - 1)}개 정거장 · {fmtDuration(leg.duration)}
          {leg.startTime ? ` · ${clock(leg.startTime)} 출발` : ""}
        </div>
        <div className="step-t2" style={{ color: "#fca5a5", fontWeight: 700, marginTop: 5 }}>
          내리는 곳 — {leg.to.name}
          {leg.endTime ? ` (${clock(leg.endTime)} 도착)` : ""}
        </div>

        {mid.length > 0 && (
          <>
            <button
              className="step-meta"
              onClick={() => setOpen((v) => !v)}
              style={{ textDecoration: "underline", marginTop: 6 }}
            >
              {open ? "지나는 정거장 접기" : `지나는 정거장 ${mid.length}곳 보기`}
            </button>
            {open && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "#8a8a99",
                  lineHeight: 1.7,
                  borderLeft: "2px solid #26262f",
                  paddingLeft: 10,
                }}
              >
                {mid.map((s, i) => (
                  <div key={`${s.id}-${i}`}>{s.name}</div>
                ))}
              </div>
            )}
          </>
        )}

        {navActive && state === "active" && (
          <div>
            {!nav.onboard ? (
              <button className="step-action" onClick={board}>
                <IcCheck /> {badge(leg)} 탔어요
              </button>
            ) : (
              <button className="step-action" onClick={alight}>
                <IcFlag /> {leg.to.name}에서 내렸어요
              </button>
            )}
          </div>
        )}
        {navActive && state === "active" && nav.onboard && (
          <div className="step-meta" style={{ color: "#93c5fd" }}>
            {vlabel} 탑승 중 — {leg.to.name}에 가까워지면 알려드릴게요
          </div>
        )}
      </div>
    </div>
  );
}

function WalkStep({
  leg,
  state,
  last,
  transfer,
  waitMin,
}: {
  leg: TransitLeg;
  state: "done" | "active" | "todo";
  last: boolean;
  /** 승차 구간 사이의 환승 도보인지 */
  transfer?: boolean;
  /** 갈아탈 차를 기다리는 시간(분) */
  waitMin?: number;
}) {
  const navActive = useStore((s) => s.nav.active);
  const nextLeg = useStore((s) => s.nextLeg);

  // 같은 정류장에서 갈아타면 거리가 0 이다. "0m 걷기" 대신 대기시간을 보여준다.
  const sameStop = transfer && leg.distance < 25;
  const title = last
    ? `${leg.from.name} → 도착지까지 걷기`
    : sameStop
      ? `${leg.to.name}에서 갈아타기`
      : transfer
        ? `${leg.to.name}까지 걸어서 환승`
        : `${leg.to.name}까지 걷기`;

  const sub = sameStop
    ? waitMin !== undefined
      ? `내린 자리에서 그대로 환승 · ${waitMin}분 대기`
      : "내린 자리에서 그대로 환승"
    : `${fmtDistance(leg.distance)} · 약 ${fmtDuration(leg.duration)}` +
      (transfer && waitMin !== undefined ? ` · 도착 후 ${waitMin}분 대기` : "");

  return (
    <div className={`step ${state}`}>
      <div className="step-rail">
        <div className="step-ic">
          {state === "done" ? <IcCheck /> : last ? <IcFlag /> : <IcWalk size={16} />}
        </div>
        <div className="step-line" />
      </div>
      <div className="step-body">
        <div className="step-t1">{title}</div>
        <div className="step-t2">{sub}</div>
        {navActive && state === "active" && !last && (
          <button className="step-action ghost" onClick={nextLeg}>
            <IcCheck /> 도착했어요
          </button>
        )}
      </div>
    </div>
  );
}

function TransitResultView() {
  const transit = useStore((s) => s.transit);
  const planIndex = useStore((s) => s.planIndex);
  const selectPlan = useStore((s) => s.selectPlan);
  const nav = useStore((s) => s.nav);
  const startNav = useStore((s) => s.startNav);
  const stopNav = useStore((s) => s.stopNav);
  if (!transit) return null;

  const plan: TransitPlan = transit.plans[planIndex];
  if (!plan) return null;

  // 첫 편이 한참 뒤면(심야 등) 그 사실을 분명히 알려준다
  const waitMin = plan.startTime ? Math.round((plan.startTime - Date.now()) / 60000) : 0;

  return (
    <>
      <div className="summary">
        <span className="big">{fmtDuration(plan.totalDuration)}</span>
        <span className="sub">
          {plan.transfers === 0 ? "환승 없음" : `환승 ${plan.transfers}회`} · 도보{" "}
          {fmtDistance(plan.walkDistance)}
        </span>
        <span className="tag">버스 · 최적 경로</span>
      </div>
      <div style={{ fontSize: 12.5, color: "#a0a0ae", display: "flex", gap: 6, alignItems: "center" }}>
        <IcClock size={13} />
        {plan.startTime && plan.endTime
          ? `${clock(plan.startTime)} 출발 · ${clock(plan.endTime)} 도착`
          : `${fmtClock(plan.totalDuration)} 도착 예정 (대기시간 포함 추정)`}
      </div>

      {waitMin > 45 && (
        <div className="note warn" style={{ marginTop: 10 }}>
          <div>
            가장 빠른 편이 <b>{fmtDuration(waitMin * 60)} 뒤</b>에 출발해요.
            {transit.laterDeparture
              ? " 지금은 막차가 끊긴 시간대라 다음 운행 시작 시간으로 찾았습니다."
              : " 지금은 배차가 끊겼거나 아주 뜸한 시간대입니다."}
          </div>
        </div>
      )}

      {transit.plans.length > 1 && (
        <>
          <div className="sec-title">다른 경로</div>
          <div className="alts">
            {transit.plans.map((p, i) => (
              <button
                key={i}
                className={`altcard${i === planIndex ? " on" : ""}`}
                onClick={() => selectPlan(i)}
              >
                <div className="a1">{fmtDuration(p.totalDuration)}</div>
                <div className="a2">
                  {p.transfers === 0 ? "환승 없음" : `환승 ${p.transfers}회`} · 도보{" "}
                  {fmtDistance(p.walkDistance)}
                </div>
                <div className="a3">
                  {p.lineRefs.map((r, j) => (
                    <span key={j} className="busno">
                      {r}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <button className="cta" onClick={nav.active ? stopNav : startNav} style={{ marginTop: 12 }}>
        {nav.active ? <IcStop /> : <IcPlay />}
        {nav.active ? "안내 멈추기" : "단계별 안내 시작"}
      </button>

      <div className="sec-title">단계별 안내</div>
      <div className="steps">
        {plan.legs.map((leg, i) => {
          const state: "done" | "active" | "todo" = !nav.active
            ? "active"
            : i < nav.legIndex
              ? "done"
              : i === nav.legIndex
                ? "active"
                : "todo";
          if (leg.kind === "ride") return <RideStep key={i} leg={leg} state={state} />;

          const prev = plan.legs[i - 1];
          const next = plan.legs[i + 1];
          const isTransfer = prev?.kind === "ride" && next?.kind === "ride";
          const wait =
            isTransfer && leg.endTime && next.startTime
              ? Math.max(0, Math.round((next.startTime - leg.endTime) / 60000))
              : undefined;
          return (
            <WalkStep
              key={i}
              leg={leg}
              state={state}
              last={i === plan.legs.length - 1}
              transfer={isTransfer}
              waitMin={wait}
            />
          );
        })}
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        <IcClock size={15} />
        {transit.scheduled ? (
          <div>
            국가교통DB 의 <b>실제 운행 시각표</b>로 계산한 경로입니다(Transitous). 다만 실시간
            지연은 반영되지 않으니, 배차 간격이 긴 노선은 정류장 안내판도 함께 확인해 주세요.
          </div>
        ) : (
          <div>
            노선·정류장 순서는 <b>OpenStreetMap 실제 데이터</b>입니다. 다만 이 지역의 공개 시각표
            데이터가 없어서 <b>소요시간과 대기시간은 평균 속도로 추정</b>한 값이에요.
            {transit.approximateShape &&
              " 일부 구간은 노선 도형이 없어 정류장을 직선으로 이어 그렸습니다."}
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

export default function ResultPanel() {
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);
  const reset = useStore((s) => s.reset);
  const plan = useStore((s) => s.plan);
  const fallbackStops = useStore((s) => s.fallbackStops);
  const notice = useStore((s) => s.notice);
  const transit = useStore((s) => s.transit);
  const mode = useStore((s) => s.mode);

  if (phase === "idle") return null;

  return (
    <div className="panel">
      <div className="grabber" />
      <div className="panel-scroll">
        {phase === "planning" && (
          <div className="note" style={{ alignItems: "center" }}>
            <span className="spinner" />
            <div>
              {mode === "bus" ? "버스 시각표를 확인하는 중이에요" : "최적 경로를 계산하는 중이에요"}
              <Elapsed />
            </div>
          </div>
        )}

        {phase === "error" && error && (
          <>
            <div className={`note ${error.kind}`}>
              <div>
                <b>{error.title}</b>
                <div style={{ marginTop: 4 }}>{error.message}</div>
                {fallbackStops.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    주변 정류장 {fallbackStops.length}곳을 지도에 표시했습니다.
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="cta ghost" onClick={() => void plan()} style={{ marginTop: 0 }}>
                다시 시도
              </button>
              <button className="cta ghost" onClick={reset} style={{ marginTop: 0 }}>
                닫기
              </button>
            </div>
          </>
        )}

        {phase === "result" && (
          <>
            {notice && (
              <div className="note warn" style={{ marginBottom: 12 }}>
                <div>{notice}</div>
              </div>
            )}
            {transit ? <TransitResultView /> : <RoadResult />}
          </>
        )}
      </div>
    </div>
  );
}

export { ModeIcon, MODE_LABEL };
