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

/** Normalized UV polyline on the glowing canal (u, v with v=0 at top). Sampled from isthmus-path.png. */
const CANAL_UV: ReadonlyArray<readonly [number, number]> = [
  [0.27, 0.76],
  [0.32, 0.68],
  [0.37, 0.66],
  [0.42, 0.61],
  [0.48, 0.57],
  [0.53, 0.53],
  [0.58, 0.42],
  [0.63, 0.39],
  [0.68, 0.34],
  [0.73, 0.32],
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
  // No fog — black PNG edges blend into clear color, not "space"

  // Flat plate facing the camera (no world tilt)
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
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const plate = new Mesh(plateGeo, plateMat);
  plate.position.z = 0;
  scene.add(plate);

  const shipGeo = new PlaneGeometry(1, 1);
  const shipMat = new MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const ship = new Mesh(shipGeo, shipMat);
  ship.position.z = 0.01;
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
  let shipW = 0.14;
  let shipH = 0.09;

  const placeShip = (t: number) => {
    const uv = samplePath(CANAL_UV, t);
    // UV (0–1, v down from top) → plane local (origin center, y up)
    ship.position.x = (uv.x - 0.5) * plateW;
    ship.position.y = (0.5 - uv.y) * plateH;
    ship.position.z = 0.01;
  };

  const layout = () => {
    const w = parent.clientWidth || canvas.clientWidth || 1;
    const h = parent.clientHeight || canvas.clientHeight || 1;
    const aspect = w / h;

    // Cover the canvas with the square plate (like CSS background-size: cover)
    if (aspect >= 1) {
      plateW = aspect * 2;
      plateH = 2;
    } else {
      plateW = 2;
      plateH = 2 / aspect;
    }
    plate.scale.set(plateW, plateH, 1);

    // Ship ~13% of plate width — small like the mock
    shipW = plateW * 0.13;
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

    progress += dt * 0.035;
    if (progress > 1) progress = 0;

    placeShip(progress);
    // Tiny bob only — stay on the plate
    ship.position.y += Math.sin(now * 0.002) * plateH * 0.0015;

    // Optional 1–2px-scale drift (orthographic units are tiny)
    drift += dt;
    camera.position.x = Math.sin(drift * 0.12) * 0.008;
    camera.position.y = Math.cos(drift * 0.1) * 0.006;
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
    loadTexture(loader, '/scene/isthmus-path.png'),
    loadTexture(loader, '/scene/ship.png'),
  ])
    .then(([isthmusTex, shipTex]) => {
      if (disposed) {
        isthmusTex.dispose();
        shipTex.dispose();
        return;
      }
      plateMat.map = isthmusTex;
      plateMat.needsUpdate = true;
      shipMat.map = shipTex;
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
