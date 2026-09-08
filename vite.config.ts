import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const require_ = createRequire(import.meta.url);

/**
 * maplibre-gl v6 는 렌더링 워커를 `import.meta.url` 기준 상대 경로로 찾는다.
 * 번들러가 워커 파일을 같이 내보내 주지 않으면 404 가 나면서 지도가 통째로 멈춘다.
 *  - dev: optimizeDeps 에서 제외해 원본 dist 를 그대로 쓰게 한다.
 *  - build: 워커와 공용 청크를 dist/mlgl/ 로 복사하고 setWorkerUrl 로 가리킨다.
 */
function maplibreWorkerAssets(): Plugin {
  return {
    name: "maplibre-worker-assets",
    apply: "build",
    generateBundle() {
      const dist = join(dirname(require_.resolve("maplibre-gl/package.json")), "dist");
      for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        this.emitFile({
          type: "asset",
          fileName: `mlgl/${f}`,
          source: readFileSync(join(dist, f)),
        });
      }
    },
  };
}

/**
 * 개발 전용: `?rafshim` 을 붙이면 탭이 백그라운드여도 렌더 루프를 돌린다.
 * 자동화 브라우저로 지도를 스크린샷 검증할 때만 쓴다. 빌드 산출물에는 들어가지 않는다.
 */
function devRafShim(): Plugin {
  return {
    name: "dev-raf-shim",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          injectTo: "head-prepend",
          children: `if (location.search.indexOf("rafshim") >= 0) {
  window.requestAnimationFrame = function (cb) { return window.setTimeout(function () { cb(performance.now()); }, 16); };
  window.cancelAnimationFrame = function (id) { window.clearTimeout(id); };
  document.addEventListener("DOMContentLoaded", function () {
    var st = document.createElement("style");
    st.textContent = "*,*::before,*::after{animation-duration:1ms!important;transition-duration:1ms!important}";
    document.head.appendChild(st);
  });
}`,
        },
      ];
    },
  };
}

export default defineConfig({
  // 상대 경로로 빌드해 두면 GitHub Pages 처럼 하위 경로(/저장소이름/)에 올려도
  // 자산·워커·매니페스트가 전부 그대로 맞는다.
  base: "./",
  plugins: [react(), maplibreWorkerAssets(), devRafShim()],
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
  },
});
