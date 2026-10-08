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
} from '../sim/constants';
import { FixedStepper } from '../sim/fixedStep';
import {
  changeLane,
  colliderOf,
  createRunner,
  isRolling,
  jump,
  roll,
  stepRunner,
  type RunnerState,
} from '../sim/runner';
import { DevPanels } from './devPanels';
import { DustBursts } from './dust';
import { FpsMeter } from './fpsMeter';
import { bindInput, type Action } from './input';
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

export type GameState = 'ready' | 'running';

interface Snapshot {
  x: number;
  y: number;
  z: number;
  distance: number;
}

const snapshot = (r: RunnerState): Snapshot => ({ x: r.x, y: r.y, z: r.z, distance: r.distance });

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 260);
  readonly runner = createRunner();
  state: GameState = 'ready';
  readonly stepper: FixedStepper;
  readonly fpsMeter = new FpsMeter();
  readonly devPanels: DevPanels;
  readonly track = new Track();
  readonly runnerModel = new RunnerModel();
  readonly sun: THREE.DirectionalLight;
  readonly colliderHelper: THREE.Box3Helper;
  readonly cameraTarget = new THREE.Vector3();
  readonly dust = new DustBursts();
  readonly sfx = new Sfx();
  readonly startScreen: StartScreen;
  private readonly colliderBox = new THREE.Box3();
  private readonly projected = new THREE.Vector3();
  private landingsSeen = 0;
  private clock = 0;
  private previous: Snapshot;
  private lastFrame = 0;
  private stepsAtSecondStart = 0;
  private secondStart = 0;
  stepsPerSecond = 0;

  constructor(private readonly host: HTMLElement) {
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
    shadowCam.left = -12;
    shadowCam.right = 12;
    shadowCam.top = 20;
    shadowCam.bottom = -20;
    shadowCam.near = 1;
    shadowCam.far = 60;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.track.group, this.runnerModel.root, this.runnerModel.blobShadow, this.dust.group);

    this.colliderHelper = new THREE.Box3Helper(this.colliderBox, new THREE.Color(0x39ff6a));
    this.scene.add(this.colliderHelper);

    this.devPanels = new DevPanels(document.body);
    this.devPanels.onToggle((visible) => {
      this.colliderHelper.visible = visible;
    });

    this.stepper = new FixedStepper((dt) => this.step(dt), FIXED_DT);
    this.previous = snapshot(this.runner);

    this.startScreen = new StartScreen(document.body);
    bindInput((action) => this.handle(action));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.updateCamera(1, true);
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
    if (this.state === 'ready') {
      this.state = 'running';
      this.startScreen.hide();
      return;
    }
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

  private step(dt: number): void {
    this.previous = snapshot(this.runner);
    this.clock += dt;
    if (this.state !== 'running') return;
    stepRunner(this.runner, dt);
    if (this.runner.landings !== this.landingsSeen) {
      this.landingsSeen = this.runner.landings;
      this.dust.emit(this.runner.x, this.runner.z);
    }
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
    const x = lerp(this.previous.x, r.x);
    const y = lerp(this.previous.y, r.y);
    const z = lerp(this.previous.z, r.z);
    this.runnerModel.update({
      x,
      y,
      z,
      distance: lerp(this.previous.distance, r.distance),
      grounded: r.grounded,
      vy: r.vy,
      rollTimeLeft: r.rollTimeLeft,
      lateralVelocity: r.vx,
      ready: this.state === 'ready',
      time: this.clock,
    });
    this.dust.update(Math.min(frameMs / 1000, 0.1));
    this.track.update(z);
    this.updateSun(x, z);
    this.updateColliderHelper();
    this.updateCamera(frameMs / 1000, false, x, y, z);
    this.updatePanels();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSun(x: number, z: number): void {
    this.sun.position.set(x + 6, 14, z + 4);
    this.sun.target.position.set(x, 0, z - 8);
  }

  private updateColliderHelper(): void {
    const c = colliderOf(this.runner);
    this.colliderBox.min.set(c.centerX - c.width / 2, c.bottomY, c.centerZ - c.depth / 2);
    this.colliderBox.max.set(c.centerX + c.width / 2, c.bottomY + c.height, c.centerZ + c.depth / 2);
  }

  private updateCamera(dt: number, snap: boolean, x = this.runner.x, y = this.runner.y, z = this.runner.z): void {
    const k = snap ? 1 : 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt);
    const desiredX = x * 0.85;
    const desiredY = CAMERA_HEIGHT + y * 0.7;
    const cam = this.camera.position;
    cam.x += (desiredX - cam.x) * k;
    cam.y += (desiredY - cam.y) * k;
    cam.z = z + CAMERA_DISTANCE;
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

  runnerModelBounds(): { minY: number; maxY: number } {
    const bounds = new THREE.Box3().setFromObject(this.runnerModel.root, true);
    return { minY: bounds.min.y, maxY: bounds.max.y };
  }

  private updatePanels(): void {
    if (!this.devPanels.visible) return;
    const r = this.runner;
    const c = colliderOf(r);
    const counts = this.track.instanceCounts;
    this.devPanels.set(
      'fps',
      `fps ${this.fpsMeter.fps.toFixed(1)}\nframe ${this.fpsMeter.frameMs.toFixed(2)} ms\nsim ${SIM_HZ} Hz  steps/s ${this.stepsPerSecond.toFixed(1)}\ndraw calls ${this.renderer.info.render.calls}  tris ${this.renderer.info.render.triangles}`,
    );
    this.devPanels.set(
      'physics',
      `lane ${r.lane}  x ${r.x.toFixed(2)}  vx ${r.vx.toFixed(2)}\ny ${r.y.toFixed(2)}  vy ${r.vy.toFixed(2)}  ${r.grounded ? 'grounded' : 'airborne'}\nroll ${isRolling(r) ? r.rollTimeLeft.toFixed(2) + ' s' : 'no'}\ncollider ${c.width.toFixed(2)} x ${c.height.toFixed(2)} x ${c.depth.toFixed(2)}\ng ${GRAVITY}  v0 ${JUMP_VELOCITY}  speed ${r.speed.toFixed(1)}`,
    );
    this.devPanels.set(
      'spawn',
      `state ${this.state}  distance ${r.distance.toFixed(0)} m\nsleepers pooled ${counts.sleepers}  pylons ${counts.pylons}  signals ${counts.signals}\nsleepers recycled ${this.track.recycledSleepers}\ndust bursts ${this.dust.bursts}  active puffs ${this.dust.active}\nobstacles: spawner not active yet`,
    );
  }

  private resize(): void {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  get tuning() {
    return { gravity: GRAVITY, jumpVelocity: JUMP_VELOCITY, rollDuration: ROLL_DURATION, laneWidth: LANE_WIDTH, maxSpeed: MAX_SPEED, standHeight: STAND_HEIGHT, simHz: SIM_HZ };
  }
}
