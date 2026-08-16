import {
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

/** Sink this fraction of ship height so the red waterline meets the water. */
const SHIP_SINK = 0.28;

type SceneHandle = {
  destroy: () => void;
};

/**
 * Water-channel path on canal-hero.png (u, v with v=0 at top).
 * Toward bottom-left / locks / viewer.
 */
const WATER_UV: ReadonlyArray<readonly [number, number]> = [
  [0.71, 0.28],
  [0.68, 0.32],
  [0.66, 0.36],
  [0.62, 0.39],
  [0.59, 0.42],
  [0.56, 0.45],
  [0.53, 0.49],
  [0.5, 0.52],
  [0.47, 0.55],
  [0.42, 0.6],
  [0.38, 0.65],
  [0.35, 0.68],
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
  const t0 = Math.max(0, t - 0.02);
  const t1 = Math.min(1, t + 0.02);
  const a = samplePath(points, t0);
  const b = samplePath(points, t1);
  return b.sub(a).normalize();
}

function makeShadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 72, 4, 128, 72, 118);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function makeWakeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  // Brighter foam V so it reads on dark teal water
  const g = ctx.createLinearGradient(8, 80, 300, 80);
  g.addColorStop(0, 'rgba(230,236,242,0.75)');
  g.addColorStop(0.25, 'rgba(200,214,224,0.4)');
  g.addColorStop(0.65, 'rgba(170,188,200,0.15)');
  g.addColorStop(1, 'rgba(170,188,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(10, 80);
  ctx.lineTo(300, 22);
  ctx.lineTo(300, 138);
  ctx.closePath();
  ctx.fill();
  const g2 = ctx.createLinearGradient(10, 80, 220, 80);
  g2.addColorStop(0, 'rgba(245,248,250,0.7)');
  g2.addColorStop(1, 'rgba(245,248,250,0)');
  ctx.strokeStyle = g2;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(14, 80);
  ctx.lineTo(210, 80);
  ctx.stroke();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
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
  const plateMat = new MeshBasicMaterial({
    toneMapped: false,
    depthWrite: true,
  });
  const plate = new Mesh(plateGeo, plateMat);
  plate.position.z = 0;
  scene.add(plate);

  // Contact shadow — sits on water under the hull
  const shadowTex = makeShadowTexture();
  const shadowMat = new MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new Mesh(new PlaneGeometry(1, 1), shadowMat);
  shadow.position.z = 0.008;
  shadow.renderOrder = 1;
  shadow.visible = false;
  scene.add(shadow);

  // Wake behind stern
  const wakeTex = makeWakeTexture();
  const wakeMat = new MeshBasicMaterial({
    map: wakeTex,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
  const wake = new Mesh(new PlaneGeometry(1, 1), wakeMat);
  wake.position.z = 0.01;
  wake.renderOrder = 2;
  wake.visible = false;
  scene.add(wake);

  // Ship — opaque cutout, alpha tested to kill white fringe/halo
  const shipGeo = new PlaneGeometry(1, 1);
  const shipMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 1,
    alphaTest: 0.5,
    depthWrite: true,
    toneMapped: false,
  });
  const ship = new Mesh(shipGeo, shipMat);
  ship.position.z = 0.02;
  ship.renderOrder = 3;
  ship.visible = false;
  scene.add(ship);

  let disposed = false;
  let raf = 0;
  let running = false;
  let last = performance.now();
  let progress = reduced ? 0.55 : 0.12;
  let drift = 0;
  let plateW = 1;
  let plateH = 1;
  let shipW = 1;
  let shipH = 1;

  const placeShip = (t: number) => {
    const uv = samplePath(WATER_UV, t);
    const x = (uv.x - 0.5) * plateW;
    const y = (0.5 - uv.y) * plateH;
    // Sink so red waterline meets the surface (keel hidden in water)
    const sunkY = y - shipH * SHIP_SINK;

    ship.position.set(x, sunkY, 0.02);
    ship.rotation.set(0, 0, 0);

    // Shadow under hull — dark contact on water
    shadow.position.set(x + shipW * 0.02, sunkY - shipH * 0.32, 0.008);
    shadow.scale.set(shipW * 1.05, shipH * 0.45, 1);
    shadow.rotation.z = 0;

    // Wake aft of stern (opposite travel = toward top-right)
    const tangent = pathTangent(WATER_UV, t);
    const dirX = tangent.x;
    const dirY = -tangent.y;
    const aftX = -dirX;
    const aftY = -dirY;
    const wakeLen = shipW * 1.05;
    const wakeWid = shipH * 0.5;
    wake.position.set(
      x + aftX * shipW * 0.62,
      sunkY + aftY * shipH * 0.2 - shipH * 0.3,
      0.01,
    );
    wake.scale.set(wakeLen, wakeWid, 1);
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

    // Keep large: ~45% of canal width
    shipW = plateW * 0.26;
    shipH = shipW * (933 / 1400);
    ship.scale.set(shipW, shipH, 1);

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

    progress += dt * 0.03;
    if (progress > 0.92) progress = 0.08;

    placeShip(progress);
    // Tiny bob — stay grounded (don't lift out of water)
    const bob = Math.sin(now * 0.0018) * shipH * 0.008;
    ship.position.y += bob;
    shadow.position.y += bob * 0.4;
    wake.position.y += bob * 0.3;

    drift += dt;
    camera.position.x = Math.sin(drift * 0.1) * 0.006;
    camera.position.y = Math.cos(drift * 0.08) * 0.004;
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
      progress = 0.55;
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

      // Premultiplied-style cutout: hard alpha, no fringe glow
      shipTex.premultiplyAlpha = true;
      shipMat.map = shipTex;
      shipMat.transparent = true;
      shipMat.opacity = 1;
      shipMat.alphaTest = 0.55;
      shipMat.depthWrite = true;
      shipMat.needsUpdate = true;

      ship.visible = true;
      shadow.visible = true;
      wake.visible = true;
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
      if (plateMat.map) plateMat.map.dispose();
      if (shipMat.map) shipMat.map.dispose();
      shadowTex.dispose();
      wakeTex.dispose();
      plateMat.dispose();
      shipMat.dispose();
      shadowMat.dispose();
      wakeMat.dispose();
    },
  };
}
