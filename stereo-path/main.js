import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const PALETTE = {
  cream: 0xfbf3ea,
  yellow: 0xfbcd0f,
  orange: 0xf5621f,
  pink: 0xfbb1bd,
  cyan: 0x21aee6,
  magenta: 0xf34589,
  green: 0x0ba053,
  blue: 0x0959ad,
  navy: 0x1a2243,
  white: 0xfffdf8,
};

const MODE_LABELS = {
  geometric: '生活几何',
  stripes: '黑白条纹',
  checker: '黑白格纹',
  redgreen: '红绿格纹',
};

const dom = {
  root: document.querySelector('#webgl-root'),
  landing: document.querySelector('#landing'),
  hud: document.querySelector('#desktop-hud'),
  loading: document.querySelector('#loading'),
  modeCards: [...document.querySelectorAll('.mode-card')],
  speedRange: document.querySelector('#speed-range'),
  speedOutput: document.querySelector('#speed-output'),
  inGameSpeedRange: document.querySelector('#in-game-speed'),
  inGameSpeedOutput: document.querySelector('#in-game-speed-output'),
  movementStatus: document.querySelector('#movement-status'),
  reducedMotion: document.querySelector('#reduced-motion'),
  startDesktop: document.querySelector('#start-desktop'),
  vrSlot: document.querySelector('#vr-slot'),
  inGameMode: document.querySelector('#in-game-mode'),
  motionButton: document.querySelector('#motion-button'),
  pauseButton: document.querySelector('#pause-button'),
  pausePanel: document.querySelector('#pause-panel'),
  resumeButton: document.querySelector('#resume-button'),
  restartButton: document.querySelector('#restart-button'),
  leftButton: document.querySelector('#left-button'),
  rightButton: document.querySelector('#right-button'),
  choicePrompt: document.querySelector('#choice-prompt'),
  progressLabel: document.querySelector('#progress-label'),
  progressBar: document.querySelector('#progress-bar'),
  mapCanvas: document.querySelector('#map-canvas'),
  resultPanel: document.querySelector('#result-panel'),
  resultTime: document.querySelector('#result-time'),
  resultErrors: document.querySelector('#result-errors'),
  resultPauses: document.querySelector('#result-pauses'),
  resultMode: document.querySelector('#result-mode'),
  playAgain: document.querySelector('#play-again'),
  toast: document.querySelector('#toast'),
};

const state = {
  backgroundMode: 'geometric',
  reducedMotion: false,
  speed: 1.8,
  started: false,
  paused: false,
  awaitingChoice: false,
  completed: false,
  currentSegment: 0,
  wrongChoices: 0,
  pauseCount: 0,
  elapsed: 0,
  taskStartedAt: 0,
  choices: [],
  turnAnimation: null,
  toastTimer: null,
};

const ROUTE_NODES = [
  // 低层起点：先建立稳定的平面移动感
  new THREE.Vector3(-18, 0.0, 12),
  new THREE.Vector3(-4, 0.0, 12),
  new THREE.Vector3(-4, 0.0, -24),
  // 缓坡抬升至高架层
  new THREE.Vector3(-14, 2.4, -30),
  new THREE.Vector3(-18, 4.1, -32),
  // 高架斜桥从低层路径上方穿过，形成真正的上下交叉
  new THREE.Vector3(12, 4.1, -4),
  // 下降进入中层平台
  new THREE.Vector3(18, 2.0, -12),
  new THREE.Vector3(18, 0.2, 5),
  // 下沉至低层隧道
  new THREE.Vector3(8, -1.45, -4),
  new THREE.Vector3(8, -1.45, 12),
  // 最后一段重新抬升至出口
  new THREE.Vector3(22, 1.7, 12),
];
let routeTurns = [];
const TOTAL_DECISIONS = ROUTE_NODES.length - 2;

let scene;
let camera;
let renderer;
let clock;
let playerRig;
let environment;
let mazeRoot;
let segments = [];
let junctions = [];
let routePoints = [];
let currentSpeed = 0;
let mapTexture;
let mapCanvas3D;
let mapContext3D;
let mapMesh;
let hudTexture;
let hudCanvas3D;
let hudContext3D;
let hudMesh;
let controllerRays = [];
let handTrackers = [];
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

init().catch((error) => {
  console.error(error);
  dom.loading.textContent = '无法启动 3D 场景，请确认浏览器支持 WebGL。';
});

async function init() {
  setupThree();
  buildEnvironment();
  buildMaze();
  buildSpatialHUD();
  setupXRInputs();
  setupUI();
  setSpeed(state.speed);
  updateBackgroundMode(state.backgroundMode);
  resetGame(false);
  renderer.setAnimationLoop(render);
  dom.loading.classList.add('hidden');
}

function setupThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.cream);
  scene.fog = new THREE.Fog(PALETTE.cream, 12, 58);

  camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.05, 120);
  camera.position.set(0, 1.62, 0);

  playerRig = new THREE.Group();
  playerRig.name = 'PlayerRig';
  playerRig.add(camera);
  scene.add(playerRig);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  dom.root.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  const ambient = new THREE.HemisphereLight(0xffffff, PALETTE.pink, 2.2);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(5, 10, 7);
  scene.add(key);

  const vrButton = VRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'hand-tracking'],
  });
  vrButton.id = 'vr-button';
  vrButton.textContent = '进入 Vision Pro 沉浸模式';
  dom.vrSlot.appendChild(vrButton);

  renderer.xr.addEventListener('sessionstart', () => {
    startGame();
    dom.hud.classList.add('hidden');
    showToast('左手捏合选择左边，右手捏合选择右边');
  });

  renderer.xr.addEventListener('sessionend', () => {
    if (state.started && !state.completed) dom.hud.classList.remove('hidden');
  });

  window.addEventListener('resize', onResize);
}

function buildEnvironment() {
  const geometry = new THREE.BoxGeometry(110, 70, 110);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uMode: { value: 0 },
      uMotion: { value: 1 },
      uSpeed: { value: 1.8 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      uniform float uTime;
      uniform float uMode;
      uniform float uMotion;
      uniform float uSpeed;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      void main() {
        vec2 uv = vUv;
        float t = uTime * uMotion * (0.45 + uSpeed * 0.42);
        vec3 cream = vec3(0.984, 0.953, 0.918);
        vec3 navy = vec3(0.102, 0.133, 0.263);
        vec3 yellow = vec3(0.984, 0.804, 0.059);
        vec3 orange = vec3(0.961, 0.384, 0.122);
        vec3 pink = vec3(0.984, 0.694, 0.741);
        vec3 cyan = vec3(0.129, 0.682, 0.902);
        vec3 magenta = vec3(0.953, 0.271, 0.537);
        vec3 green = vec3(0.043, 0.627, 0.325);
        vec3 blue = vec3(0.035, 0.349, 0.678);
        vec3 color = cream;

        if (uMode < 0.5) {
          vec2 p = uv * vec2(7.0, 5.0);
          p.x += t * 0.045;
          vec2 cell = floor(p);
          vec2 f = fract(p);
          float r = hash21(cell);
          color = r < 0.14 ? yellow : r < 0.28 ? orange : r < 0.42 ? pink : r < 0.56 ? cyan : r < 0.70 ? magenta : r < 0.84 ? green : blue;
          float circle = step(length(f - vec2(0.5)), 0.31);
          float stripe = step(0.62, fract((f.x + f.y) * 4.0));
          if (mod(cell.x + cell.y, 3.0) < 1.0) color = mix(cream, color, circle);
          if (mod(cell.x + cell.y, 4.0) < 1.0) color = mix(color, navy, stripe * 0.22);
        } else if (uMode < 1.5) {
          float stripe = step(0.5, fract((uv.x + t * 0.026) * 14.0));
          color = mix(cream, navy, stripe);
        } else if (uMode < 2.5) {
          vec2 p = (uv + vec2(t * 0.018, t * 0.010)) * vec2(11.0, 8.0);
          float check = mod(floor(p.x) + floor(p.y), 2.0);
          color = mix(cream, navy, check);
        } else {
          vec2 p = (uv + vec2(t * 0.014, t * 0.008)) * vec2(10.0, 7.0);
          float check = mod(floor(p.x) + floor(p.y), 2.0);
          color = mix(vec3(0.07, 0.54, 0.29), vec3(0.88, 0.26, 0.16), check);
          color = mix(color, cream, 0.10);
        }

        float vignette = smoothstep(1.0, 0.12, distance(uv, vec2(0.5)));
        color = mix(color * 0.72, color, vignette * 0.7 + 0.3);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  environment = new THREE.Mesh(geometry, material);
  environment.position.y = 4;
  scene.add(environment);

  // 低位参照平面：高架、坡道和下沉隧道因此更容易被感知为不同高度。
  const groundTexture = createGeometricTexture(909, 'floor');
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(10, 10);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(78, 78),
    new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.92, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3.25;
  ground.receiveShadow = false;
  scene.add(ground);
}

function buildMaze() {
  if (mazeRoot) scene.remove(mazeRoot);
  mazeRoot = new THREE.Group();
  mazeRoot.name = 'Maze';
  scene.add(mazeRoot);

  segments = [];
  junctions = [];
  routePoints = ROUTE_NODES.map((point) => point.clone());
  routeTurns = [];

  const corridorWidth = 3.8;

  for (let i = 0; i < ROUTE_NODES.length - 1; i += 1) {
    const start = ROUTE_NODES[i].clone();
    const end = ROUTE_NODES[i + 1].clone();
    const moveVec = end.clone().sub(start);
    const dir = moveVec.clone().normalize();
    const horizontalDir = new THREE.Vector3(moveVec.x, 0, moveVec.z).normalize();
    const yaw = yawFromDirection(horizontalDir);
    const pitch = Math.atan2(moveVec.y, Math.hypot(moveVec.x, moveVec.z));
    const segment = {
      start: start.clone(),
      end: end.clone(),
      dir,
      yaw,
      pitch,
      index: i,
      width: corridorWidth,
      length: start.distanceTo(end),
    };
    segments.push(segment);
    createCorridorSegment(segment, corridorWidth, i);

    if (i < ROUTE_NODES.length - 2) {
      const nextVec = ROUTE_NODES[i + 2].clone().sub(ROUTE_NODES[i + 1]);
      const nextHorizontal = new THREE.Vector3(nextVec.x, 0, nextVec.z).normalize();
      const crossY = horizontalDir.clone().cross(nextHorizontal).y;
      const turn = crossY >= 0 ? 'left' : 'right';
      const angle = Math.max(THREE.MathUtils.degToRad(50), horizontalDir.angleTo(nextHorizontal));
      routeTurns.push(turn);
      const junction = createJunction(end, yaw, turn, i, corridorWidth, angle);
      junctions.push(junction);
    }
  }

  createExit(segments.at(-1).end, segments.at(-1).yaw);
}

function createCorridorSegment(segment, width, seed) {
  const length = segment.start.distanceTo(segment.end);
  const center = segment.start.clone().add(segment.end).multiplyScalar(0.5);
  const group = new THREE.Group();
  group.position.copy(center);
  group.rotation.order = 'YXZ';
  group.rotation.y = segment.yaw;
  group.rotation.x = -segment.pitch;
  mazeRoot.add(group);

  const floorTexture = createGeometricTexture(seed + 100, 'floor');
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.12, length),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.75, metalness: 0.0 })
  );
  floor.position.y = -0.08;
  group.add(floor);

  const corridorAverageY = (segment.start.y + segment.end.y) * 0.5;
  const wallHeight = corridorAverageY > 2.6 ? 0.72 : corridorAverageY < -0.65 ? 2.5 : 2.75;
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.navy });
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, length), edgeMaterial);
    edge.position.set(side * (width / 2 - 0.05), 0.03, 0);
    group.add(edge);

    const wallTexture = createGeometricTexture(seed * 2 + (side > 0 ? 1 : 0), 'wall');
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    wallTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, wallHeight, length),
      new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.72, metalness: 0.0 })
    );
    wall.position.set(side * width / 2, wallHeight / 2, 0);
    wall.material.map.wrapS = wall.material.map.wrapT = THREE.RepeatWrapping;
    wall.material.map.repeat.set(Math.max(1, length / 3.2), 1);
    group.add(wall);
  }

  for (let z = -length / 2 + 1.2; z < length / 2; z += 2.35) {
    const tile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.23, 0.04, 40),
      new THREE.MeshBasicMaterial({ color: seed % 2 === 0 ? PALETTE.cyan : PALETTE.yellow })
    );
    tile.rotation.x = Math.PI / 2;
    tile.position.set(0, 0.024, z);
    group.add(tile);
  }

  if (segment.index % 2 === 1) {
    const frame = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width / 2, 2.18, -length / 2 + 0.6),
        new THREE.Vector3(0, 2.5, 0),
        new THREE.Vector3(width / 2, 2.18, length / 2 - 0.6),
      ]),
      new THREE.LineBasicMaterial({ color: PALETTE.navy })
    );
    group.add(frame);
  }

  addSpatialPathStructure(group, segment, width, length, seed);
}

function addSpatialPathStructure(group, segment, width, length, seed) {
  const averageY = (segment.start.y + segment.end.y) * 0.5;
  const rise = segment.end.y - segment.start.y;
  const isElevated = averageY > 2.6;
  const isTunnel = averageY < -0.65;
  const isRamp = Math.abs(rise) > 0.9;

  if (isElevated && !isRamp) addBridgeStructure(group, width, length, averageY, seed);
  if (isTunnel) addTunnelStructure(group, width, length, seed);
  if (isRamp) addRampMarkers(group, width, length, rise, seed);
}

function addBridgeStructure(group, width, length, averageY, seed) {
  const navy = new THREE.MeshStandardMaterial({ color: PALETTE.navy, roughness: 0.48 });
  const accent = new THREE.MeshStandardMaterial({
    color: seed % 2 === 0 ? PALETTE.orange : PALETTE.green,
    roughness: 0.55,
  });

  // 细护栏代替高实体墙，让使用者能感知高度但不会被复杂景物遮挡。
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, length), navy);
    rail.position.set(side * (width / 2 - 0.14), 1.55, 0);
    group.add(rail);

    for (let z = -length / 2 + 0.7; z <= length / 2 - 0.7; z += 2.4) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), navy);
      post.position.set(side * (width / 2 - 0.14), 0.8, z);
      group.add(post);
    }
  }

  // 高架桥墩一直落到低位参照面，强化上下层关系。
  const supportHeight = Math.max(1.2, averageY + 3.15);
  for (let z = -length / 2 + 1.4; z < length / 2; z += 4.6) {
    for (const x of [-width * 0.32, width * 0.32]) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.24, supportHeight, 0.24), accent);
      support.position.set(x, -supportHeight / 2 - 0.08, z);
      group.add(support);
    }
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.20, 0.24), navy);
    crossBeam.position.set(0, -0.34, z);
    group.add(crossBeam);
  }

  // 远处可见的悬浮圆环，为高架路段提供视差参照。
  for (let z = -length / 2 + 2.0; z < length / 2; z += 5.2) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.08, 16, 42),
      new THREE.MeshBasicMaterial({ color: seed % 2 === 0 ? PALETTE.cyan : PALETTE.yellow })
    );
    ring.position.set(0, 2.25, z);
    group.add(ring);
  }
}

function addTunnelStructure(group, width, length, seed) {
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: seed % 2 === 0 ? PALETTE.blue : PALETTE.navy,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.12, length), ceilingMaterial);
  ceiling.position.y = 2.52;
  group.add(ceiling);

  // 大间距拱框不会产生高频闪烁，同时让隧道具有明确纵深。
  for (let z = -length / 2 + 0.8; z < length / 2; z += 2.8) {
    const arch = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: z % 5.6 < 2.8 ? PALETTE.yellow : PALETTE.magenta });
    const top = new THREE.Mesh(new THREE.BoxGeometry(width + 0.28, 0.12, 0.12), mat);
    top.position.y = 2.46;
    arch.add(top);
    for (const x of [-width / 2 - 0.08, width / 2 + 0.08]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, 0.12), mat);
      post.position.set(x, 1.25, 0);
      arch.add(post);
    }
    arch.position.z = z;
    group.add(arch);
  }

  const centerLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.04, Math.max(1, length - 0.8)),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyan })
  );
  centerLight.position.set(0, 2.42, 0);
  group.add(centerLight);
}

function addRampMarkers(group, width, length, rise, seed) {
  const color = rise > 0 ? PALETTE.green : PALETTE.orange;
  const markerMat = new THREE.MeshBasicMaterial({ color });
  const count = Math.max(3, Math.floor(length / 2.5));
  for (let i = 1; i <= count; i += 1) {
    const z = -length / 2 + (i / (count + 1)) * length;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.025, 0.10), markerMat);
    bar.position.set(0, 0.025, z);
    group.add(bar);
  }

  const labelRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.07, 14, 36),
    new THREE.MeshBasicMaterial({ color: seed % 2 === 0 ? PALETTE.magenta : PALETTE.cyan })
  );
  labelRing.position.set(0, 1.95, 0);
  group.add(labelRing);
}

function createJunction(position, yaw, correctTurn, index, width, turnAngle) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = yaw;
  mazeRoot.add(group);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width + 4.2, 0.11, width + 2.6),
    new THREE.MeshStandardMaterial({ color: PALETTE.cream, roughness: 0.8 })
  );
  floor.position.y = -0.07;
  group.add(floor);

  const leftPreview = createBranchPreview('left', correctTurn === 'left', turnAngle, index, width);
  const rightPreview = createBranchPreview('right', correctTurn === 'right', turnAngle, index, width);
  group.add(leftPreview);
  group.add(rightPreview);

  const leftSign = createChoiceSign('left', correctTurn === 'left', index);
  leftSign.position.set(-1.45, 1.72, -0.62);
  leftSign.rotation.y = 0.12;
  group.add(leftSign);

  const rightSign = createChoiceSign('right', correctTurn === 'right', index);
  rightSign.position.set(1.45, 1.72, -0.62);
  rightSign.rotation.y = -0.12;
  group.add(rightSign);

  const frameMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.navy });
  const top = new THREE.Mesh(new THREE.BoxGeometry(width + 3.4, 0.10, 0.10), frameMaterial);
  top.position.set(0, 2.98, -0.4);
  group.add(top);
  for (const x of [-width / 2 - 1.25, width / 2 + 1.25]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.0, 0.1), frameMaterial);
    post.position.set(x, 1.5, -0.4);
    group.add(post);
  }

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.12, 40),
    new THREE.MeshStandardMaterial({ color: PALETTE.yellow, roughness: 0.55 })
  );
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 0.02, -0.25);
  group.add(hub);

  group.visible = false;
  return { group, correctTurn, leftSign, rightSign, position: position.clone(), yaw, index, turnAngle };
}

function createBranchPreview(side, isCorrect, angle, seed, width) {
  const previewLength = 4.6;
  const group = new THREE.Group();
  group.position.set(0, 0, -0.45);
  group.rotation.y = side === 'left' ? angle : -angle;

  const branch = new THREE.Group();
  branch.position.set(0, 0, -previewLength * 0.5);
  group.add(branch);

  const floorTexture = createGeometricTexture(300 + seed * 5 + (side === 'left' ? 1 : 2), 'floor');
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.2, 0.1, previewLength),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8 })
  );
  floor.position.y = -0.05;
  branch.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: isCorrect ? PALETTE.cream : PALETTE.pink, roughness: 0.82 });
  for (const x of [-(width / 2) + 0.06, (width / 2) - 0.06]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.35, previewLength), wallMat);
    wall.position.set(x, 1.175, 0);
    branch.add(wall);
  }

  const blocker = new THREE.Mesh(
    new THREE.BoxGeometry(width - 0.4, 2.1, 0.16),
    new THREE.MeshStandardMaterial({ color: isCorrect ? PALETTE.green : PALETTE.orange, roughness: 0.55 })
  );
  blocker.position.set(0, 1.02, -previewLength / 2 + 0.1);
  blocker.visible = !isCorrect;
  branch.add(blocker);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.08, 18, 36),
    new THREE.MeshBasicMaterial({ color: isCorrect ? PALETTE.cyan : PALETTE.yellow })
  );
  ring.position.set(0, 1.4, -previewLength / 2 + 0.22);
  branch.add(ring);
  return group;
}

function createChoiceSign(side, isCorrect, seed) {
  const group = new THREE.Group();
  group.userData.side = side;
  group.userData.correct = isCorrect;

  const panelColor = side === 'left' ? PALETTE.cyan : PALETTE.magenta;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.62, 1.62, 0.12),
    new THREE.MeshStandardMaterial({ color: panelColor, roughness: 0.55 })
  );
  group.add(panel);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(panel.geometry),
    new THREE.LineBasicMaterial({ color: PALETTE.navy })
  );
  outline.scale.setScalar(1.01);
  group.add(outline);

  if (isCorrect) {
    const circle = new THREE.Mesh(
      new THREE.CircleGeometry(0.54, 56),
      new THREE.MeshBasicMaterial({ color: PALETTE.blue })
    );
    circle.position.z = 0.066;
    group.add(circle);
    for (let y = -0.24; y <= 0.24; y += 0.24) {
      for (let x = -0.24; x <= 0.24; x += 0.24) {
        const dot = new THREE.Mesh(
          new THREE.CircleGeometry(0.048, 24),
          new THREE.MeshBasicMaterial({ color: PALETTE.cream })
        );
        dot.position.set(x, y, 0.071);
        group.add(dot);
      }
    }
  } else {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.48);
    shape.lineTo(-0.45, -0.36);
    shape.lineTo(0.45, -0.36);
    shape.closePath();
    const triangle = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: seed % 2 === 0 ? PALETTE.yellow : PALETTE.orange })
    );
    triangle.position.z = 0.066;
    group.add(triangle);
  }

  const arrow = createArrowMesh(side);
  arrow.position.set(0, -0.68, 0.08);
  arrow.scale.setScalar(0.58);
  group.add(arrow);
  return group;
}

function createArrowMesh(side) {
  const shape = new THREE.Shape();
  if (side === 'left') {
    shape.moveTo(-0.6, 0);
    shape.lineTo(-0.15, 0.38);
    shape.lineTo(-0.15, 0.14);
    shape.lineTo(0.52, 0.14);
    shape.lineTo(0.52, -0.14);
    shape.lineTo(-0.15, -0.14);
    shape.lineTo(-0.15, -0.38);
  } else {
    shape.moveTo(0.6, 0);
    shape.lineTo(0.15, 0.38);
    shape.lineTo(0.15, 0.14);
    shape.lineTo(-0.52, 0.14);
    shape.lineTo(-0.52, -0.14);
    shape.lineTo(0.15, -0.14);
    shape.lineTo(0.15, -0.38);
  }
  shape.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: PALETTE.navy }));
}

function createExit(position, yaw) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = yaw;
  mazeRoot.add(group);

  const archMat = new THREE.MeshStandardMaterial({ color: PALETTE.green, roughness: 0.4 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.18, 18, 64, Math.PI), archMat);
  ring.position.y = 1.2;
  group.add(ring);
  for (const x of [-1.2, 1.2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.25, 24), archMat);
    post.position.set(x, 0.62, 0);
    group.add(post);
  }
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.92, 48),
    new THREE.MeshBasicMaterial({ color: PALETTE.yellow, transparent: true, opacity: 0.72 })
  );
  glow.position.set(0, 1.05, -0.04);
  group.add(glow);
}

function createGeometricTexture(seed = 1, type = 'wall') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const random = mulberry32(seed + 11);
  const colors = ['#fbcd0f', '#f5621f', '#fbb1bd', '#21aee6', '#f34589', '#0ba053', '#0959ad'];
  ctx.fillStyle = '#fbf3ea';
  ctx.fillRect(0, 0, 512, 512);

  if (type === 'floor') {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.fillRect(0, 190, 512, 132);
    ctx.fillStyle = '#1a2243';
    ctx.fillRect(0, 184, 512, 8);
    ctx.fillRect(0, 320, 512, 8);
    for (let x = 48; x < 512; x += 88) {
      ctx.beginPath();
      ctx.fillStyle = x % 176 === 48 ? '#fffdf8' : '#1a2243';
      ctx.arc(x, 256, 13, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const split = 180 + Math.floor(random() * 150);
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.fillRect(0, 0, split, 512);
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.fillRect(split, 0, 512 - split, 512);

    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.beginPath();
    ctx.arc(340, 170, 118, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a2243';
    ctx.beginPath();
    ctx.arc(340, 170, 43, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fbf3ea';
    ctx.beginPath();
    ctx.moveTo(55, 440);
    ctx.lineTo(220, 180);
    ctx.lineTo(385, 440);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#1a2243';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(40, 350);
    ctx.bezierCurveTo(160, 350, 115, 240, 240, 240);
    ctx.stroke();

    ctx.fillStyle = '#1a2243';
    for (let y = 52; y < 150; y += 36) {
      for (let x = 55; x < 175; x += 36) {
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return new THREE.CanvasTexture(canvas);
}

function buildSpatialHUD() {
  mapCanvas3D = document.createElement('canvas');
  mapCanvas3D.width = 512;
  mapCanvas3D.height = 512;
  mapContext3D = mapCanvas3D.getContext('2d');
  mapTexture = new THREE.CanvasTexture(mapCanvas3D);
  mapTexture.colorSpace = THREE.SRGBColorSpace;
  mapMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.72),
    new THREE.MeshBasicMaterial({ map: mapTexture, transparent: true, depthTest: false })
  );
  mapMesh.position.set(0.72, 1.58, -1.35);
  mapMesh.renderOrder = 999;
  playerRig.add(mapMesh);

  hudCanvas3D = document.createElement('canvas');
  hudCanvas3D.width = 800;
  hudCanvas3D.height = 260;
  hudContext3D = hudCanvas3D.getContext('2d');
  hudTexture = new THREE.CanvasTexture(hudCanvas3D);
  hudTexture.colorSpace = THREE.SRGBColorSpace;
  hudMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 0.34),
    new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthTest: false })
  );
  hudMesh.position.set(0, 1.95, -1.45);
  hudMesh.renderOrder = 1000;
  playerRig.add(hudMesh);
  drawSpatialHUD();
}

function setupXRInputs() {
  for (let i = 0; i < 2; i += 1) {
    const controller = renderer.xr.getController(i);
    controller.userData.handedness = '';
    controller.addEventListener('connected', (event) => {
      controller.userData.handedness = event.data?.handedness || '';
    });
    controller.addEventListener('select', () => {
      if (!state.started || state.paused || state.completed) return;
      const handedness = controller.userData.handedness;
      if (handedness === 'left') chooseDirection('left', 'left-pinch');
      else if (handedness === 'right') chooseDirection('right', 'right-pinch');
      else chooseByControllerRay(controller);
    });
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: PALETTE.navy, transparent: true, opacity: 0.42 })
    );
    ray.scale.z = 4;
    controller.add(ray);
    controllerRays.push(controller);
    playerRig.add(controller);

    const hand = renderer.xr.getHand(i);
    hand.addEventListener('connected', (event) => {
      hand.userData.handedness = event.data?.handedness || '';
    });
    handTrackers.push({ hand, lastX: null, lastTime: 0, cooldown: 0 });
    playerRig.add(hand);
  }
}

function setupUI() {
  dom.modeCards.forEach((card) => {
    card.addEventListener('click', () => {
      dom.modeCards.forEach((item) => {
        item.classList.toggle('active', item === card);
        item.setAttribute('aria-checked', item === card ? 'true' : 'false');
      });
      updateBackgroundMode(card.dataset.mode);
    });
  });

  dom.speedRange.addEventListener('input', () => {
    setSpeed(Number(dom.speedRange.value));
  });
  dom.inGameSpeedRange.addEventListener('input', () => {
    setSpeed(Number(dom.inGameSpeedRange.value));
  });

  dom.reducedMotion.addEventListener('change', () => setReducedMotion(dom.reducedMotion.checked));
  dom.startDesktop.addEventListener('click', startGame);
  dom.leftButton.addEventListener('click', () => chooseDirection('left', 'screen'));
  dom.rightButton.addEventListener('click', () => chooseDirection('right', 'screen'));
  dom.pauseButton.addEventListener('click', togglePause);
  dom.resumeButton.addEventListener('click', togglePause);
  dom.restartButton.addEventListener('click', () => resetGame(true));
  dom.playAgain.addEventListener('click', () => resetGame(true));
  dom.motionButton.addEventListener('click', () => setReducedMotion(!state.reducedMotion));
  dom.inGameMode.addEventListener('change', () => updateBackgroundMode(dom.inGameMode.value));

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'a' || event.key === 'ArrowLeft') chooseDirection('left', 'keyboard');
    if (key === 'd' || event.key === 'ArrowRight') chooseDirection('right', 'keyboard');
    if (event.code === 'Space') {
      event.preventDefault();
      togglePause();
    }
    if (key === 'w' || event.key === 'ArrowUp') setSpeed(state.speed + 0.2, true);
    if (key === 's' || event.key === 'ArrowDown') setSpeed(state.speed - 0.2, true);
    if (key === 'm') dom.mapCanvas.closest('.map-card')?.classList.toggle('hidden');
  });
}

function startGame() {
  if (!state.started || state.completed) resetGame(false);
  state.started = true;
  state.paused = false;
  state.completed = false;
  dom.landing.classList.add('hidden');
  if (!renderer.xr.isPresenting) dom.hud.classList.remove('hidden');
  dom.pausePanel.classList.add('hidden');
  dom.resultPanel.classList.add('hidden');
  clock.getDelta();
  currentSpeed = state.speed;
  updateMovementStatus();
  showToast(`已开始自动前进 · ${state.speed.toFixed(1)} m/s`);
}

function resetGame(startImmediately = true) {
  state.started = startImmediately;
  state.paused = false;
  state.awaitingChoice = false;
  state.completed = false;
  state.currentSegment = 0;
  state.wrongChoices = 0;
  state.pauseCount = 0;
  state.elapsed = 0;
  state.taskStartedAt = 0;
  state.choices = [];
  state.turnAnimation = null;
  currentSpeed = 0;
  updateMovementStatus();

  junctions.forEach((junction) => {
    junction.group.visible = false;
    setSignFeedback(junction.leftSign, 'idle');
    setSignFeedback(junction.rightSign, 'idle');
  });

  const first = segments[0];
  playerRig.position.copy(first.start);
  playerRig.rotation.set(0, first.yaw, 0);
  camera.position.set(0, 1.62, 0);
  camera.rotation.set(0, 0, 0);

  dom.choicePrompt.classList.add('hidden');
  dom.pausePanel.classList.add('hidden');
  dom.resultPanel.classList.add('hidden');
  if (startImmediately) {
    dom.landing.classList.add('hidden');
    if (!renderer.xr.isPresenting) dom.hud.classList.remove('hidden');
  }
  updateProgress();
  updateMap();
  drawSpatialHUD();
}

function render() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsedTime = clock.elapsedTime;
  if (environment) {
    environment.material.uniforms.uTime.value = elapsedTime;
    environment.material.uniforms.uSpeed.value = state.speed;
    environment.position.x = playerRig.position.x;
    environment.position.z = playerRig.position.z;
  }

  if (state.started && !state.paused && !state.completed) {
    state.elapsed += dt;
    updateTurnAnimation(elapsedTime);
    if (!state.turnAnimation && !state.awaitingChoice) updateMovement(dt);
    updateHandSwipes(elapsedTime);
  }

  updateMap(false);
  renderer.render(scene, camera);
}

function updateMovement(dt) {
  const segment = segments[state.currentSegment];
  if (!segment) return;

  const targetSpeed = state.reducedMotion ? Math.min(state.speed, 0.8) : state.speed;
  currentSpeed = THREE.MathUtils.damp(currentSpeed, targetSpeed, 3.2, dt);
  const remaining = playerRig.position.distanceTo(segment.end);
  updateMovementStatus(remaining);

  if (state.currentSegment < routeTurns.length && remaining < 1.35) {
    playerRig.position.copy(segment.end.clone().addScaledVector(segment.dir, -1.3));
    currentSpeed = 0;
    openChoice();
    return;
  }

  if (state.currentSegment === segments.length - 1 && remaining < 0.42) {
    completeGame();
    return;
  }

  playerRig.position.addScaledVector(segment.dir, Math.min(currentSpeed * dt, remaining));
}

function openChoice() {
  state.awaitingChoice = true;
  updateMovementStatus();
  state.taskStartedAt = state.elapsed;
  const junction = junctions[state.currentSegment];
  if (!junction) return;
  junction.group.visible = true;
  dom.choicePrompt.classList.remove('hidden');
  showToast(`第 ${state.currentSegment + 1} 个岔路口：观察高低层并寻找蓝色圆点`);
  drawSpatialHUD();
}

function chooseDirection(direction, source) {
  if (!state.started || state.paused || state.completed || !state.awaitingChoice || state.turnAnimation) return;
  const junction = junctions[state.currentSegment];
  if (!junction) return;
  const chosenSign = direction === 'left' ? junction.leftSign : junction.rightSign;

  if (direction !== junction.correctTurn) {
    state.wrongChoices += 1;
    state.choices.push({ junction: state.currentSegment, direction, correct: false, source, time: state.elapsed - state.taskStartedAt });
    setSignFeedback(chosenSign, 'wrong');
    showToast('再观察一下：蓝色圆点在另一侧');
    setTimeout(() => setSignFeedback(chosenSign, 'idle'), 650);
    return;
  }

  state.choices.push({ junction: state.currentSegment, direction, correct: true, source, time: state.elapsed - state.taskStartedAt });
  setSignFeedback(chosenSign, 'correct');
  showToast('选择正确，继续前进');
  state.awaitingChoice = false;
  updateMovementStatus();
  dom.choicePrompt.classList.add('hidden');

  const currentYaw = playerRig.rotation.y;
  const nextSegment = segments[state.currentSegment + 1];
  state.currentSegment += 1;
  updateProgress();

  state.turnAnimation = {
    startedAt: clock.elapsedTime,
    duration: state.reducedMotion ? 0.95 : 0.72,
    from: currentYaw,
    to: unwrapAngle(currentYaw, nextSegment.yaw),
    fromPosition: playerRig.position.clone(),
    toPosition: junction.position.clone(),
    junction,
  };
}

function updateTurnAnimation(time) {
  if (!state.turnAnimation) return;
  const animation = state.turnAnimation;
  const p = THREE.MathUtils.clamp((time - animation.startedAt) / animation.duration, 0, 1);
  const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  playerRig.rotation.y = THREE.MathUtils.lerp(animation.from, animation.to, eased);
  playerRig.position.lerpVectors(animation.fromPosition, animation.toPosition, eased);
  if (p >= 1) {
    playerRig.rotation.y = animation.to;
    playerRig.position.copy(animation.toPosition);
    animation.junction.group.visible = false;
    state.turnAnimation = null;
    currentSpeed = state.speed;
    updateMovementStatus();
    drawSpatialHUD();
  }
}

function chooseByControllerRay(controller) {
  if (!state.awaitingChoice) return;
  const raycaster = new THREE.Raycaster();
  controller.getWorldPosition(tmpVec);
  controller.getWorldDirection(tmpVec2).negate();
  raycaster.set(tmpVec, tmpVec2);
  const junction = junctions[state.currentSegment];
  const hits = raycaster.intersectObjects([junction.leftSign, junction.rightSign], true);
  if (hits.length > 0) {
    let object = hits[0].object;
    while (object.parent && !object.userData.side) object = object.parent;
    if (object.userData.side) chooseDirection(object.userData.side, 'xr-ray');
  }
}

function updateHandSwipes(time) {
  if (!renderer.xr.isPresenting || !state.awaitingChoice) return;
  handTrackers.forEach((tracker) => {
    if (time < tracker.cooldown) return;
    const wrist = tracker.hand.joints?.wrist;
    if (!wrist || !wrist.visible) {
      tracker.lastX = null;
      return;
    }
    wrist.getWorldPosition(tmpVec);
    playerRig.worldToLocal(tmpVec);
    if (tracker.lastX === null || time - tracker.lastTime > 0.42) {
      tracker.lastX = tmpVec.x;
      tracker.lastTime = time;
      return;
    }
    const dx = tmpVec.x - tracker.lastX;
    if (Math.abs(dx) > 0.14) {
      chooseDirection(dx < 0 ? 'left' : 'right', 'hand-swipe');
      tracker.cooldown = time + 1.1;
      tracker.lastX = null;
    }
  });
}

function togglePause() {
  if (!state.started || state.completed) return;
  state.paused = !state.paused;
  if (state.paused) state.pauseCount += 1;
  dom.pausePanel.classList.toggle('hidden', !state.paused || renderer.xr.isPresenting);
  dom.pauseButton.textContent = state.paused ? '▶' : 'Ⅱ';
  updateMovementStatus();
  showToast(state.paused ? '已暂停，放松眼睛' : '继续前进');
  drawSpatialHUD();
}

function completeGame() {
  state.completed = true;
  state.awaitingChoice = false;
  currentSpeed = 0;
  updateMovementStatus();
  dom.choicePrompt.classList.add('hidden');
  dom.hud.classList.add('hidden');
  dom.resultTime.textContent = formatTime(state.elapsed);
  dom.resultErrors.textContent = String(state.wrongChoices);
  dom.resultPauses.textContent = String(state.pauseCount);
  dom.resultMode.textContent = MODE_LABELS[state.backgroundMode];
  dom.resultPanel.classList.remove('hidden');
  showToast('已抵达光之出口');
  drawSpatialHUD();
}

function updateBackgroundMode(mode) {
  state.backgroundMode = mode;
  dom.inGameMode.value = mode;
  const modeIndex = { geometric: 0, stripes: 1, checker: 2, redgreen: 3 }[mode] ?? 0;
  if (environment) environment.material.uniforms.uMode.value = modeIndex;
  if (scene?.fog) {
    scene.fog.color.set(mode === 'redgreen' ? 0x785d42 : mode === 'stripes' || mode === 'checker' ? PALETTE.cream : PALETTE.cream);
  }
  drawSpatialHUD();
}

function setSpeed(value, announce = false) {
  const next = THREE.MathUtils.clamp(Number(value) || 1.8, 0.6, 4);
  state.speed = Math.round(next * 10) / 10;
  dom.speedRange.value = String(state.speed);
  dom.inGameSpeedRange.value = String(state.speed);
  const label = `${state.speed.toFixed(1)} m/s`;
  dom.speedOutput.textContent = label;
  dom.inGameSpeedOutput.textContent = label;
  if (environment) environment.material.uniforms.uSpeed.value = state.speed;
  if (state.started && !state.paused && !state.awaitingChoice && !state.completed) {
    currentSpeed = state.speed;
  }
  updateMovementStatus();
  drawSpatialHUD();
  if (announce) showToast(`前进速度：${label}`);
}

function updateMovementStatus(remaining = null) {
  if (!dom.movementStatus) return;
  if (!state.started) {
    dom.movementStatus.textContent = `准备开始 · ${state.speed.toFixed(1)} m/s`;
    return;
  }
  if (state.completed) {
    dom.movementStatus.textContent = '已抵达出口';
    return;
  }
  if (state.paused) {
    dom.movementStatus.textContent = `已暂停 · ${state.speed.toFixed(1)} m/s`;
    return;
  }
  if (state.awaitingChoice) {
    dom.movementStatus.textContent = '岔路口等待选择';
    return;
  }
  const distanceText = Number.isFinite(remaining) ? ` · 距路口 ${remaining.toFixed(1)} m` : '';
  dom.movementStatus.textContent = `自动前进中 · ${state.speed.toFixed(1)} m/s${distanceText}`;
}

function setReducedMotion(value) {
  state.reducedMotion = value;
  dom.reducedMotion.checked = value;
  dom.motionButton.textContent = `减少动态：${value ? '开' : '关'}`;
  if (environment) environment.material.uniforms.uMotion.value = value ? 0.08 : 1.0;
  updateMovementStatus();
  showToast(value ? '已降低背景运动与前进速度' : '已恢复背景运动');
}

function updateProgress() {
  const completed = Math.min(state.currentSegment, routeTurns.length);
  dom.progressLabel.textContent = `${completed} / ${TOTAL_DECISIONS}`;
  dom.progressBar.style.width = `${(completed / routeTurns.length) * 100}%`;
  drawSpatialHUD();
}

function updateMap(force = false) {
  if (!routePoints.length) return;
  const now = performance.now();
  if (!force && updateMap.lastTime && now - updateMap.lastTime < 80) return;
  updateMap.lastTime = now;
  drawMap(dom.mapCanvas.getContext('2d'), dom.mapCanvas.width, dom.mapCanvas.height, false);
  drawMap(mapContext3D, mapCanvas3D.width, mapCanvas3D.height, true);
  mapTexture.needsUpdate = true;
}

function drawMap(ctx, width, height, spatial) {
  ctx.clearRect(0, 0, width, height);
  const scaleInfo = calculateMapScale(width, height);
  ctx.fillStyle = spatial ? 'rgba(251,243,234,0.96)' : '#fffdf8';
  roundRect(ctx, 2, 2, width - 4, height - 4, spatial ? 34 : 18);
  ctx.fill();
  ctx.strokeStyle = '#1a2243';
  ctx.lineWidth = spatial ? 12 : 4;
  ctx.stroke();

  ctx.save();
  ctx.translate(scaleInfo.offsetX, scaleInfo.offsetY);
  ctx.scale(scaleInfo.scale, scaleInfo.scale);
  ctx.translate(-scaleInfo.minX, -scaleInfo.minZ);

  ctx.strokeStyle = '#1a2243';
  ctx.lineWidth = 0.42;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  routePoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.z);
    else ctx.lineTo(point.x, point.z);
  });
  ctx.stroke();

  ctx.strokeStyle = '#21aee6';
  ctx.lineWidth = 0.24;
  ctx.beginPath();
  const currentPosition = playerRig.position;
  routePoints.forEach((point, index) => {
    if (index > state.currentSegment + 1) return;
    if (index === 0) ctx.moveTo(point.x, point.z);
    else ctx.lineTo(point.x, point.z);
  });
  ctx.lineTo(currentPosition.x, currentPosition.z);
  ctx.stroke();

  routePoints.forEach((point, index) => {
    const isVisited = index <= state.currentSegment;
    const r = index === 0 ? 0.28 : index === routePoints.length - 1 ? 0.42 : 0.24;
    ctx.beginPath();
    ctx.fillStyle = index === routePoints.length - 1 ? '#0ba053' : isVisited ? '#21aee6' : '#fffdf8';
    ctx.arc(point.x, point.z, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.10;
    ctx.strokeStyle = '#1a2243';
    ctx.stroke();
  });

  ctx.fillStyle = '#0959ad';
  ctx.beginPath();
  ctx.arc(currentPosition.x, currentPosition.z, 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fffdf8';
  ctx.beginPath();
  ctx.arc(currentPosition.x, currentPosition.z, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.12;
  ctx.strokeStyle = '#1a2243';
  ctx.stroke();
  ctx.restore();

  if (spatial) {
    ctx.fillStyle = '#1a2243';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillText('MAP · 路径地图', 36, 54);
    ctx.font = '700 23px system-ui, sans-serif';
    ctx.fillText(`${Math.min(state.currentSegment, TOTAL_DECISIONS)} / ${TOTAL_DECISIONS}`, width - 150, 54);
  }
}

function calculateMapScale(width, height) {
  const xs = routePoints.map((p) => p.x);
  const zs = routePoints.map((p) => p.z);
  const minX = Math.min(...xs) - 1.5;
  const maxX = Math.max(...xs) + 1.5;
  const minZ = Math.min(...zs) - 1.5;
  const maxZ = Math.max(...zs) + 1.5;
  const padding = width * 0.14;
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxZ - minZ));
  return { minX, minZ, scale, offsetX: padding, offsetY: padding };
}

function drawSpatialHUD() {
  if (!hudContext3D) return;
  const ctx = hudContext3D;
  ctx.clearRect(0, 0, 800, 260);
  ctx.fillStyle = 'rgba(251,243,234,0.95)';
  roundRect(ctx, 8, 8, 784, 244, 36);
  ctx.fill();
  ctx.strokeStyle = '#1a2243';
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.fillStyle = '#0959ad';
  ctx.font = '900 42px system-ui, sans-serif';
  ctx.fillText('STEREO PATH', 42, 67);
  ctx.fillStyle = '#1a2243';
  ctx.font = '900 53px system-ui, sans-serif';
  const title = state.completed ? '抵达光之出口' : state.paused ? '已暂停 · 放松眼睛' : state.awaitingChoice ? '寻找蓝色圆点' : '保持坐姿 · 缓慢前进';
  ctx.fillText(title, 42, 137);
  ctx.fillStyle = '#1a2243';
  ctx.font = '700 28px system-ui, sans-serif';
  const help = state.awaitingChoice ? '左手捏合 / 向左滑　　右手捏合 / 向右滑' : `${Math.min(state.currentSegment, TOTAL_DECISIONS)} / ${TOTAL_DECISIONS}　${MODE_LABELS[state.backgroundMode]}　${state.speed.toFixed(1)} m/s`;
  ctx.fillText(help, 44, 196);

  ctx.fillStyle = '#fbcd0f';
  roundRect(ctx, 605, 38, 142, 72, 30);
  ctx.fill();
  ctx.strokeStyle = '#1a2243';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#1a2243';
  ctx.font = '900 31px system-ui, sans-serif';
  ctx.fillText(`${Math.min(state.currentSegment, TOTAL_DECISIONS)} / ${TOTAL_DECISIONS}`, 620, 84);
  hudTexture.needsUpdate = true;
}

function setSignFeedback(sign, type) {
  const panel = sign.children.find((child) => child.isMesh && child.geometry?.type === 'BoxGeometry');
  if (!panel) return;
  if (!panel.userData.baseColor) panel.userData.baseColor = panel.material.color.getHex();
  if (type === 'correct') {
    sign.scale.setScalar(1.13);
    panel.material.emissive?.setHex(PALETTE.green);
    panel.material.emissiveIntensity = 0.35;
  } else if (type === 'wrong') {
    sign.scale.setScalar(0.92);
    panel.material.color.setHex(PALETTE.pink);
    panel.material.emissive?.setHex(PALETTE.orange);
    panel.material.emissiveIntensity = 0.22;
  } else {
    sign.scale.setScalar(1);
    panel.material.color.setHex(panel.userData.baseColor);
    panel.material.emissive?.setHex(0x000000);
    panel.material.emissiveIntensity = 0;
  }
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.remove('hidden');
  state.toastTimer = window.setTimeout(() => dom.toast.classList.add('hidden'), 2200);
}

function yawFromDirection(direction) {
  return Math.atan2(-direction.x, -direction.z);
}

function rotateDirection(direction, turn, angle = Math.PI / 2) {
  const signedAngle = turn === 'left' ? angle : -angle;
  return direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), signedAngle).normalize();
}

function unwrapAngle(current, target) {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
