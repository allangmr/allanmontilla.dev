import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

const ACCENT = 0xd48243;
const COPPER = 0xe8954f;
const WATER = 0x0a1830;
const TERRAIN = 0x0c121a;
const HULL = 0x0d1520;
const WATERLINE = 0x8a3a28;
const CONTAINER_ORANGE = 0xc45f32;
const CONTAINER_SLATE = 0x5a7388;
const CONTAINER_GRAY = 0x6e757c;
const BRIDGE = 0xeef2f6;

type SceneHandle = {
  destroy: () => void;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Diagonal isthmus landform with copper topo + glowing canal path */
function createIsthmus(): Group {
  const group = new Group();
  const terrainMat = new MeshStandardMaterial({
    color: TERRAIN,
    roughness: 0.98,
    metalness: 0.04,
    flatShading: true,
  });

  // Build a long diagonal ridge strip (isthmus) with a carved canal valley
  const cols = 28;
  const rows = 56;
  const geo = new PlaneGeometry(22, 58, cols, rows);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Distance from diagonal canal centerline (rotated ~35°)
    const canalX = x * Math.cos(0.55) + z * Math.sin(0.55);
    const along = -x * Math.sin(0.55) + z * Math.cos(0.55);
    const valley = Math.exp(-(canalX * canalX) / 2.8) * 2.4;
    const mountains =
      Math.sin(along * 0.22) * 1.1 +
      Math.cos(x * 0.45 + z * 0.2) * 0.85 +
      Math.sin(x * 0.9) * 0.55 +
      Math.cos(z * 0.55) * 0.7;
    const edgeFalloff = Math.min(1, Math.max(0, (Math.abs(x) - 9.5) / 2));
    let y = Math.max(0.05, 1.6 + mountains * 1.35 - valley);
    y *= 1 - edgeFalloff * 0.85;
    // Flatten canal floor
    if (Math.abs(canalX) < 1.35) y = 0.02 + Math.abs(canalX) * 0.08;
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const land = new Mesh(geo, terrainMat);
  group.add(land);

  // Glowing orange canal path through the valley
  const pathMat = new MeshStandardMaterial({
    color: ACCENT,
    emissive: ACCENT,
    emissiveIntensity: 1.35,
    roughness: 0.4,
    metalness: 0.2,
    transparent: true,
    opacity: 0.85,
  });
  const path = new Mesh(new BoxGeometry(1.55, 0.04, 54), pathMat);
  path.rotation.y = -0.55;
  path.position.set(0, 0.06, 0);
  group.add(path);

  // Soft glow under path
  const glowMat = new MeshStandardMaterial({
    color: ACCENT,
    emissive: ACCENT,
    emissiveIntensity: 0.7,
    transparent: true,
    opacity: 0.25,
    roughness: 1,
  });
  const glow = new Mesh(new BoxGeometry(2.6, 0.02, 54), glowMat);
  glow.rotation.y = -0.55;
  glow.position.set(0, 0.04, 0);
  group.add(glow);

  // Copper topographic contour lines sampled across the heightfield
  const lineMat = new LineBasicMaterial({
    color: COPPER,
    transparent: true,
    opacity: 0.78,
  });
  const fineMat = new LineBasicMaterial({
    color: ACCENT,
    transparent: true,
    opacity: 0.35,
  });

  for (let level = 0; level < 9; level++) {
    const targetY = 0.35 + level * 0.42;
    const points: number[] = [];
    for (let i = 0; i <= 70; i++) {
      const t = i / 70;
      const z = -28 + t * 56;
      // Find x on contour by scanning; approximate with offset from canal
      const side = level % 2 === 0 ? 1 : -1;
      const base = 2.2 + level * 0.55 + Math.sin(t * Math.PI * 3 + level) * 0.9;
      const x = side * base + Math.cos(t * 8 + level) * 0.35;
      // Rotate into diagonal frame
      const rx = x * Math.cos(-0.55) - z * Math.sin(-0.55) * 0.15;
      const rz = z;
      const y =
        targetY +
        Math.sin(t * Math.PI * 2 + level * 0.7) * 0.12 +
        Math.abs(Math.sin(t * Math.PI)) * 0.2;
      points.push(rx, y, rz);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(points, 3));
    group.add(new Line(g, level < 5 ? lineMat : fineMat));
  }

  // Extra ridge contours hugging the mountains
  for (let k = 0; k < 6; k++) {
    const points: number[] = [];
    const side = k < 3 ? -1 : 1;
    const idx = k % 3;
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const z = -26 + t * 52;
      const x =
        side * (3.4 + idx * 1.3 + Math.sin(t * Math.PI * 2.5 + idx) * 1.2);
      const y = 0.9 + idx * 0.65 + Math.sin(t * Math.PI * 3 + k) * 0.35;
      points.push(x, y, z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(points, 3));
    group.add(new Line(g, lineMat));
  }

  return group;
}

function createWaterRibbon(): Mesh {
  // Diagonal water strip matching canal-water reference mood
  const geo = new PlaneGeometry(3.4, 56, 20, 64);
  const mat = new MeshStandardMaterial({
    color: WATER,
    roughness: 0.22,
    metalness: 0.7,
    transparent: true,
    opacity: 0.96,
    side: DoubleSide,
  });
  const water = new Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.rotation.z = -0.55;
  water.position.set(0, 0.05, 0);
  return water;
}

/** Match ship.png: navy hull, terracotta/slate/gray stacks, white stern bridge */
function createShip(): Group {
  const ship = new Group();

  const hullMat = new MeshStandardMaterial({ color: HULL, roughness: 0.55, metalness: 0.3 });
  const waterlineMat = new MeshStandardMaterial({
    color: WATERLINE,
    roughness: 0.7,
    metalness: 0.15,
  });

  const hull = new Mesh(new BoxGeometry(1.7, 0.7, 6.4), hullMat);
  hull.position.y = 0.42;
  ship.add(hull);

  // Tapered bow
  const bow = new Mesh(new BoxGeometry(1.35, 0.55, 1.4), hullMat);
  bow.position.set(0, 0.4, -3.6);
  bow.scale.set(0.75, 1, 1);
  ship.add(bow);

  // Anti-fouling strip at waterline
  const stripe = new Mesh(new BoxGeometry(1.72, 0.12, 6.5), waterlineMat);
  stripe.position.y = 0.12;
  ship.add(stripe);

  // Forecastle deck detail
  const forecastle = new Mesh(
    new BoxGeometry(1.2, 0.18, 0.9),
    new MeshStandardMaterial({ color: 0x2a333c, roughness: 0.65, metalness: 0.2 }),
  );
  forecastle.position.set(0, 0.82, -2.9);
  ship.add(forecastle);

  // Containers — terracotta, slate, gray, 4 high, checkered
  const palette = [CONTAINER_ORANGE, CONTAINER_SLATE, CONTAINER_GRAY, CONTAINER_ORANGE, CONTAINER_SLATE];
  let zi = -2.0;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 2; col++) {
      for (let stack = 0; stack < 4; stack++) {
        const color = palette[(row + col * 2 + stack) % palette.length];
        const c = new Mesh(
          new BoxGeometry(0.58, 0.32, 0.78),
          new MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.18 }),
        );
        c.position.set((col - 0.5) * 0.68, 0.88 + stack * 0.34, zi);
        ship.add(c);
      }
    }
    zi += 0.82;
  }

  // White multi-deck bridge at STERN
  const bridgeMat = new MeshStandardMaterial({
    color: BRIDGE,
    emissive: 0x3a4048,
    emissiveIntensity: 0.35,
    roughness: 0.4,
    metalness: 0.08,
  });
  const bridgeBase = new Mesh(new BoxGeometry(1.45, 0.6, 1.25), bridgeMat);
  bridgeBase.position.set(0, 1.05, 2.6);
  ship.add(bridgeBase);

  const bridgeMid = new Mesh(new BoxGeometry(1.25, 0.5, 1.0), bridgeMat);
  bridgeMid.position.set(0, 1.58, 2.6);
  ship.add(bridgeMid);

  const bridgeTop = new Mesh(new BoxGeometry(1.05, 0.42, 0.8), bridgeMat);
  bridgeTop.position.set(0, 2.02, 2.6);
  ship.add(bridgeTop);

  const mast = new Mesh(
    new CylinderGeometry(0.035, 0.045, 1.1, 6),
    new MeshStandardMaterial({ color: 0xd0d6dc, roughness: 0.35, metalness: 0.55 }),
  );
  mast.position.set(0, 2.65, 2.6);
  ship.add(mast);

  const radar = new Mesh(new BoxGeometry(0.35, 0.08, 0.2), bridgeMat);
  radar.position.set(0, 3.2, 2.6);
  ship.add(radar);

  // Dark windows
  const windowMat = new MeshStandardMaterial({ color: 0x1a222c, roughness: 0.3, metalness: 0.4 });
  for (const y of [1.1, 1.58, 2.0]) {
    const w = new Mesh(new BoxGeometry(1.0, 0.1, 0.08), windowMat);
    w.position.set(0, y, 2.0);
    ship.add(w);
  }

  ship.scale.setScalar(1.2);
  return ship;
}

function rippleWater(water: Mesh, t: number, updateNormals: boolean): void {
  const pos = water.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Dense ripple field like canal-water.png
    const wave =
      Math.sin(x * 3.2 + t * 1.8) * 0.028 +
      Math.cos(y * 2.4 + t * 1.4) * 0.022 +
      Math.sin((x + y) * 1.6 + t * 2.1) * 0.016 +
      Math.sin(x * 7.0 + y * 3.0 + t * 2.6) * 0.008;
    pos.setZ(i, wave);
  }
  pos.needsUpdate = true;
  if (updateNormals) water.geometry.computeVertexNormals();
}

export function mountCanalScene(canvas: HTMLCanvasElement): SceneHandle {
  const reduced = prefersReducedMotion();
  const parent = canvas.parentElement ?? canvas;

  const scene = new Scene();
  scene.background = new Color(0x080b12);
  scene.fog = new Fog(0x080b12, 14, 42);

  const camera = new PerspectiveCamera(36, 1, 0.1, 100);
  // High-angle cinematic view along the diagonal canal
  camera.position.set(-8.5, 14.5, 12);
  camera.lookAt(new Vector3(1.2, 0.3, -2));

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x080b12, 1);

  scene.add(new AmbientLight(0x6b8395, 0.45));

  const key = new DirectionalLight(0xffe8d0, 1.15);
  key.position.set(-6, 18, 10);
  scene.add(key);

  const rim = new DirectionalLight(0xd48243, 0.55);
  rim.position.set(10, 8, -8);
  scene.add(rim);

  const fill = new DirectionalLight(0x3d5a70, 0.35);
  fill.position.set(4, 6, 14);
  scene.add(fill);

  // Cool shimmer light for water peaks
  const shimmer = new DirectionalLight(0xa8c4d8, 0.4);
  shimmer.position.set(2, 12, -4);
  scene.add(shimmer);

  const isthmus = createIsthmus();
  scene.add(isthmus);

  const water = createWaterRibbon();
  scene.add(water);

  const ship = createShip();
  // Align ship with diagonal canal
  ship.rotation.y = -0.55;
  ship.position.set(0, 0.08, 10);
  scene.add(ship);

  let raf = 0;
  let running = !reduced;
  let shipAlong = 12;
  let last = performance.now();
  let disposed = false;
  let frame = 0;

  const placeShip = (along: number) => {
    // Move along diagonal canal axis
    const x = Math.sin(0.55) * along * 0.15;
    const z = along;
    ship.position.set(x, 0.08 + Math.sin(along * 0.4) * 0.02, z);
  };

  const resize = () => {
    const w = parent.clientWidth || canvas.clientWidth || 1;
    const h = parent.clientHeight || canvas.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };

  const onVisibility = () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!reduced && !disposed) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const onMotionChange = (e: MediaQueryListEvent) => {
    if (e.matches) {
      running = false;
      cancelAnimationFrame(raf);
      placeShip(0);
      rippleWater(water, 0, true);
      renderer.render(scene, camera);
    } else if (!document.hidden && !disposed) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener('change', onMotionChange);

  const tick = (now: number) => {
    if (!running || disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame += 1;

    shipAlong -= dt * 1.0;
    if (shipAlong < -16) shipAlong = 16;
    placeShip(shipAlong);
    ship.position.y = 0.08 + Math.sin(now * 0.0018) * 0.04;
    ship.rotation.z = Math.sin(now * 0.0011) * 0.015;
    ship.rotation.x = Math.sin(now * 0.0009) * 0.01;

    rippleWater(water, now * 0.001, frame % 2 === 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(parent);
  document.addEventListener('visibilitychange', onVisibility);
  resize();

  placeShip(reduced ? 0 : 10);
  rippleWater(water, 0, true);
  renderer.render(scene, camera);

  if (!reduced) {
    requestAnimationFrame(() => {
      if (disposed) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    });
  }

  return {
    destroy() {
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotionChange);
      renderer.dispose();
      const seen = new Set<object>();
      scene.traverse((obj) => {
        if (obj instanceof Mesh || obj instanceof Line) {
          obj.geometry.dispose();
          const mat = obj.material;
          const mats = Array.isArray(mat) ? mat : [mat];
          for (const m of mats) {
            if (!seen.has(m)) {
              seen.add(m);
              m.dispose();
            }
          }
        }
      });
    },
  };
}
