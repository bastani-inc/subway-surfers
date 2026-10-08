import * as THREE from 'three';
import {
  FIXED_DT,
  GRAVITY,
  JUMP_VELOCITY,
  LANE_WIDTH,
  MAX_SPEED,
  ROLL_DURATION,
  SIM_HZ,
  STAND_HEIGHT,
  STUMBLE_SECONDS,
} from '../sim/constants';
import { chaseVisible } from '../sim/chase';
import { FixedStepper } from '../sim/fixedStep';
import { OBSTACLE_DEFS, type ObstacleKind } from '../sim/obstacleDefs';
import { changeLane, colliderOf, isRolling, jump, roll, type RunnerState } from '../sim/runner';
import { HighScoreStore } from '../sim/score';
import { FIRST_PATTERN_DISTANCE } from '../sim/spawner';
import { World, type WorldState } from '../sim/world';
import { Chasers } from './chasers';
import { DevPanels } from './devPanels';
import { DustBursts } from './dust';
import { FpsMeter } from './fpsMeter';
import { GameOverScreen, Hud } from './hud';
import { bindInput, type Action } from './input';
import { ObstacleView } from './obstacleView';
import { RunnerModel } from './runnerModel';
import { Sfx } from './sfx';
import { StartScreen } from './startScreen';
import { SKY_HORIZON, duskSkyTexture } from './toon';
import { Track } from './track';

const CAMERA_HEIGHT = 2.2;
const CAMERA_DISTANCE = 4.4;
const CAMERA_LOOK_AHEAD = 9;
const CAMERA_LOOK_HEIGHT = 1.2;
const CAMERA_FOLLOW_RATE = 9;
const RESTART_LOCKOUT_SECONDS = 0.5;
const CRASH_CAMERA_RAISE = 1.8;
const CRASH_CAMERA_PULLBACK = 1.6;
const CRASH_CAMERA_RATE = 3;

export type GameState = WorldState;

interface Snapshot {
  x: number;
  y: number;
  z: number;
  distance: number;
  gap: number;
}

const CAUSE_TEXT = {
  frontCrash: 'Officer Brask and Volt caught you after a crash',
  secondStumble: 'Two stumbles — Officer Brask and Volt caught up',
} as const;

const readOptions = () => {
  const params = new URLSearchParams(window.location.search);
  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  return {
    seed: Number.isFinite(seedParam) ? seedParam : Math.floor(Math.random() * 2 ** 31),
    fixedSeed: Number.isFinite(seedParam),
    spawning: params.get('spawns') !== 'off',
  };
};

const safeStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);
  readonly world: World;
  readonly stepper: FixedStepper;
  readonly fpsMeter = new FpsMeter();
  readonly devPanels: DevPanels;
  readonly track = new Track();
  readonly runnerModel = new RunnerModel();
  readonly obstacleView = new ObstacleView();
  readonly chasers = new Chasers();
  readonly sun: THREE.DirectionalLight;
  readonly colliderHelper: THREE.Box3Helper;
  readonly cameraTarget = new THREE.Vector3();
  readonly dust = new DustBursts();
  readonly sfx = new Sfx();
  readonly startScreen: StartScreen;
  readonly hud: Hud;
  readonly gameOver: GameOverScreen;
  readonly options = readOptions();
  private readonly colliderBox = new THREE.Box3();
  private readonly projected = new THREE.Vector3();
  private landingsSeen = 0;
  private clock = 0;
  private gameOverAt = 0;
  private crashView = 0;
  private previous: Snapshot;
  private lastFrame = 0;
  private stepsAtSecondStart = 0;
  private secondStart = 0;
  stepsPerSecond = 0;
  runs = 1;

  constructor(private readonly host: HTMLElement) {
    this.world = new World({ seed: this.options.seed, spawning: this.options.spawning, highScores: new HighScoreStore(safeStorage()) });

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement);

    this.scene.background = duskSkyTexture();
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 50, 150);
    this.scene.add(new THREE.HemisphereLight(0xffc6e8, 0x40306a, 1.4));

    this.sun = new THREE.DirectionalLight(0xffd2a1, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 4;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -14;
    shadowCam.right = 14;
    shadowCam.top = 34;
    shadowCam.bottom = -34;
    shadowCam.near = 1;
    shadowCam.far = 90;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(
      this.track.group,
      this.obstacleView.group,
      this.chasers.group,
      this.runnerModel.root,
      this.runnerModel.blobShadow,
      this.dust.group,
    );

    this.colliderHelper = new THREE.Box3Helper(this.colliderBox, new THREE.Color(0x39ff6a));
    this.scene.add(this.colliderHelper);

    this.devPanels = new DevPanels(document.body);
    this.devPanels.onToggle((visible) => {
      this.colliderHelper.visible = visible;
      this.obstacleView.setDebugVisible(visible);
    });

    this.stepper = new FixedStepper((dt) => this.step(dt), FIXED_DT);
    this.previous = this.snapshot();

    this.startScreen = new StartScreen(document.body);
    this.hud = new Hud(document.body);
    this.gameOver = new GameOverScreen(document.body, () => this.restart());
    bindInput((action) => this.handle(action));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.updateCamera(1, true);
  }

  get runner(): RunnerState {
    return this.world.runner;
  }

  get state(): GameState {
    return this.world.state;
  }

  private snapshot(): Snapshot {
    const r = this.world.runner;
    return { x: r.x, y: r.y, z: r.z, distance: r.distance, gap: this.world.chase.gap };
  }

  start(): void {
    this.lastFrame = performance.now();
    this.secondStart = this.lastFrame;
    this.renderer.setAnimationLoop((now: number) => this.frame(now));
  }

  private handle(action: Action): void {
    if (action === 'toggleDev') {
      this.devPanels.toggle();
      return;
    }
    this.sfx.unlock();
    if (this.world.state === 'ready') {
      this.world.start();
      this.startScreen.hide();
      this.hud.visible = true;
      return;
    }
    if (this.world.state === 'gameover') {
      if (this.clock - this.gameOverAt >= RESTART_LOCKOUT_SECONDS) this.restart();
      return;
    }
    if (this.world.state !== 'running') return;
    switch (action) {
      case 'left':
        changeLane(this.runner, -1);
        break;
      case 'right':
        changeLane(this.runner, 1);
        break;
      case 'jump':
        if (jump(this.runner)) this.sfx.play('jump');
        break;
      case 'roll':
        roll(this.runner);
        this.sfx.play('roll');
        break;
    }
  }

  restart(): void {
    if (this.world.state !== 'gameover') return;
    this.world.restart(this.options.fixedSeed ? this.options.seed : Math.floor(Math.random() * 2 ** 31));
    this.runs++;
    this.landingsSeen = 0;
    this.gameOver.hide();
    this.hud.visible = true;
    this.chasers.snap();
    this.previous = this.snapshot();
    this.updateCamera(1, true);
  }

  private step(dt: number): void {
    this.previous = this.snapshot();
    this.clock += dt;
    this.world.step(dt);
    const r = this.runner;
    if (r.landings !== this.landingsSeen) {
      this.landingsSeen = r.landings;
      this.dust.emit(r.x, r.z, r.y);
    }
    for (const event of this.world.drainEvents()) {
      if (event === 'stumble') this.sfx.play('stumble');
      else if (event === 'crash') this.sfx.play('crash');
      else if (event === 'gameover') this.showGameOver();
    }
  }

  private showGameOver(): void {
    this.gameOverAt = this.clock;
    this.hud.visible = false;
    const w = this.world;
    this.gameOver.show(w.score, w.highScore, w.newHighScore, w.crashCause ? CAUSE_TEXT[w.crashCause] : '');
  }

  private frame(now: number): void {
    const frameMs = Math.max(0, now - this.lastFrame);
    this.lastFrame = now;
    this.fpsMeter.push(frameMs);
    this.stepper.advance(frameMs / 1000);

    if (now - this.secondStart >= 1000) {
      this.stepsPerSecond = ((this.stepper.totalSteps - this.stepsAtSecondStart) * 1000) / (now - this.secondStart);
      this.stepsAtSecondStart = this.stepper.totalSteps;
      this.secondStart = now;
    }

    const alpha = this.stepper.alpha;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const r = this.runner;
    const w = this.world;
    const x = lerp(this.previous.x, r.x);
    const y = lerp(this.previous.y, r.y);
    const z = lerp(this.previous.z, r.z);
    const groundY = w.supportAt(r, r.y);
    const frameSeconds = Math.min(frameMs / 1000, 0.1);
    this.runnerModel.update({
      x,
      y,
      z,
      distance: lerp(this.previous.distance, r.distance),
      grounded: r.grounded,
      vy: r.vy,
      rollTimeLeft: r.rollTimeLeft,
      lateralVelocity: r.vx,
      ready: w.state === 'ready',
      time: this.clock,
      groundY,
      stumble: r.stumbleTimeLeft > 0 ? 1 - r.stumbleTimeLeft / STUMBLE_SECONDS : 0,
      fall: r.fall,
      crashed: w.state === 'crashed' || w.state === 'gameover',
    });
    this.chasers.update({
      phase: w.chase.phase,
      gap: lerp(this.previous.gap, w.chase.gap),
      runnerX: x,
      runnerZ: z,
      groundY: r.grounded ? r.y : groundY,
      dt: frameSeconds,
      time: this.clock,
    });
    this.obstacleView.sync(w.spawner.active, alpha);
    this.dust.update(frameSeconds);
    this.track.update(z);
    this.updateSun(x, z);
    this.updateColliderHelper();
    this.updateCamera(frameMs / 1000, false, x, y, z);
    this.hud.update(w.score, w.highScore, w.multiplier);
    this.updatePanels();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSun(x: number, z: number): void {
    this.sun.position.set(x + 6, 16, z + 2);
    this.sun.target.position.set(x, 0, z - 18);
  }

  private updateColliderHelper(): void {
    const c = colliderOf(this.runner);
    this.colliderBox.min.set(c.centerX - c.width / 2, c.bottomY, c.centerZ - c.depth / 2);
    this.colliderBox.max.set(c.centerX + c.width / 2, c.bottomY + c.height, c.centerZ + c.depth / 2);
  }

  private updateCamera(dt: number, snap: boolean, x = this.runner.x, y = this.runner.y, z = this.runner.z): void {
    const k = snap ? 1 : 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt);
    const crashed = this.world.state === 'crashed' || this.world.state === 'gameover';
    this.crashView = snap ? (crashed ? 1 : 0) : this.crashView + ((crashed ? 1 : 0) - this.crashView) * (1 - Math.exp(-CRASH_CAMERA_RATE * dt));
    const desiredX = x * 0.85;
    const desiredY = CAMERA_HEIGHT + y * 0.7 + this.crashView * CRASH_CAMERA_RAISE;
    const cam = this.camera.position;
    cam.x += (desiredX - cam.x) * k;
    cam.y += (desiredY - cam.y) * k;
    cam.z = z + CAMERA_DISTANCE + this.crashView * CRASH_CAMERA_PULLBACK;
    this.cameraTarget.x += (x - this.cameraTarget.x) * k;
    this.cameraTarget.y += (CAMERA_LOOK_HEIGHT + y * 0.6 - this.cameraTarget.y) * k;
    this.cameraTarget.z = z - CAMERA_LOOK_AHEAD;
    this.camera.lookAt(this.cameraTarget);
  }

  runnerInView(): boolean {
    const c = colliderOf(this.runner);
    this.camera.updateMatrixWorld();
    for (const dx of [-0.5, 0.5])
      for (const dy of [0, 1])
        for (const dz of [-0.5, 0.5]) {
          this.projected.set(c.centerX + dx * c.width, c.bottomY + dy * c.height, c.centerZ + dz * c.depth).project(this.camera);
          if (Math.abs(this.projected.x) > 1 || Math.abs(this.projected.y) > 1 || this.projected.z > 1) return false;
        }
    return true;
  }

  chasersInView(): boolean {
    if (!this.chasers.group.visible) return false;
    this.camera.updateMatrixWorld();
    const { brask } = this.chasers.bounds();
    const center = brask.getCenter(this.projected).project(this.camera);
    return Math.abs(center.x) <= 1 && Math.abs(center.y) <= 1 && center.z < 1;
  }

  runnerModelBounds(): { minY: number; maxY: number } {
    const bounds = new THREE.Box3().setFromObject(this.runnerModel.root, true);
    return { minY: bounds.min.y, maxY: bounds.max.y };
  }

  spawnObstacle(kind: ObstacleKind, lane: number, ahead: number, oncoming = false): number {
    const half = OBSTACLE_DEFS[kind].size.length / 2;
    return this.world.spawner.spawn(kind, Math.max(-1, Math.min(1, Math.round(lane))), this.runner.z - ahead - half, oncoming).id;
  }

  clearObstacles(): void {
    this.world.spawner.reset();
    this.world.spawner.nextZ = this.runner.z - FIRST_PATTERN_DISTANCE;
  }

  setSpawning(enabled: boolean): void {
    this.world.spawner.enabled = enabled;
    if (enabled) this.world.spawner.nextZ = Math.min(this.world.spawner.nextZ, this.runner.z - 60);
  }

  private updatePanels(): void {
    if (!this.devPanels.visible) return;
    const w = this.world;
    const r = this.runner;
    const c = colliderOf(r);
    const counts = this.track.instanceCounts;
    this.devPanels.set(
      'fps',
      `fps ${this.fpsMeter.fps.toFixed(1)}\nframe ${this.fpsMeter.frameMs.toFixed(2)} ms\nsim ${SIM_HZ} Hz  steps/s ${this.stepsPerSecond.toFixed(1)}\ndraw calls ${this.renderer.info.render.calls}  tris ${this.renderer.info.render.triangles}`,
    );
    const hit = w.lastHit ? `${w.lastHit.kind} ${w.lastHit.obstacle}.${w.lastHit.part} lane ${w.lastHit.lane}` : 'none';
    this.devPanels.set(
      'physics',
      `lane ${r.lane}  x ${r.x.toFixed(2)}  vx ${r.vx.toFixed(2)}\ny ${r.y.toFixed(2)}  vy ${r.vy.toFixed(2)}  ${r.grounded ? 'grounded' : 'airborne'}\nroll ${isRolling(r) ? r.rollTimeLeft.toFixed(2) + ' s' : 'no'}\ncollider ${c.width.toFixed(2)} x ${c.height.toFixed(2)} x ${c.depth.toFixed(2)}\ng ${GRAVITY}  v0 ${JUMP_VELOCITY}  speed ${r.speed.toFixed(1)}\nlast hit ${hit}\nchase ${w.chase.phase} gap ${w.chase.gap.toFixed(1)} m${w.chase.phase === 'close' ? ` (${w.chase.timer.toFixed(1)} s)` : ''}`,
    );
    const kinds = new Map<string, number>();
    for (const o of w.spawner.active) {
      const key = o.oncoming ? 'oncoming' : o.kind;
      kinds.set(key, (kinds.get(key) ?? 0) + 1);
    }
    const view = this.obstacleView.stats;
    this.devPanels.set(
      'spawn',
      `state ${w.state}  distance ${r.distance.toFixed(0)} m  seed ${this.options.seed}\nactive ${w.spawner.active.length}  ${[...kinds].map(([k, n]) => `${k} ${n}`).join('  ')}\nsim pool created ${w.spawner.created}  free ${w.spawner.pooled}  recycled ${w.spawner.recycled}\nmesh pool built ${view.created}  in use ${view.bound}  free ${view.pooled}\nnext pattern at ${(-w.spawner.nextZ).toFixed(0)} m  last ${w.spawner.lastPattern ?? '-'}\nsleepers pooled ${counts.sleepers}  dust bursts ${this.dust.bursts}`,
    );
  }

  private resize(): void {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  get chaseVisible(): boolean {
    return chaseVisible(this.world.chase);
  }

  get tuning() {
    return { gravity: GRAVITY, jumpVelocity: JUMP_VELOCITY, rollDuration: ROLL_DURATION, laneWidth: LANE_WIDTH, maxSpeed: MAX_SPEED, standHeight: STAND_HEIGHT, simHz: SIM_HZ };
  }
}
