import type { LngLat, Place } from "../types";
import { distance } from "../lib/geo";

/**
 * 장소 검색 / 역지오코딩.
 *  1순위 Photon (komoot) — 자동완성이 빠르고 한글 이름을 그대로 들고 있다.
 *  2순위 Nominatim — Photon 이 못 찾는 행정구역/도로명 주소를 잡아준다.
 * 둘 다 OSM 기반이라 키가 필요 없다.
 */

const PHOTON = "https://photon.komoot.io";
const NOMINATIM = "https://nominatim.openstreetmap.org";

interface PhotonProps {
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  district?: string;
  locality?: string;
  county?: string;
  state?: string;
  country?: string;
  postcode?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
}

function photonLabel(p: PhotonProps): { name: string; detail: string } {
  const name =
    p.name ||
    [p.street, p.housenumber].filter(Boolean).join(" ") ||
    p.locality ||
    p.district ||
    p.city ||
    p.state ||
    "이름 없는 장소";

  const parts = [p.state, p.city, p.district, p.locality].filter(
    (v, i, a) => !!v && a.indexOf(v) === i && v !== name
  );
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  if (street && street !== name) parts.push(street);
  return { name, detail: parts.join(" ") };
}

/** 장소 자동완성 검색 */
export async function searchPlaces(
  query: string,
  near?: LngLat,
  signal?: AbortSignal
): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 1) return [];

  const url = new URL(`${PHOTON}/api/`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "default");
  if (near) {
    url.searchParams.set("lat", String(near[1]));
    url.searchParams.set("lon", String(near[0]));
    // 주변 결과에 가중치
    url.searchParams.set("zoom", "12");
    url.searchParams.set("location_bias_scale", "0.6");
  }

  let out: Place[] = [];
  try {
    const res = await fetch(url.toString(), { signal });
    if (res.ok) {
      const data = await res.json();
      out = (data.features ?? [])
        .filter((f: any) => f?.geometry?.coordinates)
        .map((f: any): Place => {
          const { name, detail } = photonLabel(f.properties ?? {});
          return {
            name,
            detail,
            coord: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
          };
        });
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
  }

  // Photon 이 비었을 때만 Nominatim 을 때린다 (사용 정책상 호출을 아껴야 함)
  if (out.length === 0) {
    try {
      const nu = new URL(`${NOMINATIM}/search`);
      nu.searchParams.set("format", "jsonv2");
      nu.searchParams.set("q", q);
      nu.searchParams.set("limit", "8");
      nu.searchParams.set("accept-language", "ko");
      const res = await fetch(nu.toString(), { signal });
      if (res.ok) {
        const data = await res.json();
        out = (data ?? []).map((r: any): Place => {
          const full: string = r.display_name ?? "";
          const bits = full.split(",").map((s: string) => s.trim());
          return {
            name: r.name || bits[0] || full,
            detail: bits.slice(1, 4).reverse().join(" "),
            coord: [parseFloat(r.lon), parseFloat(r.lat)],
          };
        });
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
    }
  }

  // 가까운 순 살짝 재정렬 (동명 지명이 많은 한국에서 특히 중요)
  if (near && out.length > 1) {
    out.sort((a, b) => distance(near, a.coord) - distance(near, b.coord));
  }
  return dedupe(out);
}

function dedupe(list: Place[]): Place[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = `${p.name}|${p.coord[0].toFixed(4)},${p.coord[1].toFixed(4)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 좌표 -> 사람이 읽는 주소 */
export async function reverseGeocode(
  coord: LngLat,
  signal?: AbortSignal
): Promise<{ name: string; detail: string }> {
  try {
    const url = new URL(`${PHOTON}/reverse`);
    url.searchParams.set("lat", String(coord[1]));
    url.searchParams.set("lon", String(coord[0]));
    url.searchParams.set("limit", "1");
    url.searchParams.set("lang", "default");
    const res = await fetch(url.toString(), { signal });
    if (res.ok) {
      const data = await res.json();
      const f = data?.features?.[0];
      if (f) {
        const { name, detail } = photonLabel(f.properties ?? {});
        return { name, detail };
      }
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
  }

  try {
    const nu = new URL(`${NOMINATIM}/reverse`);
    nu.searchParams.set("format", "jsonv2");
    nu.searchParams.set("lat", String(coord[1]));
    nu.searchParams.set("lon", String(coord[0]));
    nu.searchParams.set("accept-language", "ko");
    const res = await fetch(nu.toString(), { signal });
    if (res.ok) {
      const r = await res.json();
      const full: string = r?.display_name ?? "";
      const bits = full.split(",").map((s: string) => s.trim());
      if (bits.length) return { name: bits[0], detail: bits.slice(1, 4).reverse().join(" ") };
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
  }

  return {
    name: "현재 위치",
    detail: `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`,
  };
}
