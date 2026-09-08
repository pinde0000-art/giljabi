import { useEffect, useRef } from "react";
import { Map as MLMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { buildStyle, C, LABEL_ANCHOR } from "./style";
import { CharacterLayer } from "./CharacterLayer";
import { useStore, planCoords } from "../state/store";
import { bboxOf, bearing, distance } from "../lib/geo";
import { gradeColor } from "../services/elevation";
import type { FeatureCollection } from "geojson";
import type { ElevProfile, LngLat, TransitPlan } from "../types";

// 빌드 산출물에서는 워커를 dist/mlgl/ 로 따로 복사해 두고 그쪽을 가리킨다 (vite.config.ts 참고)
if (import.meta.env.PROD) {
  setWorkerUrl(new URL("mlgl/maplibre-gl-worker.mjs", document.baseURI).href);
}

const MODE_COLOR: Record<string, string> = {
  walk: C.walk,
  bus: C.bus,
  car: C.car,
  bike: C.bike,
};

const EMPTY = { type: "FeatureCollection", features: [] } as FeatureCollection;

/** 고도 프로필 -> line-gradient 표현식 (경사에 따라 색이 바뀌는 경로선) */
function gradientExpr(elev: ElevProfile | null): any | null {
  if (!elev || elev.points.length < 3) return null;
  const total = elev.points[elev.points.length - 1].d;
  if (total <= 0) return null;

  const maxStops = 42;
  const stride = Math.max(1, Math.ceil(elev.points.length / maxStops));
  const expr: any[] = ["interpolate", ["linear"], ["line-progress"]];
  let last = -1;
  for (let i = 0; i < elev.points.length; i += stride) {
    const p = elev.points[i];
    let t = p.d / total;
    if (t <= last) t = last + 0.0005;
    if (t > 1) break;
    last = t;
    expr.push(t, gradeColor(p.grade));
  }
  if (last < 1) expr.push(1, gradeColor(elev.points[elev.points.length - 1].grade));
  return expr.length >= 5 ? expr : null;
}

export default function MapView() {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const charRef = useRef<CharacterLayer | null>(null);
  const readyRef = useRef(false);
  const disposeRef = useRef<number | null>(null);

  const dim = useStore((s) => s.dim);
  const mode = useStore((s) => s.mode);
  const road = useStore((s) => s.road);
  const elev = useStore((s) => s.elev);
  const transit = useStore((s) => s.transit);
  const planIndex = useStore((s) => s.planIndex);
  const origin = useStore((s) => s.origin);
  const dest = useStore((s) => s.dest);
  const fix = useStore((s) => s.fix);
  const nav = useStore((s) => s.nav);
  const follow = useStore((s) => s.follow);
  const fitSignal = useStore((s) => s.fitSignal);
  const fallbackStops = useStore((s) => s.fallbackStops);
  const phase = useStore((s) => s.phase);
  const picking = useStore((s) => s.picking);
  const focusSignal = useStore((s) => s.focusSignal);

  /* ---------------- 초기화 ---------------- */
  useEffect(() => {
    // React StrictMode 는 개발 중 effect 를 두 번 돌린다.
    // 지도를 만들자마자 remove() 하면 maplibre 워커 풀이 함께 정리되면서
    // 바로 뒤에 만든 지도가 style 을 영원히 못 받는 상태로 멈춘다.
    // 그래서 정리는 한 틱 미뤄 두고, 곧바로 다시 마운트되면 취소한다.
    if (disposeRef.current !== null) {
      window.clearTimeout(disposeRef.current);
      disposeRef.current = null;
    }
    if (!box.current || mapRef.current) return;

    const map = new MLMap({
      container: box.current,
      style: buildStyle(),
      center: [127.0276, 37.4979],
      zoom: 13.5,
      pitch: 0,
      bearing: 0,
      maxPitch: 72,
      attributionControl: { compact: true },
      dragRotate: true,
      pitchWithRotate: true,
      canvasContextAttributes: {
        antialias: true,
        // dev 에서만 켠다 — 스크린샷 검증용. 프로덕션은 성능 때문에 끈다.
        preserveDrawingBuffer: import.meta.env.DEV,
      },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as any).__map = map;

    map.touchZoomRotate.enableRotation();
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");

    const onLoaded = () => {
      if (readyRef.current) return;
      readyRef.current = true;
      addOverlays(map);
      const ch = new CharacterLayer();
      charRef.current = ch;
      map.addLayer(ch as any);
      ch.setVisible(useStore.getState().dim === "3d");
      syncAll();
    };
    if (map.isStyleLoaded()) onLoaded();
    else map.on("load", onLoaded);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current);

    map.on("error", (e: any) => {
      // 타일 404 같은 잡음은 콘솔에만
      console.warn("[map]", e?.error?.message ?? e);
    });

    return () => {
      ro.disconnect();
      disposeRef.current = window.setTimeout(() => {
        disposeRef.current = null;
        map.remove();
        if (mapRef.current === map) mapRef.current = null;
        readyRef.current = false;
        charRef.current = null;
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 오버레이 레이어 ---------------- */
  function addOverlays(map: MLMap) {
    map.addSource("route", { type: "geojson", data: EMPTY, lineMetrics: true });
    map.addSource("transit", { type: "geojson", data: EMPTY });
    map.addSource("stops", { type: "geojson", data: EMPTY });
    map.addSource("od", { type: "geojson", data: EMPTY });
    map.addSource("me", { type: "geojson", data: EMPTY });

    const before = map.getLayer(LABEL_ANCHOR) ? LABEL_ANCHOR : undefined;

    map.addLayer(
      {
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#14101f",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 13, 19, 22],
          "line-opacity": 0.85,
        },
      },
      before
    );
    map.addLayer(
      {
        id: "route-main",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": C.walk,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.2, 16, 8, 19, 15],
        },
      },
      before
    );

    map.addLayer(
      {
        id: "transit-casing",
        type: "line",
        source: "transit",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#14101f",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 16, 13, 19, 20],
          "line-opacity": 0.8,
        },
      },
      before
    );
    map.addLayer(
      {
        id: "transit-walk",
        type: "line",
        source: "transit",
        filter: ["==", ["get", "kind"], "walk"],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": C.walk,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 7, 19, 12],
          "line-dasharray": [0.1, 1.7],
          "line-opacity": ["case", ["==", ["get", "active"], 1], 1, 0.55],
        },
      },
      before
    );
    map.addLayer(
      {
        id: "transit-ride",
        type: "line",
        source: "transit",
        filter: ["==", ["get", "kind"], "ride"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            ["case", ["==", ["get", "active"], 1], 5, 3.4],
            16,
            ["case", ["==", ["get", "active"], 1], 11, 8],
            19,
            ["case", ["==", ["get", "active"], 1], 18, 14],
          ],
          "line-opacity": ["case", ["==", ["get", "active"], 1], 1, 0.6],
        },
      },
      before
    );

    map.addLayer(
      {
        id: "stops-dot",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11,
            ["case", ["==", ["get", "big"], 1], 4, 2],
            16,
            ["case", ["==", ["get", "big"], 1], 8.5, 4],
            19,
            ["case", ["==", ["get", "big"], 1], 12, 6],
          ],
          "circle-color": ["case", ["==", ["get", "big"], 1], "#ffffff", "#dfe6ee"],
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": ["case", ["==", ["get", "big"], 1], 3.5, 1.6],
        },
      },
      before
    );
    map.addLayer(
      {
        id: "stops-label",
        type: "symbol",
        source: "stops",
        minzoom: 13,
        filter: ["==", ["get", "big"], 1],
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-anchor": "left",
          "text-offset": [0.9, 0],
          "text-optional": true,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(18,18,24,0.95)",
          "text-halo-width": 1.6,
        },
      },
      before
    );

    map.addLayer(
      {
        id: "od-halo",
        type: "circle",
        source: "od",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 16, 14, 19, 18],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.24,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": 0.6,
        },
      },
      before
    );
    map.addLayer(
      {
        id: "od-core",
        type: "circle",
        source: "od",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 7, 19, 9],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.4,
        },
      },
      before
    );
    map.addLayer({
      id: "od-label",
      type: "symbol",
      source: "od",
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12.5,
        "text-anchor": "bottom",
        "text-offset": [0, -1.5],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(18,18,24,0.95)",
        "text-halo-width": 1.8,
      },
    });

    map.addLayer(
      {
        id: "me-accuracy",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": "#5b7cfa",
          "circle-opacity": 0.16,
          "circle-stroke-color": "#5b7cfa",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.35,
        },
      },
      before
    );
    map.addLayer({
      id: "me-dot",
      type: "circle",
      source: "me",
      paint: {
        "circle-radius": 7,
        "circle-color": "#5b7cfa",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.5,
      },
    });
  }

  /* ---------------- 데이터 반영 ---------------- */
  function syncAll() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const s = useStore.getState();

    // 도로 경로
    const routeFC: FeatureCollection = { type: "FeatureCollection", features: [] };
    if (s.road && s.mode !== "bus") {
      routeFC.features.push({
        type: "Feature",
        properties: { kind: "road" },
        geometry: { type: "LineString", coordinates: s.road.geometry },
      });
    }
    (map.getSource("route") as GeoJSONSource | undefined)?.setData(routeFC);

    const grad = s.mode === "walk" || s.mode === "bike" ? gradientExpr(s.elev) : null;
    if (map.getLayer("route-main")) {
      if (grad) {
        map.setPaintProperty("route-main", "line-color", "#ffffff");
        map.setPaintProperty("route-main", "line-gradient", grad);
      } else {
        map.setPaintProperty("route-main", "line-gradient", null as any);
        map.setPaintProperty("route-main", "line-color", MODE_COLOR[s.mode] ?? C.route);
      }
    }

    // 대중교통
    const plan: TransitPlan | null = s.transit?.plans[s.planIndex] ?? null;
    const trFC: FeatureCollection = { type: "FeatureCollection", features: [] };
    const stopFC: FeatureCollection = { type: "FeatureCollection", features: [] };

    if (plan) {
      plan.legs.forEach((leg, i) => {
        const active = s.nav.active && i === s.nav.legIndex ? 1 : 0;
        trFC.features.push({
          type: "Feature",
          properties: {
            kind: leg.kind,
            color: leg.kind === "ride" ? busColor(leg.colorKey) : C.walk,
            active,
            i,
          },
          geometry: { type: "LineString", coordinates: leg.geometry },
        });
        if (leg.kind === "ride") {
          // 중간 정류장 (작은 점)
          (leg.rideStops ?? []).slice(1, -1).forEach((st) => {
            stopFC.features.push({
              type: "Feature",
              properties: { big: 0, color: busColor(leg.colorKey), label: st.name },
              geometry: { type: "Point", coordinates: st.coord },
            });
          });
          // 승차 / 하차 (큰 점 + 라벨)
          stopFC.features.push({
            type: "Feature",
            properties: {
              big: 1,
              color: busColor(leg.colorKey),
              label: `${leg.from.name} · ${rideBadge(leg)} 승차`,
            },
            geometry: { type: "Point", coordinates: leg.from.coord },
          });
          stopFC.features.push({
            type: "Feature",
            properties: {
              big: 1,
              color: "#f87171",
              label: `${leg.to.name} 하차`,
            },
            geometry: { type: "Point", coordinates: leg.to.coord },
          });
        }
      });
    } else if (s.fallbackStops.length) {
      for (const st of s.fallbackStops) {
        stopFC.features.push({
          type: "Feature",
          properties: { big: 0, color: C.bus, label: st.name },
          geometry: { type: "Point", coordinates: st.coord },
        });
      }
    }
    (map.getSource("transit") as GeoJSONSource | undefined)?.setData(trFC);
    (map.getSource("stops") as GeoJSONSource | undefined)?.setData(stopFC);

    // 출발 / 도착
    const odFC: FeatureCollection = { type: "FeatureCollection", features: [] };
    if (s.origin)
      odFC.features.push({
        type: "Feature",
        properties: { color: C.walk, label: "출발" },
        geometry: { type: "Point", coordinates: s.origin.coord },
      });
    if (s.dest)
      odFC.features.push({
        type: "Feature",
        properties: { color: C.pin, label: "도착" },
        geometry: { type: "Point", coordinates: s.dest.coord },
      });
    (map.getSource("od") as GeoJSONSource | undefined)?.setData(odFC);

    syncMe();
  }

  function syncMe() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const s = useStore.getState();
    const meFC: FeatureCollection = { type: "FeatureCollection", features: [] };
    if (s.fix && s.dim === "2d") {
      const z = map.getZoom();
      const mPerPx = (156543.03392 * Math.cos((s.fix.coord[1] * Math.PI) / 180)) / Math.pow(2, z);
      meFC.features.push({
        type: "Feature",
        properties: { r: Math.max(8, Math.min(90, s.fix.accuracy / mPerPx)) },
        geometry: { type: "Point", coordinates: s.fix.coord },
      });
    }
    (map.getSource("me") as GeoJSONSource | undefined)?.setData(meFC);
  }

  /** 승차 뱃지 문구 — 버스는 "342번", 지하철은 노선명 그대로 */
  function rideBadge(leg: { ref?: string; vehicle?: string }): string {
    const r = leg.ref ?? "";
    if (!r) return "탑승";
    return leg.vehicle === "bus" ? `${r}번` : r;
  }

  function busColor(k?: "b" | "g" | "r" | "y"): string {
    switch (k) {
      case "g":
        return "#4ade80";
      case "r":
        return "#f87171";
      case "y":
        return "#fbbf24";
      default:
        return C.bus;
    }
  }

  /* ---------------- 상태 -> 지도 ---------------- */
  useEffect(() => {
    syncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [road, elev, transit, planIndex, origin, dest, mode, nav.legIndex, nav.active, fallbackStops]);

  useEffect(() => {
    syncMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, dim]);

  /* 시트/패널 높이가 바뀌면 캔버스 크기를 다시 맞춘다
     (ResizeObserver 는 탭이 백그라운드일 때 통지가 밀린다) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = window.setTimeout(() => map.resize(), 60);
    return () => window.clearTimeout(t);
  }, [phase, dim, transit, road]);

  /* 2D / 3D 전환 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const is3d = dim === "3d";

    const setVis = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    setVis("building-3d", is3d);
    setVis("building-2d", !is3d);
    setVis("hillshade", is3d);
    setVis("me-dot", !is3d);
    setVis("me-accuracy", !is3d);
    charRef.current?.setVisible(is3d);

    if (is3d) {
      try {
        map.setTerrain({ source: "dem", exaggeration: 1.15 });
      } catch (e) {
        console.warn("terrain", e);
      }
      // 3인칭 시점: 너무 낮게 붙으면 카메라가 건물 안으로 들어가 화면이 벽으로 꽉 찬다.
      map.easeTo({
        pitch: 60,
        zoom: Math.min(18, Math.max(map.getZoom(), 17.0)),
        duration: 700,
      });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
    syncMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim]);

  /* 경로 전체 맞춤 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || fitSignal === 0) return;
    const s = useStore.getState();
    const coords = planCoords(s);
    if (coords.length < 2) return;
    const [w, so, e, n] = bboxOf(coords, 90);

    // 레이아웃이 막 바뀐 직후일 수 있으니 캔버스 크기부터 맞추고,
    // 실제 반영될 때까지 한 틱 기다렸다가 계산한다.
    map.resize();

    const doFit = () => {
      map.resize();

      // 결과 패널이 덮는 만큼만 아래 여백을 준다.
      // 기준은 반드시 "지도 캔버스의 실제 높이" — 창 높이로 계산하면
      // 여백이 지도보다 커져서 fitBounds 가 터무니없이 축소된다.
      const h = map.getCanvas().clientHeight || map.getContainer().clientHeight || 400;
      const cw = map.getCanvas().clientWidth || 375;
      const panelH = (document.querySelector(".panel") as HTMLElement | null)?.offsetHeight ?? 0;

      let top = Math.min(56, Math.round(h * 0.1));
      let bottom = Math.min(Math.max(36, panelH + 12), Math.round(h * 0.46));
      // 경로가 들어갈 세로 공간을 최소 40% 는 남긴다
      const maxV = h * 0.6;
      if (top + bottom > maxV) {
        const k = maxV / (top + bottom);
        top = Math.floor(top * k);
        bottom = Math.floor(bottom * k);
      }
      const side = Math.min(40, Math.round(cw * 0.1));

      map.fitBounds(
        [
          [w, so],
          [e, n],
        ],
        {
          padding: { top, bottom, left: side, right: side },
          duration: 900,
          pitch: s.dim === "3d" ? 55 : 0,
          maxZoom: 17.5,
        }
      );
    };

    const timer = window.setTimeout(doFit, 90);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  /* 특정 지점으로 지도 옮기기 (현재 위치 잡기 / 지도에서 찍기 확정) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || focusSignal === 0) return;
    const c = useStore.getState().focusCoord;
    if (!c) return;
    map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 16.2), duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  /* 지도에서 출발지 찍기 — 지도를 멈출 때마다 중심 좌표를 스토어로 */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !picking) return;
    const push = () => {
      const c = map.getCenter();
      useStore.getState().setPickCoord([c.lng, c.lat]);
    };
    // 시작할 때 이미 정해둔 좌표가 있으면 거기로 옮긴다
    const seed = useStore.getState().pickCoord;
    if (seed) map.easeTo({ center: seed, zoom: Math.max(map.getZoom(), 16.5), duration: 500 });
    else push();
    map.on("moveend", push);
    return () => {
      map.off("moveend", push);
    };
  }, [picking]);

  /* 캐릭터 위치 / 카메라 추적 */
  const prevFix = useRef<LngLat | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const ch = charRef.current;
    if (!map || !ch || !fix) return;

    let heading = fix.heading ?? undefined;
    let moved = 0;
    if (prevFix.current) {
      moved = distance(prevFix.current, fix.coord);
      if (heading === undefined && moved > 1.2) heading = bearing(prevFix.current, fix.coord);
    }
    prevFix.current = fix.coord;

    ch.setPosition(fix.coord, heading);
    ch.setWalking((fix.speed ?? 0) > 0.4 || moved > 1.0);

    if (follow) {
      map.easeTo({
        center: fix.coord,
        bearing: dim === "3d" && heading !== undefined ? heading : map.getBearing(),
        pitch: dim === "3d" ? 62 : 0,
        zoom: dim === "3d" ? Math.min(18, Math.max(map.getZoom(), 17.6)) : Math.max(map.getZoom(), 16),
        offset: dim === "3d" ? [0, 100] : [0, 0],
        duration: 900,
        easing: (t) => t,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, follow, dim]);

  return <div ref={box} className="map" />;
}
