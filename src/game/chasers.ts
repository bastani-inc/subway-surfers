import * as THREE from 'three';
import type { ChasePhase } from '../sim/chase';
import { toonMaterial } from './toon';

const BRASK = {
  jacket: 0x1f9e9a,
  piping: 0xff7a1a,
  brass: 0xf2c14e,
  trousers: 0x1d2440,
  boots: 0x2a1c14,
  skin: 0xe0a07a,
  mustache: 0x4a2a18,
  badge: 0xffd21a,
};

const VOLT = { shell: 0xf7f8fc, joint: 0x8a93a8, led: 0x2ff0ff, eye: 0x9ffcff };

const HIDE_BEYOND_GAP = 10;

const mesh = (geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number, emissive = 0x000000): THREE.Mesh => {
  const m = new THREE.Mesh(geometry, toonMaterial(color, emissive, emissive ? 1 : 0.8));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const ball = (r: number) => new THREE.SphereGeometry(r, 16, 12);
const cylinder = (rTop: number, rBottom: number, h: number) => new THREE.CylinderGeometry(rTop, rBottom, h, 18);

interface Limb {
  pivot: THREE.Group;
  foot: THREE.Object3D | null;
}

const BRASK_LEG = 0.72;
const BRASK_BOOT = 0.09;

class Brask {
  readonly root = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly legs: Limb[] = [];
  private readonly arms: THREE.Group[] = [];

  constructor() {
    for (const x of [-0.15, 0.15]) {
      const pivot = new THREE.Group();
      pivot.position.x = x;
      pivot.add(mesh(box(0.22, BRASK_LEG - 0.05, 0.24), BRASK.trousers, 0, -(BRASK_LEG - 0.05) / 2, 0));
      const boot = mesh(box(0.27, BRASK_BOOT * 2, 0.38), BRASK.boots, 0, -BRASK_LEG, -0.06);
      pivot.add(boot);
      this.hips.add(pivot);
      this.legs.push({ pivot, foot: boot });
    }
    this.hips.add(mesh(box(0.66, 0.62, 0.42), BRASK.jacket, 0, 0.33, 0));
    this.hips.add(mesh(box(0.67, 0.06, 0.43), BRASK.piping, 0, 0.06, 0));
    this.hips.add(mesh(box(0.05, 0.6, 0.43), BRASK.piping, 0, 0.33, 0.001));
    for (const y of [0.2, 0.34, 0.48]) this.hips.add(mesh(ball(0.035), BRASK.brass, 0.09, y, -0.215));
    this.hips.add(mesh(box(0.02, 0.24, 0.02), BRASK.piping, -0.12, 0.5, -0.215));
    this.hips.add(mesh(cylinder(0.025, 0.025, 0.1), BRASK.brass, -0.12, 0.36, -0.23));
    this.hips.add(mesh(ball(0.25), BRASK.skin, 0, 0.86, 0));
    this.hips.add(mesh(box(0.3, 0.07, 0.08), BRASK.mustache, 0, 0.8, -0.22));
    this.hips.add(mesh(cylinder(0.27, 0.27, 0.16), BRASK.jacket, 0, 1.08, 0));
    this.hips.add(mesh(cylinder(0.275, 0.275, 0.04), BRASK.piping, 0, 1.02, 0));
    this.hips.add(mesh(box(0.38, 0.03, 0.18), BRASK.trousers, 0, 1.01, -0.3));
    const badge = mesh(box(0.06, 0.12, 0.02), BRASK.badge, 0, 1.09, -0.27, BRASK.badge);
    badge.rotation.z = 0.5;
    this.hips.add(badge);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.41, 0.58, 0);
      arm.add(mesh(box(0.18, 0.44, 0.2), BRASK.jacket, 0, -0.2, 0));
      arm.add(mesh(box(0.19, 0.05, 0.21), BRASK.piping, 0, -0.38, 0));
      arm.add(mesh(ball(0.11), BRASK.skin, 0, -0.5, 0));
      this.hips.add(arm);
      this.arms.push(arm);
    }
    this.root.add(this.hips);
  }

  pose(phase: number, running: boolean, grabbing: boolean): void {
    const swing = running ? Math.sin(phase) * 0.6 : 0;
    const [left, right] = this.legs;
    left.pivot.rotation.x = swing;
    right.pivot.rotation.x = -swing;
    for (const leg of this.legs) if (leg.foot) leg.foot.rotation.x = -leg.pivot.rotation.x;
    if (grabbing) {
      this.arms[0].rotation.x = this.arms[1].rotation.x = -1.35;
      this.arms[0].rotation.z = 0.25;
      this.arms[1].rotation.z = -0.25;
    } else {
      this.arms[0].rotation.x = -swing * 1.1;
      this.arms[1].rotation.x = swing * 1.1;
      this.arms[0].rotation.z = this.arms[1].rotation.z = 0;
    }
    this.hips.rotation.x = running ? -0.12 : grabbing ? -0.2 : 0;
    this.hips.position.y = BRASK_LEG * Math.cos(swing) + BRASK_BOOT;
  }
}

const VOLT_LEG = 0.22;

class Volt {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly tail: THREE.Mesh;

  constructor() {
    const shell = mesh(ball(0.3), VOLT.shell, 0, 0, 0);
    shell.scale.set(0.9, 0.8, 1.35);
    this.body.add(shell);
    this.body.add(mesh(box(0.04, 0.04, 0.72), VOLT.led, 0.25, 0.04, 0, VOLT.led));
    this.body.add(mesh(box(0.04, 0.04, 0.72), VOLT.led, -0.25, 0.04, 0, VOLT.led));
    const head = new THREE.Group();
    head.position.set(0, 0.2, -0.42);
    head.add(mesh(ball(0.21), VOLT.shell, 0, 0, 0));
    head.add(mesh(box(0.2, 0.12, 0.14), VOLT.shell, 0, -0.05, -0.18));
    for (const x of [-0.09, 0.09]) head.add(mesh(ball(0.055), VOLT.eye, x, 0.04, -0.18, VOLT.led));
    for (const x of [-0.13, 0.13]) {
      const ear = mesh(box(0.06, 0.16, 0.08), VOLT.joint, x, 0.2, 0.02);
      ear.rotation.z = x > 0 ? -0.3 : 0.3;
      head.add(ear);
    }
    this.body.add(head);
    this.tail = mesh(cylinder(0.025, 0.025, 0.3), VOLT.joint, 0, 0.15, 0.42);
    this.tail.add(mesh(ball(0.05), VOLT.led, 0, 0.17, 0, VOLT.led));
    this.body.add(this.tail);
    for (const [x, z] of [[-0.17, -0.22], [0.17, -0.22], [-0.17, 0.24], [0.17, 0.24]] as const) {
      const leg = new THREE.Group();
      leg.position.set(x, -0.12, z);
      leg.add(mesh(cylinder(0.065, 0.06, VOLT_LEG), VOLT.joint, 0, -VOLT_LEG / 2, 0));
      leg.add(mesh(box(0.13, 0.06, 0.16), VOLT.shell, 0, -VOLT_LEG, -0.02));
      this.body.add(leg);
      this.legs.push(leg);
    }
    this.root.add(this.body);
  }

  pose(phase: number, running: boolean, time: number): void {
    const swing = running ? Math.sin(phase) * 0.7 : 0;
    this.legs.forEach((leg, i) => {
      leg.rotation.x = i === 0 || i === 3 ? swing : -swing;
    });
    this.tail.rotation.x = 0.6 + Math.sin(time * 14) * 0.3;
    const bounce = running ? Math.abs(Math.cos(phase)) * 0.04 : Math.abs(Math.sin(time * 6)) * 0.03;
    this.body.position.y = 0.12 + VOLT_LEG * Math.cos(swing) + 0.03 + bounce;
  }
}

export interface ChaserFrame {
  phase: ChasePhase;
  gap: number;
  runnerX: number;
  runnerZ: number;
  groundY: number;
  dt: number;
  time: number;
}

const OFFSETS = { brask: { chase: -1.15, catch: -0.8 }, volt: { chase: 0.6, catch: 0.85 } };
const BRASK_SCALE = 0.88;

export class Chasers {
  readonly group = new THREE.Group();
  private readonly brask = new Brask();
  private readonly volt = new Volt();
  private stride = 0;
  private lastZ: number | null = null;
  private braskX = 0;
  private voltX = 0;

  constructor() {
    this.brask.root.name = 'Officer Brask';
    this.brask.root.scale.setScalar(BRASK_SCALE);
    this.volt.root.name = 'Volt';
    this.group.add(this.brask.root, this.volt.root);
  }

  get roots(): THREE.Object3D[] {
    return [this.brask.root, this.volt.root];
  }

  update(frame: ChaserFrame): void {
    const z = frame.runnerZ + frame.gap;
    const catching = frame.phase === 'catching' || frame.phase === 'caught';
    const caught = frame.phase === 'caught';
    const k = 1 - Math.exp(-6 * frame.dt);
    const braskTarget = frame.runnerX + (catching ? OFFSETS.brask.catch : OFFSETS.brask.chase);
    const voltTarget = frame.runnerX + (catching ? OFFSETS.volt.catch : OFFSETS.volt.chase);
    this.braskX += (braskTarget - this.braskX) * k;
    this.voltX += (voltTarget - this.voltX) * k;
    const travelled = this.lastZ === null ? 0 : Math.abs(z - this.lastZ);
    this.lastZ = z;
    this.stride += travelled;
    const visible = frame.gap < HIDE_BEYOND_GAP;
    this.group.visible = visible;
    this.brask.root.position.set(this.braskX, frame.groundY, z);
    this.volt.root.position.set(this.voltX, frame.groundY, z - 0.35);
    const running = !caught && travelled > 1e-4;
    this.brask.pose((this.stride / 2.1) * Math.PI * 2, running, caught);
    this.volt.pose((this.stride / 1.2) * Math.PI * 2, running, frame.time);
  }

  snap(): void {
    this.lastZ = null;
  }

  bounds(): { brask: THREE.Box3; volt: THREE.Box3 } {
    this.group.updateMatrixWorld(true);
    return { brask: new THREE.Box3().setFromObject(this.brask.root, true), volt: new THREE.Box3().setFromObject(this.volt.root, true) };
  }
}
