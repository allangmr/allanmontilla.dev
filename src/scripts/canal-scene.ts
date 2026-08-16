import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

const ACCENT = 0xd48243;
const WATER = 0x0a1520;
const TERRAIN = 0x10161e;
const CONTAINER_ORANGE = 0xd48243;
const CONTAINER_BLUE = 0x3d6a8a;
const HULL = 0x2a3038;

type SceneHandle = {
  destroy: () => void;
};

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function createTerrainWithContours(side: 'left' | 'right'): Group {
  const group = new Group();
  const sign = side === 'left' ? -1 : 1;

  const terrainMat = new MeshStandardMaterial({
    color: TERRAIN,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true,
  });

  for (let i = 0; i < 16; i++) {
    const z = -32 + i * 4;
    const height = 2.6 + Math.sin(i * 0.7) * 1.6 + (i % 3) * 0.65;
    const depth = 3.4 + (i % 2) * 0.9;
    const width = 6.2 + Math.cos(i * 0.5) * 1.4;
    const block = new Mesh(new BoxGeometry(width, height, depth), terrainMat);
    block.position.set(sign * (5.8 + width * 0.32), height * 0.42 - 0.15, z);
    block.rotation.y = sign * 0.08 * Math.sin(i);
    group.add(block);
  }

  const lineMat = new LineBasicMaterial({
    color: 0xe8954f,
    transparent: true,
    opacity: 0.92,
  });

  for (let level = 0; level < 8; level++) {
    const y = 0.28 + level * 0.72;
    const points: number[] = [];
    for (let i = 0; i <= 56; i++) {
      const t = i / 56;
      const z = -34 + t * 68;
      const wave =
        Math.sin(t * Math.PI * 3.2 + level) * 0.85 +
        Math.cos(t * 9 + level * 0.45) * 0.3;
      const x =
        sign * (4.7 + level * 0.58 + wave + Math.abs(Math.sin(t * Math.PI)) * 2.1);
      points.push(x, y + Math.sin(t * Math.PI * 2 + level) * 0.18, z);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(points, 3));
    group.add(new Line(geo, lineMat));
  }

  // Secondary finer contour layer
  const fineMat = new LineBasicMaterial({
    color: ACCENT,
    transparent: true,
    opacity: 0.45,
  });
  for (let level = 0; level < 5; level++) {
    const y = 0.55 + level * 1.05;
    const points: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const z = -30 + t * 60;
      const x =
        sign *
        (6.2 + level * 0.9 + Math.sin(t * Math.PI * 4 + level * 1.3) * 1.1);
      points.push(x, y, z);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(points, 3));
    group.add(new Line(geo, fineMat));
  }

  return group;
}

function createLockWalls(): Group {
  const group = new Group();
  const wallMat = new MeshStandardMaterial({
    color: 0x1a222c,
    roughness: 0.85,
    metalness: 0.1,
  });
  const edgeMat = new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.28 });

  const makeWall = (x: number, length: number, height: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(1.15, height, length), wallMat);
    mesh.position.set(x, height / 2 - 0.15, z);
    group.add(mesh);
    const edges = new LineSegments(new EdgesGeometry(mesh.geometry), edgeMat);
    edges.position.copy(mesh.position);
    group.add(edges);
  };

  makeWall(-3.85, 56, 2.0, 0);
  makeWall(3.85, 56, 2.0, 0);

  const postMat = new MeshStandardMaterial({ color: 0x24303c, roughness: 0.7, metalness: 0.2 });
  for (const z of [-12, -2, 10]) {
    for (const x of [-3.2, 3.2]) {
      const post = new Mesh(new BoxGeometry(0.38, 2.8, 0.38), postMat);
      post.position.set(x, 1.2, z);
      group.add(post);
    }
  }

  return group;
}

function createShip(): Group {
  const ship = new Group();

  const hull = new Mesh(
    new BoxGeometry(1.85, 0.62, 6.0),
    new MeshStandardMaterial({ color: HULL, roughness: 0.65, metalness: 0.25 }),
  );
  hull.position.y = 0.38;
  ship.add(hull);

  const bow = new Mesh(
    new BoxGeometry(1.55, 0.5, 1.25),
    new MeshStandardMaterial({ color: HULL, roughness: 0.65, metalness: 0.25 }),
  );
  bow.position.set(0, 0.4, -3.35);
  bow.scale.set(0.82, 1, 1);
  ship.add(bow);

  const bridge = new Mesh(
    new BoxGeometry(1.25, 0.85, 1.05),
    new MeshStandardMaterial({ color: 0x3a4450, roughness: 0.55, metalness: 0.15 }),
  );
  bridge.position.set(0, 1.05, 2.0);
  ship.add(bridge);

  const mast = new Mesh(
    new CylinderGeometry(0.045, 0.055, 1.35, 6),
    new MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.5 }),
  );
  mast.position.set(0, 1.85, 2.0);
  ship.add(mast);

  const colors = [CONTAINER_ORANGE, CONTAINER_BLUE, CONTAINER_ORANGE, CONTAINER_BLUE, CONTAINER_ORANGE];
  let zi = -2.1;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 2; col++) {
      for (let stack = 0; stack < 2; stack++) {
        const c = new Mesh(
          new BoxGeometry(0.62, 0.38, 0.9),
          new MeshStandardMaterial({
            color: colors[(row + col + stack) % colors.length],
            roughness: 0.55,
            metalness: 0.2,
          }),
        );
        c.position.set((col - 0.5) * 0.7, 0.82 + stack * 0.4, zi);
        ship.add(c);
      }
    }
    zi += 0.95;
  }

  ship.scale.setScalar(1.15);
  return ship;
}

function createWater(): Mesh {
  const geo = new PlaneGeometry(8.2, 72, 16, 32);
  const mat = new MeshStandardMaterial({
    color: WATER,
    roughness: 0.28,
    metalness: 0.62,
    transparent: true,
    opacity: 0.94,
    side: DoubleSide,
  });
  const water = new Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.02;
  return water;
}

function createBirds(): Group {
  const birds = new Group();
  const mat = new MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.8, metalness: 0 });
  for (let i = 0; i < 5; i++) {
    const wing = new Mesh(new BoxGeometry(0.4, 0.02, 0.09), mat);
    wing.position.set(-7 + i * 2.4, 7.2 + (i % 2) * 0.7, -10 - i * 1.6);
    wing.rotation.z = 0.25;
    birds.add(wing);
  }
  return birds;
}

function rippleWater(water: Mesh, t: number, updateNormals: boolean): void {
  const pos = water.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const wave =
      Math.sin(x * 1.35 + t * 1.15) * 0.045 +
      Math.cos(y * 0.85 + t * 0.85) * 0.03 +
      Math.sin((x + y) * 0.5 + t * 1.5) * 0.02;
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
  scene.fog = new Fog(0x080b12, 16, 48);

  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  // Cinematic high-angle looking along the canal
  camera.position.set(-1.6, 11.2, 16.5);
  camera.lookAt(new Vector3(0.4, 0.4, -1.5));

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x080b12, 1);

  scene.add(new AmbientLight(0x6b8395, 0.6));

  const key = new DirectionalLight(0xffe6c8, 1.25);
  key.position.set(-5, 16, 8);
  scene.add(key);

  const rim = new DirectionalLight(0xd48243, 0.42);
  rim.position.set(10, 7, -12);
  scene.add(rim);

  const fill = new DirectionalLight(0x4a6a80, 0.45);
  fill.position.set(3, 5, 12);
  scene.add(fill);

  scene.add(createTerrainWithContours('left'));
  scene.add(createTerrainWithContours('right'));
  scene.add(createLockWalls());

  const water = createWater();
  scene.add(water);

  const ship = createShip();
  ship.position.set(0, 0, 10);
  scene.add(ship);

  scene.add(createBirds());

  const haze = new Mesh(
    new PlaneGeometry(90, 34),
    new MeshStandardMaterial({
      color: 0x101820,
      transparent: true,
      opacity: 0.4,
      roughness: 1,
      metalness: 0,
    }),
  );
  haze.position.set(0, 9, -30);
  scene.add(haze);

  let raf = 0;
  let running = !reduced;
  let shipZ = 10;
  let last = performance.now();
  let disposed = false;
  let frame = 0;

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
      ship.position.z = 0;
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

    shipZ -= dt * 1.05;
    if (shipZ < -16) shipZ = 16;
    ship.position.z = shipZ;
    ship.position.y = Math.sin(now * 0.0018) * 0.045;
    ship.rotation.z = Math.sin(now * 0.0012) * 0.018;
    ship.rotation.x = Math.sin(now * 0.001) * 0.012;

    // Normals every other frame keeps iGPU happier
    rippleWater(water, now * 0.001, frame % 2 === 0);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(parent);
  document.addEventListener('visibilitychange', onVisibility);
  resize();

  ship.position.z = reduced ? 0 : 10;
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
        if (obj instanceof Mesh || obj instanceof LineSegments || obj instanceof Line) {
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
