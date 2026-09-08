import { useState } from "react";
import { isIOS, isStandalone } from "../services/geolocation";
import { IcClose } from "./Icons";

const KEY = "giljabi.installHint.dismissed";

/**
 * 아이폰 사파리에서만 뜨는 "홈 화면에 추가" 안내.
 * 홈 화면 앱으로 열면(standalone) 사라지고, 한 번 닫으면 다시 뜨지 않는다.
 *
 * 이걸 안내하는 이유가 단순히 예뻐서가 아니다 — 홈 화면 앱으로 열어야
 * 주소창·툴바가 사라져 지도가 넓어지고, 위치 권한도 앱 단위로 따로 관리된다.
 */
export default function InstallHint() {
  const [gone, setGone] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  if (gone || !isIOS() || isStandalone()) return null;

  const close = () => {
    setGone(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* 저장 못 해도 이번 세션에서는 닫힌다 */
    }
  };

  return (
    <div className="install-hint" role="note">
      <span className="ih-ic" aria-hidden>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3.4v11.2" />
          <path d="M8.4 7l3.6-3.6L15.6 7" />
          <path d="M5.4 12.6v6.2a1.6 1.6 0 001.6 1.6h10a1.6 1.6 0 001.6-1.6v-6.2" />
        </svg>
      </span>
      <span className="ih-tx">
        <b>홈 화면에 추가해서 쓰세요</b>
        <span>
          아래 <b>공유</b> 버튼 → <b>홈 화면에 추가</b>. 주소창이 사라져 지도가 넓어지고
          위치도 더 잘 잡힙니다.
        </span>
      </span>
      <button className="ih-close" onClick={close} aria-label="안내 닫기">
        <IcClose size={13} />
      </button>
    </div>
  );
}
