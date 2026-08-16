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

/** Z stack: plate → covers → ship (waiting) → gate leaves → ship (through) → FX */
const Z_COVER = 0.004;
const Z_SHIP_WAIT = 0.01;
const Z_GATE = 0.018;
const Z_SHIP_PASS = 0.028;
const Z_SHADOW = 0.006;
const Z_WAKE = 0.007;

type SceneHandle = { destroy: () => void };

type LockGate = {
  cover: Mesh;
  left: Mesh;
  right: Mesh;
  /** Path progress when ship must wait until open */
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

/**
 * Gate centers on painted canal-hero locks (mid then foreground).
 * Foreground = big concrete gates in the lower-left channel (concrete span ~t=0.92).
 */
const LOCKS: ReadonlyArray<{ u: number; v: number; openAt: number; closeAt: number }> = [
  { u: 0.585, v: 0.425, openAt: 0.36, closeAt: 0.52 },
  { u: 0.358, v: 0.672, openAt: 0.78, closeAt: 0.92 },
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

/**
 * Bake ship.png to a hard-cutout opaque CanvasTexture.
 * Semi-transparent hull pixels are un-premultiplied and forced to alpha 255 so
 * mountains/water never show through. Empty background stays alpha 0 for alphaTest.
 */
function bakeOpaqueShipTexture(source: CanvasImageSource & { width: number; height: number }): CanvasTexture {
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0);

  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a >= 40) {
      if (a < 255) {
        const inv = 255 / a;
        d[i] = Math.min(255, Math.round(d[i] * inv));
        d[i + 1] = Math.min(255, Math.round(d[i + 1] * inv));
        d[i + 2] = Math.min(255, Math.round(d[i + 2] * inv));
      }
      d[i + 3] = 255;
    } else {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(image, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
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
  renderer.sortObjects = true;

  const plateGeo = new PlaneGeometry(1, 1);
  const plateMat = new MeshBasicMaterial({ toneMapped: false, depthWrite: true });
  const plate = new Mesh(plateGeo, plateMat);
  plate.position.z = 0;
  scene.add(plate);

  // Water-colored covers hide painted-closed gates on the plate (canal teal/dark)
  const waterMat = new MeshBasicMaterial({
    color: 0x1e2a32,
    toneMapped: false,
    depthWrite: false,
  });

  // Dark concrete / metal lock doors
  const gateMat = new MeshBasicMaterial({
    color: 0x3a424a,
    toneMapped: false,
    depthWrite: true,
  });
  const gateEdgeMat = new MeshBasicMaterial({
    color: 0x2a3036,
    toneMapped: false,
    depthWrite: true,
  });

  const locks: LockGate[] = LOCKS.map((spec) => {
    const cover = new Mesh(new PlaneGeometry(1, 1), waterMat.clone());
    cover.position.z = Z_COVER;
    cover.renderOrder = 1;
    scene.add(cover);

    const left = new Mesh(new BoxGeometry(1, 1, 0.12), gateMat.clone());
    left.position.z = Z_GATE;
    left.renderOrder = 5;
    scene.add(left);

    const right = new Mesh(new BoxGeometry(1, 1, 0.12), gateEdgeMat.clone());
    right.position.z = Z_GATE;
    right.renderOrder = 5;
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
  shadow.position.z = Z_SHADOW;
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
  wake.position.z = Z_WAKE;
  wake.renderOrder = 3;
  wake.visible = false;
  scene.add(wake);

  // Solid ship — opaque map from bake + alphaTest cutout of empty background only
  const shipGeo = new PlaneGeometry(1, 1);
  const shipMat = new MeshBasicMaterial({
    transparent: false,
    opacity: 1,
    alphaTest: 0.5,
    depthWrite: true,
    toneMapped: false,
  });
  const ship = new Mesh(shipGeo, shipMat);
  ship.position.z = Z_SHIP_WAIT;
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
  let shipAspect = 1024 / 1536;

  const layoutLocks = () => {
    LOCKS.forEach((spec, i) => {
      const lock = locks[i];
      const pos = uvToPlane(spec.u, spec.v, plateW, plateH);
      const tangent = pathTangent(WATER_UV, (spec.openAt + spec.closeAt) / 2);
      const angle = Math.atan2(-tangent.y, tangent.x);
      const across = angle + Math.PI / 2;

      // Large water patch fully hides painted-closed gate in the channel
      const coverAcross = plateW * 0.175;
      const coverAlong = plateH * 0.085;
      lock.cover.position.set(pos.x, pos.y, Z_COVER);
      lock.cover.scale.set(coverAcross, coverAlong, 1);
      lock.cover.rotation.z = across;

      // Thick lock-door leaves spanning the channel when closed
      const leafAcross = coverAcross * 0.5;
      const leafAlong = coverAlong * 1.35;
      lock.left.scale.set(leafAcross, leafAlong, 1);
      lock.right.scale.set(leafAcross, leafAlong, 1);

      lock.left.userData.baseX = pos.x - Math.cos(across) * leafAcross * 0.5;
      lock.left.userData.baseY = pos.y - Math.sin(across) * leafAcross * 0.5;
      lock.right.userData.baseX = pos.x + Math.cos(across) * leafAcross * 0.5;
      lock.right.userData.baseY = pos.y + Math.sin(across) * leafAcross * 0.5;
      lock.left.userData.across = across;
      lock.right.userData.across = across;
      lock.left.userData.leafAcross = leafAcross;
      lock.right.userData.leafAcross = leafAcross;
      lock.left.rotation.z = across;
      lock.right.rotation.z = across;
    });
  };

  const applyGateOpen = (lock: LockGate) => {
    const o = lock.open;
    const swing = o * 0.85;
    const across = lock.left.userData.across as number;
    const leafAcross = lock.left.userData.leafAcross as number;
    const slide = o * leafAcross * 1.05;
    lock.left.position.x = lock.left.userData.baseX - Math.cos(across) * slide;
    lock.left.position.y = lock.left.userData.baseY - Math.sin(across) * slide;
    lock.right.position.x = lock.right.userData.baseX + Math.cos(across) * slide;
    lock.right.position.y = lock.right.userData.baseY + Math.sin(across) * slide;
    lock.left.rotation.z = across - swing * 0.28;
    lock.right.rotation.z = across + swing * 0.28;
    lock.left.position.z = Z_GATE;
    lock.right.position.z = Z_GATE;
  };

  /**
   * Open gates while the ship approaches / waits at openAt.
   * Hard-stop keeps progress at openAt until open >= 0.9, so opening must
   * begin on approach — not only after progress has already passed the gate.
   */
  const updateGates = (t: number, dt: number) => {
    for (const lock of locks) {
      let target = 0;
      if (t >= lock.openAt - 0.12 && t <= lock.closeAt) {
        if (t < lock.openAt) {
          target = easeInOut((t - (lock.openAt - 0.12)) / 0.12);
          // Once waiting at the door, finish opening fully
          if (t >= lock.openAt - 0.002) target = 1;
        } else {
          target = 1;
        }
      } else if (t > lock.closeAt && t < lock.closeAt + 0.1) {
        target = 1 - easeInOut((t - lock.closeAt) / 0.1);
      }
      const speed = 1.8 * dt;
      if (lock.open < target) lock.open = Math.min(target, lock.open + speed);
      else if (lock.open > target) lock.open = Math.max(target, lock.open - speed);
      applyGateOpen(lock);
    }
  };

  /** HARD STOP: progress cannot pass a lock's openAt until that lock is ≥ 90% open. */
  const hardStopProgress = (t: number): number => {
    let capped = t;
    for (const lock of locks) {
      if (capped >= lock.openAt && lock.open < 0.9) {
        capped = Math.min(capped, lock.openAt);
      }
    }
    return capped;
  };

  /** Ship sits behind closed leaves; rises through the gap only when open. */
  const shipZForProgress = (t: number): number => {
    for (const lock of locks) {
      const nearGate = t >= lock.openAt - 0.04 && t <= lock.closeAt;
      if (nearGate && lock.open < 0.9) return Z_SHIP_WAIT;
    }
    return Z_SHIP_PASS;
  };

  const placeShip = (t: number) => {
    const uv = samplePath(WATER_UV, t);
    const x = (uv.x - 0.5) * plateW;
    const y = (0.5 - uv.y) * plateH;
    const sunkY = y - shipH * SHIP_SINK;
    const z = shipZForProgress(t);

    ship.position.set(x, sunkY, z);
    ship.rotation.set(0, 0, 0);
    ship.renderOrder = z < Z_GATE ? 4 : 6;

    shadow.position.set(x + shipW * 0.02, sunkY - shipH * 0.3, Z_SHADOW);
    shadow.scale.set(shipW * 1.0, shipH * 0.42, 1);

    const tangent = pathTangent(WATER_UV, t);
    const aftX = -tangent.x;
    const aftY = tangent.y;
    wake.position.set(
      x + aftX * shipW * 0.55,
      sunkY + aftY * shipH * 0.15 - shipH * 0.28,
      Z_WAKE,
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
    shipH = shipW * shipAspect;
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

    // Open/close gates from current progress first so the hard-stop can release
    updateGates(progress, dt);

    let next = progress + dt * 0.026;
    next = hardStopProgress(next);
    if (next > 0.94) {
      next = 0.04;
      locks.forEach((l) => {
        l.open = 0;
        applyGateOpen(l);
      });
    }
    progress = next;

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

      const src = shipTex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
      const baked = bakeOpaqueShipTexture(src as CanvasImageSource & { width: number; height: number });
      shipTex.dispose();

      shipMat.map = baked;
      shipMat.transparent = false;
      shipMat.opacity = 1;
      shipMat.alphaTest = 0.5;
      shipMat.needsUpdate = true;

      const iw = (src as { width: number }).width || 1536;
      const ih = (src as { height: number }).height || 1024;
      shipAspect = ih / iw;

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
