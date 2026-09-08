import type { StyleSpecification } from "maplibre-gl";

/**
 * 지도 스타일.
 *
 * 요구사항 그대로:
 *   - 땅과 길 = 살짝 진한 회색
 *   - 건물 = 그보다 더 진한 회색
 *   - 2D 는 평면, 3D 는 같은 색으로 건물 입체 + 실제 지형 경사
 *
 * 데이터는 OpenFreeMap 이 무료로 제공하는 OpenMapTiles 스키마 벡터타일
 * (전 세계 실제 건물 윤곽 / 도로망), 지형은 AWS Terrain Tiles(terrarium DEM).
 */

export const C = {
  ground: "#6e6e75", // 땅 — 살짝 진한 회색
  groundAlt: "#78787f", // 주거지 등 살짝 밝게
  green: "#69746a", // 공원/숲 — 회색기 있는 녹색
  water: "#59646d",
  waterDark: "#4e5860",

  roadFill: "#9c9ca5", // 길 — 땅과 같은 회색 계열, 한 톤 밝게
  roadFillMinor: "#91919a",
  roadCasing: "#585860",
  path: "#a6a6ae",
  rail: "#5a5a62",

  building: "#4c4c56", // 건물 — 땅보다 확실히 더 진한 회색
  buildingTop: "#5c5c67",
  buildingSide: "#3f3f49",
  buildingOutline: "#35353e",

  label: "#f4f4f7",
  labelHalo: "rgba(28,28,34,0.92)",
  labelRoad: "#eaeaf0",
  labelWater: "#cfd8de",

  route: "#7b5cf6",
  routeCase: "#241a44",
  walk: "#4ade80",
  bus: "#60a5fa",
  car: "#fbbf24",
  bike: "#f472b6",
  pin: "#ec4899",
} as const;

const TILES = "https://tiles.openfreemap.org/planet";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const REG = ["Noto Sans Regular"];
const BLD = ["Noto Sans Bold"];

/** 이름은 한국어 우선 */
const NAME: any = ["coalesce", ["get", "name:ko"], ["get", "name"], ["get", "name:latin"]];

/** 줌 -> 폭 스톱 */
type Stops = [number, number][];

function widthExpr(stops: Stops, extra = 0): any {
  const out: any[] = ["interpolate", ["exponential", 1.45], ["zoom"]];
  for (const [z, w] of stops) out.push(z, +(w + extra).toFixed(3));
  return out;
}

/** 도로 폭 + 외곽선 폭을 한 번에 (외곽선은 폭에 비례해 두껍게) */
function casingExpr(stops: Stops, bridge = false): any {
  const out: any[] = ["interpolate", ["exponential", 1.45], ["zoom"]];
  for (const [z, w] of stops) {
    const pad = Math.max(bridge ? 1.8 : 1.1, w * (bridge ? 0.34 : 0.26));
    out.push(z, +(w + pad * 2).toFixed(3));
  }
  return out;
}

const S: Record<string, Stops> = {
  motorway: [
    [5, 0.5],
    [10, 2],
    [14, 5],
    [16, 12],
    [18, 26],
    [20, 58],
  ],
  trunk: [
    [7, 0.5],
    [11, 1.8],
    [14, 4.5],
    [16, 11],
    [18, 24],
    [20, 52],
  ],
  primary: [
    [8, 0.6],
    [12, 2],
    [14, 4],
    [16, 10],
    [18, 22],
    [20, 48],
  ],
  secondary: [
    [10, 0.6],
    [13, 2],
    [15, 5],
    [17, 12],
    [18, 17],
    [20, 40],
  ],
  tertiary: [
    [11, 0.6],
    [14, 2.4],
    [16, 6],
    [18, 14],
    [20, 34],
  ],
  minor: [
    [12, 0.5],
    [14, 1.6],
    [16, 4.2],
    [18, 11],
    [20, 28],
  ],
  service: [
    [13, 0.4],
    [15, 1.6],
    [17, 4],
    [19, 9],
    [20, 16],
  ],
  path: [
    [14, 0.6],
    [16, 1.5],
    [18, 3.2],
    [20, 7],
  ],
};

type L = StyleSpecification["layers"][number];

const roadFilterBase = (brunnel: "tunnel" | "bridge" | null, classes: string[]): any => {
  const f: any[] = ["all", ["==", ["geometry-type"], "LineString"]];
  if (brunnel === "tunnel") f.push(["==", ["get", "brunnel"], "tunnel"]);
  else if (brunnel === "bridge") f.push(["==", ["get", "brunnel"], "bridge"]);
  else f.push(["!", ["in", ["get", "brunnel"], ["literal", ["tunnel", "bridge"]]]]);
  f.push(["in", ["get", "class"], ["literal", classes]]);
  return f;
};

function roadLayers(prefix: string, brunnel: "tunnel" | "bridge" | null): L[] {
  const dim = brunnel === "tunnel" ? 0.55 : 1;
  const out: L[] = [];

  const groups: Array<{
    id: string;
    classes: string[];
    stops: Stops;
    color: string;
    minzoom: number;
  }> = [
    { id: "path", classes: ["path", "track"], stops: S.path, color: C.path, minzoom: 14 },
    { id: "service", classes: ["service"], stops: S.service, color: C.roadFillMinor, minzoom: 13 },
    { id: "minor", classes: ["minor"], stops: S.minor, color: C.roadFillMinor, minzoom: 12 },
    { id: "tertiary", classes: ["tertiary"], stops: S.tertiary, color: C.roadFill, minzoom: 10 },
    { id: "secondary", classes: ["secondary"], stops: S.secondary, color: C.roadFill, minzoom: 9 },
    { id: "primary", classes: ["primary"], stops: S.primary, color: C.roadFill, minzoom: 7 },
    { id: "trunk", classes: ["trunk"], stops: S.trunk, color: C.roadFill, minzoom: 6 },
    { id: "motorway", classes: ["motorway"], stops: S.motorway, color: "#aaaab3", minzoom: 4 },
  ];

  // 외곽선(casing)을 전부 먼저 깔고 채움을 그 위에 — 교차로가 끊겨 보이지 않게
  for (const g of groups) {
    if (g.id === "path") continue;
    out.push({
      id: `${prefix}-${g.id}-casing`,
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: g.minzoom,
      filter: roadFilterBase(brunnel, g.classes),
      layout: { "line-cap": brunnel === "bridge" ? "butt" : "round", "line-join": "round" },
      paint: {
        "line-color": C.roadCasing,
        "line-width": casingExpr(g.stops, brunnel === "bridge"),
        "line-opacity": dim,
      },
    });
  }
  for (const g of groups) {
    out.push({
      id: `${prefix}-${g.id}`,
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: g.minzoom,
      filter: roadFilterBase(brunnel, g.classes),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": g.color,
        "line-width": widthExpr(g.stops),
        "line-opacity": g.id === "path" ? 0.85 * dim : dim,
        ...(g.id === "path" ? { "line-dasharray": [1.6, 1.1] as any } : {}),
      },
    });
  }
  return out;
}

export function buildStyle(): StyleSpecification {
  const layers: L[] = [
    {
      id: "bg",
      type: "background",
      paint: { "background-color": C.ground },
    },
    {
      id: "landuse-residential",
      type: "fill",
      source: "omt",
      "source-layer": "landuse",
      filter: ["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood"]]],
      paint: { "fill-color": C.groundAlt, "fill-opacity": 0.55 },
    },
    {
      id: "landcover-wood",
      type: "fill",
      source: "omt",
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["wood", "forest", "scrub"]]],
      paint: { "fill-color": C.green, "fill-opacity": 0.75 },
    },
    {
      id: "landcover-grass",
      type: "fill",
      source: "omt",
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["grass", "farmland"]]],
      paint: { "fill-color": C.green, "fill-opacity": 0.45 },
    },
    {
      id: "park",
      type: "fill",
      source: "omt",
      "source-layer": "park",
      paint: { "fill-color": C.green, "fill-opacity": 0.6 },
    },
    {
      id: "water",
      type: "fill",
      source: "omt",
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": C.water },
    },
    {
      id: "waterway",
      type: "line",
      source: "omt",
      "source-layer": "waterway",
      minzoom: 9,
      paint: {
        "line-color": C.water,
        "line-width": widthExpr([
          [9, 0.6],
          [14, 2],
          [18, 8],
        ]),
      },
    },
    {
      // 3D 모드 전용 — 지형 음영으로 오르막/내리막을 눈에 보이게
      id: "hillshade",
      type: "hillshade",
      source: "dem",
      layout: { visibility: "none" },
      paint: {
        "hillshade-exaggeration": 0.3,
        "hillshade-shadow-color": "#3a3a43",
        "hillshade-highlight-color": "#9c9ca6",
        "hillshade-accent-color": "#55555e",
      },
    },

    // 터널
    ...roadLayers("tun", "tunnel"),
    // 지상 도로
    ...roadLayers("rd", null),

    {
      id: "rail",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["in", ["get", "class"], ["literal", ["rail", "transit"]]],
      paint: {
        "line-color": C.rail,
        "line-width": widthExpr([
          [11, 0.6],
          [15, 2],
          [18, 4],
        ]),
      },
    },

    // 2D 건물 (평면 도형)
    {
      id: "building-2d",
      type: "fill",
      source: "omt",
      "source-layer": "building",
      minzoom: 13,
      paint: {
        "fill-color": C.building,
        "fill-outline-color": C.buildingOutline,
        "fill-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          0.6,
          15,
          0.95,
          16,
          1,
        ] as any,
      },
    },

    // 교량
    ...roadLayers("br", "bridge"),

    // 3D 건물 (같은 색, 옆면만 한 단계 어둡게)
    {
      id: "building-3d",
      type: "fill-extrusion",
      source: "omt",
      "source-layer": "building",
      minzoom: 13.5,
      layout: { visibility: "none" },
      paint: {
        // 낮은 건물은 2D 와 같은 색, 높을수록 살짝 밝게 해서 스카이라인이 읽히게
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 8],
          0,
          "#5c5c67",
          15,
          "#5f5f6a",
          45,
          "#65656f",
          130,
          "#6b6b76",
        ] as any,
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13.5,
          0,
          14.5,
          ["coalesce", ["get", "render_height"], 8],
        ] as any,
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0] as any,
        "fill-extrusion-opacity": 0.96,
        // 면 방향 음영만으로도 충분히 어두워진다. 수직 그라디언트까지 켜면 새까매진다.
        "fill-extrusion-vertical-gradient": false,
      },
    },

    /* ---------------- 라벨 ---------------- */
    {
      id: "label-road",
      type: "symbol",
      source: "omt",
      "source-layer": "transportation_name",
      minzoom: 14,
      filter: ["!=", ["get", "class"], "path"],
      layout: {
        "symbol-placement": "line",
        "text-field": NAME,
        "text-font": REG,
        "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 18, 13] as any,
        "text-rotation-alignment": "map",
        "text-padding": 2,
      },
      paint: {
        "text-color": C.labelRoad,
        "text-halo-color": C.labelHalo,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "label-water",
      type: "symbol",
      source: "omt",
      "source-layer": "water_name",
      minzoom: 10,
      layout: {
        "text-field": NAME,
        "text-font": REG,
        "text-size": 11,
        "symbol-placement": "point",
      },
      paint: {
        "text-color": C.labelWater,
        "text-halo-color": C.labelHalo,
        "text-halo-width": 1.1,
      },
    },
    {
      id: "label-poi",
      type: "symbol",
      source: "omt",
      "source-layer": "poi",
      minzoom: 16,
      filter: ["<=", ["get", "rank"], 12],
      layout: {
        "text-field": NAME,
        "text-font": REG,
        "text-size": 10.5,
        "text-max-width": 8,
        "text-anchor": "top",
        "text-offset": [0, 0.4],
        "text-optional": true,
      },
      paint: {
        "text-color": "#e6e6ec",
        "text-halo-color": C.labelHalo,
        "text-halo-width": 1.1,
      },
    },
    {
      id: "label-place",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 4,
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["city", "town", "village", "suburb", "neighbourhood", "quarter"]],
      ],
      layout: {
        "text-field": NAME,
        "text-font": BLD,
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          11,
          10,
          ["case", ["==", ["get", "class"], "city"], 16, 12],
          16,
          ["case", ["==", ["get", "class"], "city"], 20, 13],
        ] as any,
        "text-max-width": 8,
      },
      paint: {
        "text-color": C.label,
        "text-halo-color": C.labelHalo,
        "text-halo-width": 1.5,
      },
    },
  ];

  return {
    version: 8,
    name: "길잡이 그레이",
    glyphs: GLYPHS,
    sources: {
      omt: { type: "vector", url: TILES },
      dem: {
        type: "raster-dem",
        tiles: [DEM],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 15,
        attribution:
          '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>',
      },
    },
    sky: {
      "sky-color": "#2a2a33",
      "horizon-color": "#6a6a74",
      "fog-color": "#8a8a92",
      "fog-ground-blend": 0.6,
      "horizon-fog-blend": 0.5,
      "sky-horizon-blend": 0.7,
      "atmosphere-blend": 0.5,
    } as any,
    layers,
  };
}

/** 경로/마커 레이어를 항상 이 레이어 아래에 넣어 라벨이 가려지지 않게 한다 */
export const LABEL_ANCHOR = "label-road";
