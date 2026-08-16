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
const TERRAIN = 0x121820;
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

  // Stylized ridge blocks along the canal
  for (let i = 0; i < 14; i++) {
    const z = -28 + i * 4.2;
    const height = 2.2 + Math.sin(i * 0.7) * 1.4 + (i % 3) * 0.55;
    const depth = 3.2 + (i % 2) * 0.8;
    const width = 5.5 + Math.cos(i * 0.5) * 1.2;
    const block = new Mesh(new BoxGeometry(width, height, depth), terrainMat);
    block.position.set(sign * (6.2 + width * 0.35), height * 0.45 - 0.2, z);
    block.rotation.y = sign * 0.08 * Math.sin(i);
    group.add(block);
  }

  // Orange topographic contour lines
  const lineMat = new LineBasicMaterial({
    color: ACCENT,
    transparent: true,
    opacity: 0.55,
  });

  for (let level = 0; level < 6; level++) {
    const y = 0.4 + level * 0.85;
    const points: number[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const z = -30 + t * 60;
      const wave = Math.sin(t * Math.PI * 3 + level) * 0.7 + Math.cos(t * 8 + level * 0.4) * 0.25;
      const x = sign * (5.4 + level * 0.55 + wave + Math.abs(Math.sin(t * Math.PI)) * 1.8);
      points.push(x, y + Math.sin(t * Math.PI * 2 + level) * 0.15, z);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(points, 3));
    group.add(new Line(geo, lineMat));
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
  const edgeMat = new LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.25 });

  const makeWall = (x: number, length: number, height: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(1.1, height, length), wallMat);
    mesh.position.set(x, height / 2 - 0.15, z);
    group.add(mesh);
    const edges = new LineSegments(new EdgesGeometry(mesh.geometry), edgeMat);
    edges.position.copy(mesh.position);
    group.add(edges);
  };

  makeWall(-4.1, 52, 1.8, 0);
  makeWall(4.1, 52, 1.8, 0);

  // Lock gate posts
  const postMat = new MeshStandardMaterial({ color: 0x24303c, roughness: 0.7, metalness: 0.2 });
  for (const z of [-10, 8]) {
    for (const x of [-3.4, 3.4]) {
      const post = new Mesh(new BoxGeometry(0.35, 2.6, 0.35), postMat);
      post.position.set(x, 1.1, z);
      group.add(post);
    }
  }

  return group;
}

function createShip(): Group {
  const ship = new Group();

  const hull = new Mesh(
    new BoxGeometry(1.6, 0.55, 5.2),
    new MeshStandardMaterial({ color: HULL, roughness: 0.65, metalness: 0.25 }),
  );
  hull.position.y = 0.35;
  ship.add(hull);

  const bow = new Mesh(
    new BoxGeometry(1.4, 0.45, 1.1),
    new MeshStandardMaterial({ color: HULL, roughness: 0.65, metalness: 0.25 }),
  );
  bow.position.set(0, 0.38, -2.9);
  bow.scale.set(0.85, 1, 1);
  ship.add(bow);

  const bridge = new Mesh(
    new BoxGeometry(1.1, 0.7, 0.9),
    new MeshStandardMaterial({ color: 0x3a4450, roughness: 0.55, metalness: 0.15 }),
  );
  bridge.position.set(0, 0.95, 1.7);
  ship.add(bridge);

  const mast = new Mesh(
    new CylinderGeometry(0.04, 0.05, 1.2, 6),
    new MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.5 }),
  );
  mast.position.set(0, 1.7, 1.7);
  ship.add(mast);

  const colors = [CONTAINER_ORANGE, CONTAINER_BLUE, CONTAINER_ORANGE, CONTAINER_BLUE, CONTAINER_ORANGE];
  let zi = -1.8;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      for (let stack = 0; stack < 2; stack++) {
        const c = new Mesh(
          new BoxGeometry(0.55, 0.35, 0.85),
          new MeshStandardMaterial({
            color: colors[(row + col + stack) % colors.length],
            roughness: 0.55,
            metalness: 0.2,
          }),
        );
        c.position.set((col - 0.5) * 0.62, 0.75 + stack * 0.38, zi);
        ship.add(c);
      }
    }
    zi += 0.95;
  }

  return ship;
}

function createWater(): Mesh {
  const geo = new PlaneGeometry(9, 70, 24, 48);
  const mat = new MeshStandardMaterial({
    color: WATER,
    roughness: 0.35,
    metalness: 0.55,
    transparent: true,
    opacity: 0.92,
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
    const wing = new Mesh(new BoxGeometry(0.35, 0.02, 0.08), mat);
    wing.position.set(-6 + i * 2.2, 6.5 + (i % 2) * 0.6, -8 - i * 1.5);
    wing.rotation.z = 0.2;
    birds.add(wing);
  }
  return birds;
}

function rippleWater(water: Mesh, t: number): void {
  const pos = water.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const wave =
      Math.sin(x * 1.4 + t * 1.2) * 0.04 +
      Math.cos(y * 0.9 + t * 0.9) * 0.03 +
      Math.sin((x + y) * 0.55 + t * 1.6) * 0.02;
    pos.setZ(i, wave);
  }
  pos.needsUpdate = true;
  water.geometry.computeVertexNormals();
}

export function mountCanalScene(canvas: HTMLCanvasElement): SceneHandle {
  const reduced = prefersReducedMotion();
  const parent = canvas.parentElement ?? canvas;

  const scene = new Scene();
  scene.background = new Color(0x080b12);
  scene.fog = new Fog(0x080b12, 18, 55);

  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(-2.8, 9.5, 14);
  camera.lookAt(new Vector3(0.8, 0.2, -2));

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x080b12, 1);

  const ambient = new AmbientLight(0x6b8395, 0.55);
  scene.add(ambient);

  const key = new DirectionalLight(0xffe6c8, 1.15);
  key.position.set(-4, 14, 6);
  scene.add(key);

  const rim = new DirectionalLight(0xd48243, 0.35);
  rim.position.set(8, 6, -10);
  scene.add(rim);

  const fill = new DirectionalLight(0x4a6a80, 0.4);
  fill.position.set(2, 4, 10);
  scene.add(fill);

  scene.add(createTerrainWithContours('left'));
  scene.add(createTerrainWithContours('right'));
  scene.add(createLockWalls());

  const water = createWater();
  scene.add(water);

  const ship = createShip();
  ship.position.set(0, 0, 12);
  scene.add(ship);

  scene.add(createBirds());

  // Subtle sky haze plane
  const haze = new Mesh(
    new PlaneGeometry(80, 30),
    new MeshStandardMaterial({
      color: 0x101820,
      transparent: true,
      opacity: 0.35,
      roughness: 1,
      metalness: 0,
    }),
  );
  haze.position.set(0, 8, -28);
  scene.add(haze);

  let raf = 0;
  let running = !reduced;
  let shipZ = 12;
  let last = performance.now();
  let disposed = false;

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
      rippleWater(water, 0);
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

    shipZ -= dt * 1.15;
    if (shipZ < -14) shipZ = 14;
    ship.position.z = shipZ;
    ship.position.y = Math.sin(now * 0.0018) * 0.04;
    ship.rotation.z = Math.sin(now * 0.0012) * 0.015;
    ship.rotation.x = Math.sin(now * 0.001) * 0.01;

    rippleWater(water, now * 0.001);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(parent);
  document.addEventListener('visibilitychange', onVisibility);
  resize();

  // Static first frame immediately; animate after paint
  ship.position.z = reduced ? 0 : 12;
  rippleWater(water, 0);
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
      scene.traverse((obj) => {
        if (obj instanceof Mesh || obj instanceof LineSegments || obj instanceof Line) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    },
  };
}
