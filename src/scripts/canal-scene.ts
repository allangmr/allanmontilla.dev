import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  WebGLRenderer,
} from 'three';

const SCENE_BG = 0x0f1821;
const SHIP_SINK = 0.22;
/** Plate-width scale ≈ 18–22% of canal width (was 0.26). */
const SHIP_PLATE_SCALE = 0.17;

type SceneHandle = { destroy: () => void };

type LockGate = {
  cover: Mesh;
  left: Mesh;
  right: Mesh;
  /** Path progress when ship should trigger open */
  openAt: number;
  /** Path progress when stern has cleared — start closing */
  closeAt: number;
  open: number; // 0 closed … 1 open
};

/**
 * Water centerline on canal-hero.png (u,v with v=0 at top).
 * Sampled from real water pixels, upstream (top-right) → foreground locks (bottom-left).
 */
const WATER_UV: ReadonlyArray<readonly [number, number]> = [
  [0.74, 0.2],
  [0.72, 0.26],
  [0.7, 0.29],
  [0.68, 0.32],
  [0.66, 0.34],
  [0.63, 0.37],
  [0.61, 0.39],
  [0.59, 0.42],
  [0.57, 0.44],
  [0.55, 0.46],
  [0.53, 0.49],
  [0.5, 0.51],
  [0.48, 0.54],
  [0.45, 0.57],
  [0.41, 0.61],
  [0.38, 0.65],
  [0.35, 0.68],
  [0.33, 0.7],
];

/** Gate centers along the same UV space (mid then foreground). */
const LOCKS: ReadonlyArray<{ u: number; v: number; openAt: number; closeAt: number }> = [
  { u: 0.58, v: 0.42, openAt: 0.28, closeAt: 0.48 },
  { u: 0.37, v: 0.66, openAt: 0.62, closeAt: 0.84 },
];

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function loadTexture(loader: TextureLoader, url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = 4;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

function samplePath(points: ReadonlyArray<readonly [number, number]>, t: number): Vector2 {
  const n = points.length - 1;
  const clamped = Math.min(1, Math.max(0, t));
  const f = clamped * n;
  const i = Math.min(n - 1, Math.floor(f));
  const local = f - i;
  const a = points[i];
  const b = points[i + 1];
  return new Vector2(a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local);
}

function pathTangent(points: ReadonlyArray<readonly [number, number]>, t: number): Vector2 {
  const a = samplePath(points, Math.max(0, t - 0.02));
  const b = samplePath(points, Math.min(1, t + 0.02));
  return b.sub(a).normalize();
}

function uvToPlane(u: number, v: number, plateW: number, plateH: number): Vector2 {
  return new Vector2((u - 0.5) * plateW, (0.5 - v) * plateH);
}

function makeShadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 72, 4, 128, 72, 118);
  g.addColorStop(0, 'rgba(0,0,0,0.7)');
  g.addColorStop(0.4, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function makeWakeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(8, 64, 240, 64);
  g.addColorStop(0, 'rgba(220,230,238,0.65)');
  g.addColorStop(0.4, 'rgba(180,198,210,0.25)');
  g.addColorStop(1, 'rgba(180,198,210,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(10, 64);
  ctx.lineTo(240, 30);
  ctx.lineTo(240, 98);
  ctx.closePath();
  ctx.fill();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export function mountCanalScene(canvas: HTMLCanvasElement): SceneHandle {
  const reduced = prefersReducedMotion();
  const parent = canvas.parentElement ?? canvas;

  const scene = new Scene();
  scene.background = new Color(SCENE_BG);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(SCENE_BG, 1);

  const plateGeo = new PlaneGeometry(1, 1);
  const plateMat = new MeshBasicMaterial({ toneMapped: false, depthWrite: true });
  const plate = new Mesh(plateGeo, plateMat);
  plate.position.z = 0;
  scene.add(plate);

  // Water-colored covers hide painted-closed gates on the plate
  const waterMat = new MeshBasicMaterial({
    color: 0x2c363a,
    toneMapped: false,
    depthWrite: false,
  });

  const gateMat = new MeshBasicMaterial({
    color: 0x3a4248,
    toneMapped: false,
    depthWrite: true,
  });
  const gateEdgeMat = new MeshBasicMaterial({
    color: 0x2a3036,
    toneMapped: false,
  });

  const locks: LockGate[] = LOCKS.map((spec) => {
    const cover = new Mesh(new PlaneGeometry(1, 1), waterMat.clone());
    cover.position.z = 0.004;
    cover.renderOrder = 1;
    scene.add(cover);

    const left = new Mesh(new BoxGeometry(1, 1, 0.08), gateMat.clone());
    left.position.z = 0.015;
    left.renderOrder = 2;
    scene.add(left);

    const right = new Mesh(new BoxGeometry(1, 1, 0.08), gateEdgeMat.clone());
    right.position.z = 0.015;
    right.renderOrder = 2;
    scene.add(right);

    return { cover, left, right, openAt: spec.openAt, closeAt: spec.closeAt, open: 0 };
  });

  const shadowTex = makeShadowTexture();
  const shadowMat = new MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new Mesh(new PlaneGeometry(1, 1), shadowMat);
  shadow.position.z = 0.006;
  shadow.renderOrder = 3;
  shadow.visible = false;
  scene.add(shadow);

  const wakeTex = makeWakeTexture();
  const wakeMat = new MeshBasicMaterial({
    map: wakeTex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    toneMapped: false,
  });
  const wake = new Mesh(new PlaneGeometry(1, 1), wakeMat);
  wake.position.z = 0.007;
  wake.renderOrder = 3;
  wake.visible = false;
  scene.add(wake);

  // Fully opaque ship — no transparent material
  const shipGeo = new PlaneGeometry(1, 1);
  const shipMat = new MeshBasicMaterial({
    transparent: false,
    opacity: 1,
    depthWrite: true,
    toneMapped: false,
  });
  const ship = new Mesh(shipGeo, shipMat);
  ship.position.z = 0.02;
  ship.renderOrder = 4;
  ship.visible = false;
  scene.add(ship);

  let disposed = false;
  let raf = 0;
  let running = false;
  let last = performance.now();
  let progress = reduced ? 0.5 : 0.05;
  let drift = 0;
  let plateW = 1;
  let plateH = 1;
  let shipW = 1;
  let shipH = 1;

  const layoutLocks = () => {
    // Canal runs diagonally; gates span across channel perpendicular to path
    LOCKS.forEach((spec, i) => {
      const lock = locks[i];
      const pos = uvToPlane(spec.u, spec.v, plateW, plateH);
      const tangent = pathTangent(WATER_UV, (spec.openAt + spec.closeAt) / 2);
      const angle = Math.atan2(-tangent.y, tangent.x); // plane angle of travel
      const across = angle + Math.PI / 2;

      // Cover painted closed gate with water-colored strip across channel
      const coverW = plateW * 0.11;
      const coverH = plateH * 0.028;
      lock.cover.position.set(pos.x, pos.y, 0.004);
      lock.cover.scale.set(coverW, coverH, 1);
      lock.cover.rotation.z = across;

      // Two leaves meet at center when closed; swing open along across-axis
      const leafW = coverW * 0.48;
      const leafH = coverH * 0.95;
      lock.left.scale.set(leafW, leafH, 1);
      lock.right.scale.set(leafW, leafH, 1);
      // Store base pose on userData for animation
      lock.left.userData.baseX = pos.x - Math.cos(across) * leafW * 0.52;
      lock.left.userData.baseY = pos.y - Math.sin(across) * leafW * 0.52;
      lock.right.userData.baseX = pos.x + Math.cos(across) * leafW * 0.52;
      lock.right.userData.baseY = pos.y + Math.sin(across) * leafW * 0.52;
      lock.left.userData.across = across;
      lock.right.userData.across = across;
      lock.left.userData.leafW = leafW;
      lock.right.userData.leafW = leafW;
      lock.left.rotation.z = across;
      lock.right.rotation.z = across;
    });
  };

  const applyGateOpen = (lock: LockGate) => {
    const o = lock.open;
    const swing = o * 0.92; // radians-ish via offset along channel walls
    const across = lock.left.userData.across as number;
    const leafW = lock.left.userData.leafW as number;
    // Slide leaves into walls (along across direction outward)
    const slide = o * leafW * 0.95;
    lock.left.position.x = lock.left.userData.baseX - Math.cos(across) * slide;
    lock.left.position.y = lock.left.userData.baseY - Math.sin(across) * slide;
    lock.right.position.x = lock.right.userData.baseX + Math.cos(across) * slide;
    lock.right.position.y = lock.right.userData.baseY + Math.sin(across) * slide;
    // Slight yaw as they recess
    lock.left.rotation.z = across - swing * 0.35;
    lock.right.rotation.z = across + swing * 0.35;
    lock.left.position.z = 0.015;
    lock.right.position.z = 0.015;
  };

  const updateGates = (t: number, dt: number) => {
    for (const lock of locks) {
      let target = 0;
      if (t >= lock.openAt && t <= lock.closeAt) target = 1;
      else if (t > lock.closeAt && t < lock.closeAt + 0.08) {
        target = 1 - (t - lock.closeAt) / 0.08;
      } else if (t > lock.openAt - 0.1 && t < lock.openAt) {
        // start cracking open just before
        target = easeInOut((t - (lock.openAt - 0.1)) / 0.1);
      }
      const speed = 2.2 * dt;
      if (lock.open < target) lock.open = Math.min(target, lock.open + speed);
      else if (lock.open > target) lock.open = Math.max(target, lock.open - speed);
      applyGateOpen(lock);
    }
  };

  /** Slow near closed gates that are not yet open. */
  const speedScale = (t: number): number => {
    for (const lock of locks) {
      const dist = lock.openAt - t;
      if (dist > 0 && dist < 0.12 && lock.open < 0.85) {
        return 0.35 + 0.65 * lock.open;
      }
    }
    return 1;
  };

  const placeShip = (t: number) => {
    const uv = samplePath(WATER_UV, t);
    const x = (uv.x - 0.5) * plateW;
    const y = (0.5 - uv.y) * plateH;
    const sunkY = y - shipH * SHIP_SINK;

    ship.position.set(x, sunkY, 0.02);
    ship.rotation.set(0, 0, 0);

    shadow.position.set(x + shipW * 0.02, sunkY - shipH * 0.3, 0.006);
    shadow.scale.set(shipW * 1.0, shipH * 0.42, 1);

    const tangent = pathTangent(WATER_UV, t);
    const aftX = -tangent.x;
    const aftY = tangent.y; // plane y flip of -(-tangent.y)
    wake.position.set(
      x + aftX * shipW * 0.55,
      sunkY + aftY * shipH * 0.15 - shipH * 0.28,
      0.007,
    );
    wake.scale.set(shipW * 0.9, shipH * 0.42, 1);
    wake.rotation.z = Math.atan2(aftY, aftX);
  };

  const layout = () => {
    const w = parent.clientWidth || canvas.clientWidth || 1;
    const h = parent.clientHeight || canvas.clientHeight || 1;
    const aspect = w / h;
    const plateAspect = 1600 / 900;

    if (aspect > plateAspect) {
      plateW = aspect * 2;
      plateH = plateW / plateAspect;
    } else {
      plateH = 2;
      plateW = plateH * plateAspect;
    }
    plate.scale.set(plateW, plateH, 1);

    shipW = plateW * SHIP_PLATE_SCALE;
    shipH = shipW * (1024 / 1536);
    ship.scale.set(shipW, shipH, 1);

    layoutLocks();
    locks.forEach(applyGateOpen);

    camera.left = -aspect;
    camera.right = aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    placeShip(progress);
  };

  const tick = (now: number) => {
    if (!running || disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    progress += dt * 0.028 * speedScale(progress);
    if (progress > 0.94) progress = 0.04;

    updateGates(progress, dt);
    placeShip(progress);
    const bob = Math.sin(now * 0.0018) * shipH * 0.006;
    ship.position.y += bob;
    shadow.position.y += bob * 0.35;
    wake.position.y += bob * 0.25;

    drift += dt;
    camera.position.x = Math.sin(drift * 0.1) * 0.005;
    camera.position.y = Math.cos(drift * 0.08) * 0.003;
    camera.lookAt(camera.position.x, camera.position.y, 0);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };

  const onVisibility = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!reduced && !disposed && ship.visible) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const onMotionChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      running = false;
      cancelAnimationFrame(raf);
      progress = 0.5;
      locks.forEach((l) => {
        l.open = 1;
        applyGateOpen(l);
      });
      placeShip(progress);
      renderer.render(scene, camera);
    } else if (!document.hidden && !disposed && ship.visible) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', onMotionChange);
  const ro = new ResizeObserver(layout);
  ro.observe(parent);
  document.addEventListener('visibilitychange', onVisibility);
  layout();
  renderer.render(scene, camera);

  const loader = new TextureLoader();
  void Promise.all([
    loadTexture(loader, '/scene/canal-hero.png'),
    loadTexture(loader, '/scene/ship.png'),
  ])
    .then(([heroTex, shipTex]) => {
      if (disposed) {
        heroTex.dispose();
        shipTex.dispose();
        return;
      }
      plateMat.map = heroTex;
      plateMat.needsUpdate = true;

      shipMat.map = shipTex;
      shipMat.transparent = false;
      shipMat.opacity = 1;
      shipMat.needsUpdate = true;

      ship.visible = true;
      shadow.visible = true;
      wake.visible = true;
      if (reduced) {
        locks.forEach((l) => {
          l.open = 1;
          applyGateOpen(l);
        });
      }
      layout();
      renderer.render(scene, camera);

      if (!reduced) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    })
    .catch(() => {
      renderer.render(scene, camera);
    });

  return {
    destroy() {
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotionChange);
      renderer.dispose();
      plateGeo.dispose();
      shipGeo.dispose();
      shadow.geometry.dispose();
      wake.geometry.dispose();
      locks.forEach((l) => {
        l.cover.geometry.dispose();
        l.left.geometry.dispose();
        l.right.geometry.dispose();
        (l.cover.material as MeshBasicMaterial).dispose();
        (l.left.material as MeshBasicMaterial).dispose();
        (l.right.material as MeshBasicMaterial).dispose();
      });
      if (plateMat.map) plateMat.map.dispose();
      if (shipMat.map) shipMat.map.dispose();
      shadowTex.dispose();
      wakeTex.dispose();
      plateMat.dispose();
      shipMat.dispose();
      shadowMat.dispose();
      wakeMat.dispose();
      waterMat.dispose();
      gateMat.dispose();
      gateEdgeMat.dispose();
    },
  };
}
