import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as MLMap } from "maplibre-gl";
import type { LngLat } from "../types";
import { lerpAngle } from "../lib/geo";

/**
 * 3D 모드에서 지도 위에 서 있는 3인칭 캐릭터.
 * MapLibre 커스텀 레이어 안에서 three.js 로 직접 그린다.
 * 지형(terrain)이 켜져 있으면 그 지점의 실제 표고를 읽어 발이 땅에 닿게 한다.
 */
export class CharacterLayer implements CustomLayerInterface {
  id = "character-3d";
  type = "custom" as const;
  renderingMode = "3d" as const;

  private map!: MLMap;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.Camera;
  private root!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private ring!: THREE.Mesh;

  private position: LngLat = [0, 0];
  private altitude = 0;
  /** 캐릭터가 바라보는 방위각(도) */
  private heading = 0;
  private renderHeading = 0;
  private walking = false;
  private phase = 0;
  private lastT = 0;
  private visible = true;

  setPosition(coord: LngLat, heading?: number) {
    this.position = coord;
    if (typeof heading === "number" && !Number.isNaN(heading)) this.heading = heading;
    this.refreshAltitude();
    this.map?.triggerRepaint();
  }

  setWalking(v: boolean) {
    this.walking = v;
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (this.root) this.root.visible = v;
    this.map?.triggerRepaint();
  }

  private refreshAltitude() {
    if (!this.map) return;
    try {
      const e = this.map.queryTerrainElevation({
        lng: this.position[0],
        lat: this.position[1],
      });
      if (typeof e === "number" && isFinite(e)) this.altitude = e;
    } catch {
      /* 지형이 꺼져 있으면 0 */
    }
  }

  onAdd(map: MLMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-0.6, 1.4, 0.9).normalize();
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc9c9ff, 0.7);
    fill.position.set(0.8, 0.5, -0.7).normalize();
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));

    this.root = new THREE.Group();
    this.buildBody();
    this.scene.add(this.root);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.refreshAltitude();
  }

  onRemove() {
    this.scene?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer?.dispose();
  }

  /** 저폴리 사람 — 키 약 1.75m */
  private buildBody() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xf0c9a8, roughness: 0.75 });
    const coat = new THREE.MeshStandardMaterial({ color: 0x7b5cf6, roughness: 0.55, metalness: 0.05 });
    const coat2 = new THREE.MeshStandardMaterial({ color: 0xec4899, roughness: 0.55 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2b2b3a, roughness: 0.85 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x16161d, roughness: 0.9 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x1c1a22, roughness: 0.9 });

    const box = (w: number, h: number, d: number, m: THREE.Material) =>
      new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

    // 골반 + 몸통
    const hips = box(0.3, 0.18, 0.19, pants);
    hips.position.y = 0.92;
    this.root.add(hips);

    const torso = box(0.36, 0.46, 0.21, coat);
    torso.position.y = 1.23;
    this.root.add(torso);

    const collar = box(0.37, 0.07, 0.22, coat2);
    collar.position.y = 1.44;
    this.root.add(collar);

    // 목 + 머리
    const neck = box(0.1, 0.07, 0.1, skin);
    neck.position.y = 1.5;
    this.root.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skin);
    head.position.y = 1.62;
    head.scale.set(1, 1.12, 0.95);
    this.root.add(head);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.122, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
      hair
    );
    cap.position.y = 1.635;
    cap.scale.set(1, 1.05, 0.98);
    this.root.add(cap);

    // 팔 — 어깨를 피벗으로
    const mkArm = (side: 1 | -1) => {
      const g = new THREE.Group();
      g.position.set(0.235 * side, 1.42, 0);
      const upper = box(0.095, 0.29, 0.095, coat);
      upper.position.y = -0.15;
      g.add(upper);
      const fore = box(0.085, 0.26, 0.085, skin);
      fore.position.y = -0.42;
      g.add(fore);
      this.root.add(g);
      return g;
    };
    this.armL = mkArm(1);
    this.armR = mkArm(-1);

    // 다리 — 골반을 피벗으로
    const mkLeg = (side: 1 | -1) => {
      const g = new THREE.Group();
      g.position.set(0.085 * side, 0.86, 0);
      const thigh = box(0.125, 0.44, 0.13, pants);
      thigh.position.y = -0.22;
      g.add(thigh);
      const shin = box(0.11, 0.4, 0.115, pants);
      shin.position.y = -0.63;
      g.add(shin);
      const foot = box(0.12, 0.08, 0.24, shoe);
      foot.position.set(0, -0.86, 0.05);
      g.add(foot);
      this.root.add(g);
      return g;
    };
    this.legL = mkLeg(1);
    this.legR = mkLeg(-1);

    // 발밑 표시 링 (내 위치)
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.78, 48),
      new THREE.MeshBasicMaterial({
        color: 0x8b5cf6,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.root.add(this.ring);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 40),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.012;
    this.root.add(disc);

    // 진행 방향 화살표
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.17, 0.42, 3),
      new THREE.MeshBasicMaterial({ color: 0xec4899, transparent: true, opacity: 0.9 })
    );
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.03, 0.95);
    this.root.add(arrow);
  }

  private animate(dt: number) {
    const speed = this.walking ? 5.4 : 0;
    this.phase += dt * speed;
    const s = Math.sin(this.phase);
    const c = Math.sin(this.phase + Math.PI);

    if (this.walking) {
      this.legL.rotation.x = s * 0.62;
      this.legR.rotation.x = c * 0.62;
      this.armL.rotation.x = c * 0.5;
      this.armR.rotation.x = s * 0.5;
      this.root.position.y = Math.abs(Math.sin(this.phase * 2)) * 0.035;
    } else {
      // 가만히 서 있을 때는 천천히 원위치 + 숨쉬기
      const k = Math.min(1, dt * 6);
      this.legL.rotation.x += (0 - this.legL.rotation.x) * k;
      this.legR.rotation.x += (0 - this.legR.rotation.x) * k;
      this.armL.rotation.x += (0.06 - this.armL.rotation.x) * k;
      this.armR.rotation.x += (0.06 - this.armR.rotation.x) * k;
      this.root.position.y += (0 - this.root.position.y) * k;
    }

    const t = performance.now() * 0.001;
    const rm = this.ring.material as THREE.MeshBasicMaterial;
    rm.opacity = 0.45 + Math.sin(t * 2.2) * 0.2;
    const k = 1 + Math.sin(t * 2.2) * 0.06;
    this.ring.scale.set(k, k, k);
  }

  render(_gl: WebGL2RenderingContext, args: any) {
    if (!this.visible) return;

    const now = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 0.016;
    this.lastT = now;
    this.animate(dt);

    // 방향은 부드럽게 따라간다
    this.renderHeading = lerpAngle(this.renderHeading, this.heading, Math.min(1, dt * 6));

    const mc = MercatorCoordinate.fromLngLat(
      { lng: this.position[0], lat: this.position[1] },
      this.altitude
    );

    // 실물 크기(키 1.75m)로 두면 줌 18 에서도 4px 남짓이라 보이지 않는다.
    // 내비게이션 앱의 아바타처럼, 화면에서 항상 비슷한 크기로 읽히도록
    // 줌에 따라 배율을 준다. 아주 가까이 당기면 1:1 로 수렴한다.
    const zoom = this.map.getZoom();
    const mPerPx =
      (40075016.686 * Math.cos((this.position[1] * Math.PI) / 180)) /
      (512 * Math.pow(2, zoom));
    const targetPx = 46;
    const boost = Math.max(1, Math.min(7, (targetPx * mPerPx) / 1.75));
    const scale = mc.meterInMercatorCoordinateUnits() * boost;

    // three 의 Y-up 을 지도의 Z-up 으로 세운다
    const rx = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    // 방위각: 지도 북쪽(-Y in mercator) 기준 시계방향
    const rz = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(0, 1, 0),
      -(this.renderHeading * Math.PI) / 180
    );

    const m = new THREE.Matrix4().fromArray(
      (args?.defaultProjectionData?.mainMatrix ?? args?.modelViewProjectionMatrix) as number[]
    );
    const l = new THREE.Matrix4()
      .makeTranslation(mc.x, mc.y, mc.z)
      .scale(new THREE.Vector3(scale, -scale, scale))
      .multiply(rx)
      .multiply(rz);

    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }
}
