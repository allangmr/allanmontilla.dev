import {
  CanvasTexture,
  Color,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoBlending,
  NormalBlending,
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
/** Slightly under channel width so water shows on both sides. */
const SHIP_PLATE_SCALE = 0.145;
/** Path delta: ship center waits in water in front of the gate. */
const GATE_STOP_BEFORE = 0.11;

/** Z stack: plate → ship (waiting) → gate leaves → ship (through) → FX */
const Z_SHIP_WAIT = 0.008;
const Z_GATE = 0.025;
const Z_SHIP_PASS = 0.035;
const Z_SHADOW = 0.006;
const Z_WAKE = 0.007;

const PATH_START = 0.02;
const PATH_END = 0.9;
const FADE_OUT_AT = 0.84;
const FADE_SPEED = 2.8;
const TRAVEL_SPEED = 0.024;

type SceneHandle = { destroy: () => void };

type LockGate = {
  left: Mesh;
  right: Mesh;
  /** Path progress of the gate center on the water path */
  openAt: number;
  /** Path progress where the ship center must wait (in front of gate) */
  stopAt: number;
  /** Path progress when stern has cleared — start closing */
  closeAt: number;
  open: number; // 0 closed … 1 open
};

/**
 * Water centerline on canal-hero.png (u,v with v=0 at top).
 * One-way only: distant up-canal (top-right) → foreground (bottom-left).
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
 * Single lock in the visible mid-canal (right/center of the hero crop).
 * Painted foreground locks sit under the left copy/veil — do not place geometry there.
 */
const LOCK = {
  u: 0.56,
  v: 0.445,
  openAt: 0.5,
  closeAt: 0.7,
} as const;

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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

/**
 * Bake ship.png to a hard-cutout opaque CanvasTexture.
 * Semi-transparent hull pixels are un-premultiplied and forced to alpha 255.
 */
function bakeOpaqueShipTexture(source: CanvasImageSource & { width: number; height: number }): CanvasTexture {
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true })!;
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
  tex.premultiplyAlpha = false;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
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
    premultipliedAlpha: false,
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

  // Dark concrete / metal lock doors — thin slabs across the channel
  const gateMat = new MeshBasicMaterial({
    color: 0x3a424c,
    toneMapped: false,
    depthWrite: true,
  });
  const gateEdgeMat = new MeshBasicMaterial({
    color: 0x2a3138,
    toneMapped: false,
    depthWrite: true,
  });

  const left = new Mesh(new PlaneGeometry(1, 1), gateMat);
  left.position.z = Z_GATE;
  left.renderOrder = 5;
  scene.add(left);

  const right = new Mesh(new PlaneGeometry(1, 1), gateEdgeMat);
  right.position.z = Z_GATE;
  right.renderOrder = 5;
  scene.add(right);

  const lock: LockGate = {
    left,
    right,
    openAt: LOCK.openAt,
    stopAt: Math.max(PATH_START + 0.04, LOCK.openAt - GATE_STOP_BEFORE),
    closeAt: LOCK.closeAt,
    open: 0,
  };

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

  // Solid ship — opaque baked map; fade uses opacity only during loop transitions
  const shipGeo = new PlaneGeometry(1, 1);
  const shipMat = new MeshBasicMaterial({
    transparent: false,
    opacity: 1,
    alphaTest: 0.5,
    blending: NoBlending,
    depthWrite: true,
    depthTest: true,
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
  let progress = reduced ? 0.55 : PATH_START;
  let fade = reduced ? 1 : 0;
  let fadingOut = false;
  let drift = 0;
  let plateW = 1;
  let plateH = 1;
  let shipW = 1;
  let shipH = 1;
  let shipAspect = 1024 / 1536;
  let ready = false;

  const applyShipFade = (f: number) => {
    const solid = f >= 0.995;
    if (solid) {
      shipMat.transparent = false;
      shipMat.opacity = 1;
      shipMat.blending = NoBlending;
      shipMat.depthWrite = true;
    } else {
      shipMat.transparent = true;
      shipMat.opacity = Math.max(0, Math.min(1, f));
      shipMat.blending = NormalBlending;
      shipMat.depthWrite = f > 0.55;
    }
    shipMat.alphaTest = 0.5;
    shipMat.needsUpdate = true;

    const show = f > 0.02 && ready;
    ship.visible = show;
    shadow.visible = show;
    wake.visible = show;
    shadowMat.opacity = f;
    wakeMat.opacity = 0.85 * f;
  };

  const layoutLock = () => {
    const pos = uvToPlane(LOCK.u, LOCK.v, plateW, plateH);
    const tangent = pathTangent(WATER_UV, LOCK.openAt);
    // Angle of travel in plane XY; doors sit perpendicular across the channel
    const travel = Math.atan2(-tangent.y, tangent.x);
    const across = travel + Math.PI / 2;

    // Channel-spanning doors: wide across water, thin along the path (not diamonds)
    const channelW = plateW * 0.095;
    const doorThickness = plateH * 0.022;
    const leafW = channelW * 0.5;
    const leafH = doorThickness;

    left.scale.set(leafW, leafH, 1);
    right.scale.set(leafW, leafH, 1);

    left.userData.baseX = pos.x - Math.cos(across) * leafW * 0.5;
    left.userData.baseY = pos.y - Math.sin(across) * leafW * 0.5;
    right.userData.baseX = pos.x + Math.cos(across) * leafW * 0.5;
    right.userData.baseY = pos.y + Math.sin(across) * leafW * 0.5;
    left.userData.across = across;
    right.userData.across = across;
    left.userData.leafW = leafW;
    right.userData.leafW = leafW;
    left.rotation.z = across;
    right.rotation.z = across;
  };

  const applyGateOpen = () => {
    const o = lock.open;
    const across = left.userData.across as number;
    const leafW = left.userData.leafW as number;
    // Slide leaves into the banks; slight yaw as they recess
    const slide = o * leafW * 1.05;
    const swing = o * 0.2;
    left.position.x = left.userData.baseX - Math.cos(across) * slide;
    left.position.y = left.userData.baseY - Math.sin(across) * slide;
    right.position.x = right.userData.baseX + Math.cos(across) * slide;
    right.position.y = right.userData.baseY + Math.sin(across) * slide;
    left.rotation.z = across - swing;
    right.rotation.z = across + swing;
    left.position.z = Z_GATE;
    right.position.z = Z_GATE;
  };

  const updateGate = (t: number, dt: number) => {
    let target = 0;
    if (t >= lock.stopAt && t <= lock.closeAt) target = 1;
    else if (t > lock.closeAt && t < lock.closeAt + 0.1) {
      target = 1 - easeInOut((t - lock.closeAt) / 0.1);
    }
    const speed = (target > lock.open ? 1.4 : 2.1) * dt;
    if (lock.open < target) lock.open = Math.min(target, lock.open + speed);
    else if (lock.open > target) lock.open = Math.max(target, lock.open - speed);
    applyGateOpen();
  };

  /** HARD STOP: progress cannot pass stopAt until the lock is ≥ 90% open. */
  const hardStopProgress = (t: number): number => {
    if (t >= lock.stopAt && lock.open < 0.9) return Math.min(t, lock.stopAt);
    return t;
  };

  const shipZForProgress = (t: number): number => {
    const waiting = t >= lock.stopAt - 0.01 && t <= lock.openAt + 0.03;
    if (waiting && lock.open < 0.9) return Z_SHIP_WAIT;
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

    layoutLock();
    applyGateOpen();

    camera.left = -aspect;
    camera.right = aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    placeShip(progress);
    applyShipFade(fade);
  };

  const resetUpstream = () => {
    progress = PATH_START;
    lock.open = 0;
    applyGateOpen();
    fadingOut = false;
    fade = 0;
  };

  const tick = (now: number) => {
    if (!running || disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    updateGate(progress, dt);

    if (fadingOut) {
      fade = Math.max(0, fade - dt * FADE_SPEED);
      if (fade <= 0) resetUpstream();
    } else if (fade < 1) {
      fade = Math.min(1, fade + dt * FADE_SPEED);
      // Ease into the channel while fading in — still one-way forward only
      let next = progress + dt * TRAVEL_SPEED * 0.55;
      next = hardStopProgress(next);
      progress = Math.min(next, PATH_END);
    } else {
      let next = progress + dt * TRAVEL_SPEED;
      next = hardStopProgress(next);
      if (next >= FADE_OUT_AT) {
        fadingOut = true;
        progress = Math.min(next, PATH_END);
      } else {
        progress = next;
      }
    }

    applyShipFade(fade);
    placeShip(progress);
    const bob = Math.sin(now * 0.0018) * shipH * 0.006 * fade;
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
    } else if (!reduced && !disposed && ready) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const onMotionChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      running = false;
      cancelAnimationFrame(raf);
      progress = 0.55;
      fade = 1;
      fadingOut = false;
      lock.open = 1;
      applyGateOpen();
      placeShip(progress);
      applyShipFade(1);
      renderer.render(scene, camera);
    } else if (!document.hidden && !disposed && ready) {
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
    loadImage('/scene/ship.png'),
  ])
    .then(([heroTex, shipImg]) => {
      if (disposed) {
        heroTex.dispose();
        return;
      }
      plateMat.map = heroTex;
      plateMat.needsUpdate = true;

      const baked = bakeOpaqueShipTexture(shipImg);
      shipMat.map = baked;
      shipMat.transparent = false;
      shipMat.opacity = 1;
      shipMat.alphaTest = 0.5;
      shipMat.blending = NoBlending;
      shipMat.needsUpdate = true;

      shipAspect = shipImg.naturalHeight / shipImg.naturalWidth || 1024 / 1536;
      ready = true;

      if (reduced) {
        fade = 1;
        lock.open = 1;
        applyGateOpen();
        applyShipFade(1);
      } else {
        fade = 0;
        fadingOut = false;
        progress = PATH_START;
        applyShipFade(0);
      }

      layout();
      // Show plate immediately; ship fades in on the first frames
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
      left.geometry.dispose();
      right.geometry.dispose();
      if (plateMat.map) plateMat.map.dispose();
      if (shipMat.map) shipMat.map.dispose();
      shadowTex.dispose();
      wakeTex.dispose();
      plateMat.dispose();
      shipMat.dispose();
      shadowMat.dispose();
      wakeMat.dispose();
      gateMat.dispose();
      gateEdgeMat.dispose();
    },
  };
}
