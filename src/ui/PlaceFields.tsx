import { useCallback, useEffect, useRef, useState } from "react";
import type { Place } from "../types";
import { searchPlaces } from "../services/geocode";
import { useStore } from "../state/store";
import { IcClose, IcHistory, IcMapPin, IcPin, IcSearch, IcSwap, IcTarget } from "./Icons";

const RECENT_KEY = "giljabi.recent.v1";

function loadRecents(): Place[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function pushRecent(p: Place) {
  if (p.isCurrent) return;
  try {
    const list = loadRecents().filter(
      (r) => !(r.name === p.name && Math.abs(r.coord[0] - p.coord[0]) < 1e-5)
    );
    list.unshift({ name: p.name, detail: p.detail, coord: p.coord });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* 저장 실패는 무시 */
  }
}

interface FieldProps {
  role: "origin" | "dest";
  value: Place | null;
  text: string;
  onText: (t: string) => void;
  onPick: (p: Place) => void;
  placeholder: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function Field({
  role,
  value,
  text,
  onText,
  onPick,
  placeholder,
  open,
  onOpen,
  onClose,
}: FieldProps) {
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<Place[]>(() => loadRecents());
  const acRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const locating = useStore((s) => s.locating);
  const locateMe = useStore((s) => s.locateMe);
  const startPick = useStore((s) => s.startPick);
  const fix = useStore((s) => s.fix);

  // 입력 디바운스 검색
  useEffect(() => {
    if (!open) return;
    const q = text.trim();
    if (q.length < 1) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = window.setTimeout(async () => {
      acRef.current?.abort();
      const ac = new AbortController();
      acRef.current = ac;
      try {
        const r = await searchPlaces(q, fix?.coord, ac.signal);
        if (!ac.signal.aborted) setResults(r);
      } catch {
        /* 취소/실패 무시 */
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 260);
    return () => window.clearTimeout(t);
  }, [text, open, fix?.coord]);

  // 바깥 탭하면 닫기
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open, onClose]);

  const pick = (p: Place) => {
    onPick(p);
    pushRecent(p);
    setRecents(loadRecents());
    onClose();
    inputRef.current?.blur();
  };

  const showRecents = open && text.trim().length === 0 && recents.length > 0;

  return (
    <div className="dd-wrap" ref={wrapRef}>
      <div className={`field${open ? " focus" : ""}`}>
        <span className={`dot ${role === "origin" ? "start" : "end"}`} />
        <input
          ref={inputRef}
          value={text}
          placeholder={placeholder}
          onFocus={onOpen}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) pick(results[0]);
          }}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={role === "origin" ? "출발지" : "도착지"}
        />
        {text.length > 0 && (
          <button
            className="clear"
            aria-label="지우기"
            onPointerDown={(e) => {
              e.preventDefault();
              onText("");
              inputRef.current?.focus();
            }}
          >
            <IcClose size={11} />
          </button>
        )}
      </div>

      {open && (
        <div className="dropdown" role="listbox">
          {role === "origin" && (
            <button
              className="dd-item primary"
              onPointerDown={(e) => e.preventDefault()}
              onClick={async () => {
                const p = await locateMe();
                if (p) {
                  onText(p.name);
                  onClose();
                  inputRef.current?.blur();
                }
              }}
            >
              <span className="ic">{locating ? <span className="spinner" /> : <IcTarget />}</span>
              <span className="tx">
                <span className="t1">
                  {locating ? "위치를 잡는 중…" : "현재 내 위치로 설정하기"}
                </span>
                <span className="t2">
                  {locating ? "GPS 신호를 기다리고 있어요" : "지금 서 있는 곳을 출발지로 씁니다"}
                </span>
              </span>
            </button>
          )}

          {role === "origin" && (
            <button
              className="dd-item"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                startPick();
                onClose();
                inputRef.current?.blur();
              }}
            >
              <span className="ic">
                <IcMapPin />
              </span>
              <span className="tx">
                <span className="t1">지도에서 직접 찍기</span>
                <span className="t2">위치가 잘못 잡혔을 때 지도를 움직여 맞춥니다</span>
              </span>
            </button>
          )}

          {showRecents && (
            <>
              <div className="dd-head">최근에 찾은 곳</div>
              {recents.map((r, i) => (
                <button
                  key={`r${i}`}
                  className="dd-item"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onText(r.name);
                    pick(r);
                  }}
                >
                  <span className="ic">
                    <IcHistory />
                  </span>
                  <span className="tx">
                    <span className="t1">{r.name}</span>
                    {r.detail && <span className="t2">{r.detail}</span>}
                  </span>
                </button>
              ))}
            </>
          )}

          {text.trim().length > 0 && (
            <>
              {busy && results.length === 0 && (
                <div className="dd-item">
                  <span className="ic">
                    <span className="spinner" />
                  </span>
                  <span className="tx">
                    <span className="t1">찾는 중…</span>
                  </span>
                </div>
              )}
              {!busy && results.length === 0 && (
                <div className="dd-item">
                  <span className="ic">
                    <IcSearch />
                  </span>
                  <span className="tx">
                    <span className="t1">검색 결과가 없어요</span>
                    <span className="t2">지명이나 건물 이름을 더 넣어 보세요</span>
                  </span>
                </div>
              )}
              {results.map((p, i) => (
                <button
                  key={`s${i}`}
                  className="dd-item"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onText(p.name);
                    pick(p);
                  }}
                >
                  <span className="ic">
                    <IcPin />
                  </span>
                  <span className="tx">
                    <span className="t1">{p.name}</span>
                    {p.detail && <span className="t2">{p.detail}</span>}
                  </span>
                </button>
              ))}
            </>
          )}

          {role === "origin" && !showRecents && text.trim().length === 0 && (
            <div className="dd-item">
              <span className="ic">
                <IcSearch />
              </span>
              <span className="tx">
                <span className="t1">직접 검색해서 고르기</span>
                <span className="t2">출발지 이름을 입력하면 후보가 나옵니다</span>
              </span>
            </div>
          )}
        </div>
      )}

      {value && !open && value.detail && (
        <div style={{ display: "none" }} aria-hidden />
      )}
    </div>
  );
}

export default function PlaceFields() {
  const origin = useStore((s) => s.origin);
  const dest = useStore((s) => s.dest);
  const setOrigin = useStore((s) => s.setOrigin);
  const setDest = useStore((s) => s.setDest);
  const swap = useStore((s) => s.swap);

  const [oText, setOText] = useState("");
  const [dText, setDText] = useState("");
  const [openField, setOpenField] = useState<"origin" | "dest" | null>(null);

  // 스토어에서 값이 바뀌면(현재 위치 버튼 등) 입력창 글자도 맞춰준다
  useEffect(() => {
    if (origin) setOText(origin.name);
    else setOText("");
  }, [origin]);
  useEffect(() => {
    if (dest) setDText(dest.name);
    else setDText("");
  }, [dest]);

  const onOText = useCallback(
    (t: string) => {
      setOText(t);
      if (origin && t !== origin.name) setOrigin(null);
    },
    [origin, setOrigin]
  );
  const onDText = useCallback(
    (t: string) => {
      setDText(t);
      if (dest && t !== dest.name) setDest(null);
    },
    [dest, setDest]
  );

  return (
    <div className="field-stack">
      <Field
        role="origin"
        value={origin}
        text={oText}
        onText={onOText}
        onPick={setOrigin}
        placeholder="출발지 — 어디서 떠나나요?"
        open={openField === "origin"}
        onOpen={() => setOpenField("origin")}
        onClose={() => setOpenField((f) => (f === "origin" ? null : f))}
      />
      <Field
        role="dest"
        value={dest}
        text={dText}
        onText={onDText}
        onPick={setDest}
        placeholder="도착지 — 예: 창원 NC 파크 동문"
        open={openField === "dest"}
        onOpen={() => setOpenField("dest")}
        onClose={() => setOpenField((f) => (f === "dest" ? null : f))}
      />
      <button
        aria-label="출발지와 도착지 바꾸기"
        onClick={swap}
        style={{
          position: "absolute",
          right: 12,
          top: 40,
          width: 30,
          height: 30,
          borderRadius: 10,
          background: "#1a1a21",
          border: "1px solid #26262f",
          color: "#a0a0ae",
          display: "grid",
          placeItems: "center",
          zIndex: 5,
        }}
      >
        <IcSwap />
      </button>
    </div>
  );
}

export { loadRecents };
