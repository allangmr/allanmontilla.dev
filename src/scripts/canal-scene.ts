import {
  AmbientLight,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';

const SCENE_BG = 0x0f1821;
const COFFEE = 0x9a7766;

type SceneHandle = {
  destroy: () => void;
};

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

function makeSpritePlane(
  texture: Texture,
  width: number,
  height: number,
  opts: { opacity?: number; depthWrite?: boolean } = {},
): Mesh {
  const mat = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? false,
    toneMapped: false,
  });
  const mesh = new Mesh(new PlaneGeometry(width, height), mat);
  return mesh;
}

/** Point along the glowing canal (local plane coords, z up toward camera). */
function canalPoint(t: number, planeW: number, planeH: number): Vector3 {
  // Path runs bottom-left → top-right on the isthmus plate, slightly curved
  const u = t;
  const x = (-0.34 + u * 0.7) * planeW;
  const y = (-0.32 + u * 0.68) * planeH + Math.sin(u * Math.PI) * planeH * 0.035;
  return new Vector3(x, y, 0.08);
}

export function mountCanalScene(canvas: HTMLCanvasElement): SceneHandle {
  const reduced = prefersReducedMotion();
  const parent = canvas.parentElement ?? canvas;

  const scene = new Scene();
  scene.background = new Color(SCENE_BG);
  scene.fog = new FogExp2(SCENE_BG, 0.028);

  const camera = new PerspectiveCamera(32, 1, 0.1, 80);
  // Locked cinematic high-angle — matches design-ref composition
  const camHome = new Vector3(0.15, -6.2, 9.4);
  camera.position.copy(camHome);
  camera.lookAt(new Vector3(0.2, 0.4, 0));

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(SCENE_BG, 1);

  scene.add(new AmbientLight(0x597386, 0.55));
  const key = new DirectionalLight(0xd9d7d7, 0.65);
  key.position.set(-4, 6, 10);
  scene.add(key);
  const rim = new DirectionalLight(COFFEE, 0.35);
  rim.position.set(5, -2, 6);
  scene.add(rim);

  const root = new Group();
  // Slight tilt so plates read as a 3D diorama, not a flat poster
  root.rotation.x = -0.72;
  root.rotation.z = 0.08;
  scene.add(root);

  const planeW = 14;
  const planeH = 14;

  let ship: Mesh | null = null;
  let disposed = false;
  let raf = 0;
  let running = false;
  let last = performance.now();
  let progress = reduced ? 0.45 : 0.08;
  let drift = 0;

  const loader = new TextureLoader();

  const boot = async () => {
    const [isthmusTex, waterTex, shipTex] = await Promise.all([
      loadTexture(loader, '/scene/isthmus-path.png'),
      loadTexture(loader, '/scene/canal-water.png'),
      loadTexture(loader, '/scene/ship.png'),
    ]);
    if (disposed) {
      isthmusTex.dispose();
      waterTex.dispose();
      shipTex.dispose();
      return;
    }

    const isthmus = makeSpritePlane(isthmusTex, planeW, planeH, { depthWrite: true });
    isthmus.position.z = 0;
    root.add(isthmus);

    // Soft coffee bloom under the path
    const glow = new Mesh(
      new PlaneGeometry(planeW * 0.12, planeH * 0.85),
      new MeshBasicMaterial({
        color: COFFEE,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }),
    );
    glow.position.set(0.15, 0.05, 0.02);
    glow.rotation.z = -0.78;
    root.add(glow);

    const water = makeSpritePlane(waterTex, planeW * 0.92, planeH * 0.92, { opacity: 0.92 });
    water.position.z = 0.04;
    root.add(water);

    // Ship aspect ~1.5:1
    const shipW = 2.85;
    const shipH = shipW * (933 / 1400);
    ship = makeSpritePlane(shipTex, shipW, shipH, { depthWrite: true });
    // Keep isometric read: slight counter-tilt so the sprite faces camera
    ship.rotation.x = 0.55;
    ship.rotation.z = -0.55;
    root.add(ship);

    const placeShip = (t: number) => {
      if (!ship) return;
      const p = canalPoint(t, planeW, planeH);
      ship.position.copy(p);
      ship.position.z = 0.12;
    };

    placeShip(progress);
    renderer.render(scene, camera);

    if (!reduced) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const tick = (now: number) => {
    if (!running || disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    progress += dt * 0.028;
    if (progress > 0.92) progress = 0.08;

    if (ship) {
      const p = canalPoint(progress, planeW, planeH);
      ship.position.copy(p);
      ship.position.z = 0.12 + Math.sin(now * 0.0015) * 0.01;
    }

    // Subtle locked-camera drift only
    drift += dt;
    camera.position.x = camHome.x + Math.sin(drift * 0.18) * 0.12;
    camera.position.y = camHome.y + Math.cos(drift * 0.14) * 0.08;
    camera.lookAt(0.2, 0.4, 0);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };

  const resize = () => {
    const w = parent.clientWidth || canvas.clientWidth || 1;
    const h = parent.clientHeight || canvas.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (!running) renderer.render(scene, camera);
  };

  const onVisibility = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!reduced && !disposed && ship) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const onMotionChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      running = false;
      cancelAnimationFrame(raf);
      progress = 0.45;
      if (ship) {
        const p = canalPoint(progress, planeW, planeH);
        ship.position.copy(p);
        ship.position.z = 0.12;
      }
      renderer.render(scene, camera);
    } else if (!document.hidden && !disposed && ship) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', onMotionChange);

  const ro = new ResizeObserver(resize);
  ro.observe(parent);
  document.addEventListener('visibilitychange', onVisibility);
  resize();
  renderer.render(scene, camera);

  void boot().catch(() => {
    // Fail soft — leave solid bg if assets fail
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
      scene.traverse((obj) => {
        if (obj instanceof Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          } else {
            if (mat.map) mat.map.dispose();
            mat.dispose();
          }
        }
      });
    },
  };
}
