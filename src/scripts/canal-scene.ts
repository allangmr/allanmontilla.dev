import {
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

type SceneHandle = {
  destroy: () => void;
};

/**
 * Water-channel path on canal-hero.png (u, v with v=0 at top).
 * Runs toward bottom-left / locks / viewer — NOT the orange mountain contours.
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

  // Full cinematic canal plate (water + locks + mountains with topo lines)
  const plateGeo = new PlaneGeometry(1, 1);
  const plateMat = new MeshBasicMaterial({
    toneMapped: false,
    depthWrite: true,
  });
  const plate = new Mesh(plateGeo, plateMat);
  plate.position.z = 0;
  scene.add(plate);

  // Large opaque ship — sits IN the water, never ghostly
  const shipGeo = new PlaneGeometry(1, 1);
  const shipMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 1,
    depthWrite: true,
    toneMapped: false,
  });
  const ship = new Mesh(shipGeo, shipMat);
  ship.position.z = 0.02;
  ship.visible = false;
  scene.add(ship);

  let disposed = false;
  let raf = 0;
  let running = false;
  let last = performance.now();
  // Start upstream (top-right), sail toward locks (bottom-left)
  let progress = reduced ? 0.55 : 0.12;
  let drift = 0;
  let plateW = 1;
  let plateH = 1;

  const placeShip = (t: number) => {
    const uv = samplePath(WATER_UV, t);
    ship.position.x = (uv.x - 0.5) * plateW;
    ship.position.y = (0.5 - uv.y) * plateH;
    ship.position.z = 0.02;
    // ship.png bow already faces bottom-left — no extra rotation
    ship.rotation.set(0, 0, 0);
  };

  const layout = () => {
    const w = parent.clientWidth || canvas.clientWidth || 1;
    const h = parent.clientHeight || canvas.clientHeight || 1;
    const aspect = w / h;
    const plateAspect = 1600 / 900;

    // Cover canvas with 16:9 canal plate
    if (aspect > plateAspect) {
      plateW = aspect * 2;
      plateH = plateW / plateAspect;
    } else {
      plateH = 2;
      plateW = plateH * plateAspect;
    }
    plate.scale.set(plateW, plateH, 1);

    // ~45% of visible canal width ≈ ~26% of plate width (canal ~55% of frame diagonally)
    const shipW = plateW * 0.26;
    const shipH = shipW * (933 / 1400);
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
    ship.position.y += Math.sin(now * 0.0018) * plateH * 0.0012;

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
      shipMat.map = shipTex;
      shipMat.transparent = true;
      shipMat.opacity = 1;
      shipMat.needsUpdate = true;
      ship.visible = true;
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
      if (plateMat.map) plateMat.map.dispose();
      if (shipMat.map) shipMat.map.dispose();
      plateMat.dispose();
      shipMat.dispose();
    },
  };
}
