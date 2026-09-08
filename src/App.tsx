import { useEffect, useState } from "react";
import MapView from "./map/MapView";
import PlaceFields, { pushRecent } from "./ui/PlaceFields";
import ResultPanel, { ModeIcon, MODE_LABEL } from "./ui/ResultPanel";
import DevSim from "./ui/DevSim";
import InstallHint from "./ui/InstallHint";
import { IcArrow, IcTarget } from "./ui/Icons";
import { useStore } from "./state/store";
import { positionSource } from "./services/geolocation";
import { searchPlaces } from "./services/geocode";
import type { TravelMode } from "./types";

const MODES: TravelMode[] = ["walk", "bus", "car", "bike"];

export default function App() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const dim = useStore((s) => s.dim);
  const setDim = useStore((s) => s.setDim);
  const origin = useStore((s) => s.origin);
  const dest = useStore((s) => s.dest);
  const setDest = useStore((s) => s.setDest);
  const phase = useStore((s) => s.phase);
  const plan = useStore((s) => s.plan);
  const toast = useStore((s) => s.toast);
  const toast_ = useStore((s) => s.toast_);
  const follow = useStore((s) => s.follow);
  const setFollow = useStore((s) => s.setFollow);
  const onFix = useStore((s) => s.onFix);
  const locateMe = useStore((s) => s.locateMe);
  const fix = useStore((s) => s.fix);
  const picking = useStore((s) => s.picking);
  const pickAddr = useStore((s) => s.pickAddr);
  const pickCoord = useStore((s) => s.pickCoord);
  const startPick = useStore((s) => s.startPick);
  const cancelPick = useStore((s) => s.cancelPick);
  const confirmPick = useStore((s) => s.confirmPick);

  const [resolving, setResolving] = useState(false);

  // 위치 구독
  useEffect(() => {
    const un = positionSource.subscribe(onFix);
    positionSource.startWatch();
    return () => {
      un();
      positionSource.stopWatch();
    };
  }, [onFix]);

  const hasResult = phase !== "idle";

  async function onSubmit() {
    if (!origin) {
      toast_("출발지를 먼저 정해 주세요. 칸을 누르면 현재 위치로 잡을 수 있어요.");
      return;
    }
    // 도착지 글자만 쓰고 후보를 안 고른 경우, 가장 유력한 결과로 자동 확정
    if (!dest) {
      const input = document.querySelector<HTMLInputElement>('input[aria-label="도착지"]');
      const q = input?.value?.trim();
      if (!q) {
        toast_("도착지를 입력해 주세요.");
        return;
      }
      setResolving(true);
      try {
        const r = await searchPlaces(q, origin.coord);
        if (!r[0]) {
          toast_(`"${q}" 을(를) 찾지 못했어요. 다른 이름으로 검색해 보세요.`);
          return;
        }
        setDest(r[0]);
        pushRecent(r[0]);
      } finally {
        setResolving(false);
      }
    }
    await plan();
  }

  return (
    <div className="app">
      <div className={`sheet${hasResult ? " compact" : ""}`}>
        {hasResult ? (
          <button className="trip-bar" onClick={() => useStore.getState().reset()}>
            <span className="trip-names">
              <span className="dot start" />
              <b>{origin?.name ?? "출발지"}</b>
              <span className="arrow">→</span>
              <span className="dot end" />
              <b>{dest?.name ?? "도착지"}</b>
            </span>
            <span className="trip-edit">수정</span>
          </button>
        ) : (
          <div className="hero">
            <h1>어디까지 모실까요</h1>
            <p>출발지와 도착지만 넣으면 걷는 길부터 버스 환승까지 한 번에 잡아드려요.</p>
          </div>
        )}

        <div className="segbar" role="tablist" aria-label="이동 수단">
          {MODES.map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "on" : ""}
              onClick={() => setMode(m)}
            >
              <ModeIcon m={m} size={16} />
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        {!hasResult && (
          <>
            <PlaceFields />

            {origin?.isCurrent && (
              <div className="loc-note">
                <span className="loc-addr">{origin.detail}</span>
                {fix && fix.accuracy > 300 && (
                  <span className="loc-warn">
                    오차 약 {Math.round(fix.accuracy)}m — 실내나 PC 에서는 위치가 크게
                    빗나갈 수 있어요.
                  </span>
                )}
                <button className="loc-fix" onClick={startPick}>
                  지도에서 맞추기
                </button>
              </div>
            )}

            <button className="cta" onClick={onSubmit} disabled={resolving || picking}>
              {resolving && <span className="spinner" />}
              경로 찾기
              <IcArrow size={17} />
            </button>
          </>
        )}
      </div>

      <div className="mapwrap">
        <MapView />

        <div className="map-hud">
          <div className="dtoggle" role="tablist" aria-label="지도 보기 방식">
            <button
              role="tab"
              aria-selected={dim === "2d"}
              className={dim === "2d" ? "on" : ""}
              onClick={() => setDim("2d")}
            >
              2D
            </button>
            <button
              role="tab"
              aria-selected={dim === "3d"}
              className={dim === "3d" ? "on" : ""}
              onClick={() => setDim("3d")}
            >
              3D
            </button>
          </div>

          <div className="mapbtns">
            <button
              className={`mapbtn${follow ? " on" : ""}`}
              aria-label="내 위치 따라가기"
              onClick={async () => {
                if (!fix) await locateMe();
                setFollow(!follow);
              }}
            >
              <IcTarget size={17} />
            </button>
          </div>
        </div>

        {picking && (
          <>
            <div className="pick-cross" aria-hidden>
              <span className="ring" />
              <span className="dot" />
              <span className="stem" />
            </div>
            <div className="pick-bar">
              <div className="pick-tx">
                <b>출발지를 지도에서 맞춰 주세요</b>
                <span>
                  {pickAddr?.detail ??
                    (pickCoord
                      ? `${pickCoord[1].toFixed(5)}, ${pickCoord[0].toFixed(5)}`
                      : "지도를 움직이면 주소가 나옵니다")}
                </span>
              </div>
              <div className="pick-btns">
                <button className="pick-cancel" onClick={cancelPick}>
                  취소
                </button>
                <button className="pick-ok" onClick={() => void confirmPick()}>
                  이 위치로
                </button>
              </div>
            </div>
          </>
        )}

        {!picking && <ResultPanel />}
        {!picking && phase === "idle" && <InstallHint />}
        {toast && <div className="toast">{toast}</div>}
        {import.meta.env.DEV && !picking && <DevSim />}
      </div>
    </div>
  );
}
