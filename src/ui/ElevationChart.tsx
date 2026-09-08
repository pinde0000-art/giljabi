import type { ElevProfile } from "../types";
import { gradeColor, gradeLabel } from "../services/elevation";
import { fmtDistance } from "../lib/geo";

/**
 * 고도 프로필. 구간마다 경사에 따라 색이 달라져서
 * 어디가 오르막이고 어디가 내리막인지 한눈에 보인다.
 */
export default function ElevationChart({ elev }: { elev: ElevProfile }) {
  const W = 320;
  const H = 64;
  const pad = 4;
  const pts = elev.points;
  if (pts.length < 2) return null;

  const total = pts[pts.length - 1].d || 1;
  const lo = elev.min;
  const hi = elev.max;
  const span = Math.max(8, hi - lo);

  const x = (d: number) => (d / total) * W;
  const y = (e: number) => H - pad - ((e - lo) / span) * (H - pad * 2);

  // 경사 색이 들어간 세그먼트들
  const segs: { d: string; c: string }[] = [];
  for (let i = 1; i < pts.length; i++) {
    segs.push({
      d: `M${x(pts[i - 1].d).toFixed(2)},${y(pts[i - 1].e).toFixed(2)} L${x(pts[i].d).toFixed(
        2
      )},${y(pts[i].e).toFixed(2)}`,
      c: gradeColor(pts[i].grade),
    });
  }

  const area =
    `M${x(pts[0].d)},${H} ` +
    pts.map((p) => `L${x(p.d).toFixed(2)},${y(p.e).toFixed(2)}`).join(" ") +
    ` L${W},${H} Z`;

  const steepest = Math.abs(elev.maxGrade) >= Math.abs(elev.minGrade) ? elev.maxGrade : elev.minGrade;

  return (
    <div className="elev">
      <div className="elev-head">
        <span>
          오르막 <b>+{Math.round(elev.gain)}m</b>
        </span>
        <span>
          내리막 <b>−{Math.round(elev.loss)}m</b>
        </span>
        <span style={{ marginLeft: "auto" }}>
          최대 <b>{gradeLabel(steepest)}</b> {Math.abs(steepest * 100).toFixed(0)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="고도 프로필">
        <defs>
          <linearGradient id="elevfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#elevfill)" />
        {segs.map((s, i) => (
          <path key={i} d={s.d} stroke={s.c} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        ))}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10.5,
          color: "#6c6c7c",
          marginTop: 2,
        }}
      >
        <span>{Math.round(lo)}m</span>
        <span>{fmtDistance(total)}</span>
        <span>{Math.round(hi)}m</span>
      </div>
    </div>
  );
}
