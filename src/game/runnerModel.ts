import * as THREE from 'three';
import { ROLL_DURATION, ROLL_HEIGHT, STRIDE_LENGTH } from '../sim/constants';
import { toonMaterial } from './toon';

const SHOE_HALF_HEIGHT = 0.08;
const SHOE_CENTER_DEPTH = 0.82;
const HIP_HEIGHT = SHOE_CENTER_DEPTH + SHOE_HALF_HEIGHT;
const SWING = 0.65;
const ROLL_CLEARANCE = 0.03;
const ROLL_DIAMETER = ROLL_HEIGHT - ROLL_CLEARANCE;
const TUCK = { hipTilt: -0.95, legs: 2.45, arms: 2.1, armSpread: 0.35 };
const MAX_LEAN = 0.22;
const LEAN_PER_VELOCITY = 0.012;

const COLORS = {
  skin: 0xd99a72,
  jacket: 0xff7a1a,
  reflective: 0xf4fbff,
  shorts: 0x15151c,
  kneePad: 0x2b2f3a,
  hair: 0x18d6c4,
  shoe: 0xf6f6f6,
  led: 0x00f0ff,
};

const part = (geometry: THREE.BufferGeometry, color: number, x: number, y: number, z = 0, emissive = 0x000000): THREE.Mesh => {
  const mesh = new THREE.Mesh(geometry, toonMaterial(color, emissive));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
};

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const ball = (r: number) => new THREE.SphereGeometry(r, 16, 12);

export interface RunnerPose {
  x: number;
  y: number;
  z: number;
  distance: number;
  grounded: boolean;
  vy: number;
  rollTimeLeft: number;
  lateralVelocity: number;
  ready: boolean;
  time: number;
  groundY: number;
  stumble: number;
  fall: number;
  crashed: boolean;
  flying: boolean;
}

interface Leg {
  pivot: THREE.Group;
  shoe: THREE.Group;
}

export class RunnerModel {
  readonly root = new THREE.Group();
  readonly blobShadow: THREE.Mesh;
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly leftLeg: Leg;
  private readonly rightLeg: Leg;
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly tuckCentroid = new THREE.Vector3();
  private tuckScale = 1;
  private readonly vertex = new THREE.Vector3();

  constructor() {
    this.leftLeg = this.makeLeg(-0.13);
    this.rightLeg = this.makeLeg(0.13);
    this.makeArm(this.leftArm, -1);
    this.makeArm(this.rightArm, 1);

    const torso = part(box(0.5, 0.42, 0.3), COLORS.jacket, 0, 0.23);
    const stripe = part(box(0.51, 0.05, 0.31), COLORS.reflective, 0, 0.18, 0, 0x8899aa);
    const shorts = part(box(0.46, 0.16, 0.28), COLORS.shorts, 0, 0.0);
    const neck = part(box(0.1, 0.06, 0.1), COLORS.skin, 0, 0.47);
    const head = part(ball(0.2), COLORS.skin, 0, 0.66);
    const hairCap = part(ball(0.215), COLORS.hair, 0, 0.7, 0.02);
    hairCap.scale.set(1, 0.85, 1);
    const bob = part(box(0.12, 0.26, 0.34), COLORS.hair, 0.15, 0.6, 0.02);

    this.hips.add(torso, stripe, shorts, neck, head, hairCap, bob, this.leftArm, this.rightArm, this.leftLeg.pivot, this.rightLeg.pivot);
    this.body.add(this.hips);
    this.root.add(this.body);

    this.blobShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 32),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }),
    );
    this.blobShadow.rotation.x = -Math.PI / 2;
    this.blobShadow.renderOrder = 1;
    this.measureTuck();
  }

  private applyTuck(): void {
    this.setLimbs(TUCK.legs, TUCK.legs, TUCK.arms, TUCK.arms, TUCK.hipTilt);
    this.leftArm.rotation.z = -TUCK.armSpread;
    this.rightArm.rotation.z = TUCK.armSpread;
  }

  private measureTuck(): void {
    this.applyTuck();
    this.hips.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.hips, true);
    bounds.getCenter(this.tuckCentroid);
    let radius = 0;
    this.forEachVertex(this.hips, (v) => {
      radius = Math.max(radius, Math.hypot(v.y - this.tuckCentroid.y, v.z - this.tuckCentroid.z));
    });
    this.tuckScale = ROLL_DIAMETER / 2 / radius;
    this.setLimbs(0, 0, 0, 0, 0);
  }

  private forEachVertex(object: THREE.Object3D, visit: (v: THREE.Vector3) => void): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) visit(this.vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld));
    });
  }

  private lowestPointAboveRoot(): number {
    this.root.updateMatrixWorld(true);
    let minY = Infinity;
    this.forEachVertex(this.body, (v) => {
      minY = Math.min(minY, v.y);
    });
    return minY - this.root.position.y;
  }

  private makeLeg(x: number): Leg {
    const pivot = new THREE.Group();
    pivot.position.x = x;
    pivot.add(part(box(0.18, 0.4, 0.2), COLORS.shorts, 0, -0.18));
    pivot.add(part(box(0.15, 0.36, 0.15), COLORS.skin, 0, -0.56));
    pivot.add(part(box(0.18, 0.14, 0.08), COLORS.kneePad, 0, -0.44, -0.09));
    const shoe = new THREE.Group();
    shoe.position.y = -SHOE_CENTER_DEPTH;
    shoe.add(part(box(0.24, SHOE_HALF_HEIGHT * 2, 0.4), COLORS.shoe, 0, 0, -0.07));
    shoe.add(part(box(0.25, 0.04, 0.41), COLORS.led, 0, -SHOE_HALF_HEIGHT + 0.02, -0.07, COLORS.led));
    pivot.add(shoe);
    return { pivot, shoe };
  }

  private makeArm(pivot: THREE.Group, side: -1 | 1): void {
    pivot.position.set(side * 0.31, 0.42, 0);
    pivot.add(part(box(0.15, 0.3, 0.16), COLORS.jacket, 0, -0.14));
    pivot.add(part(box(0.11, 0.24, 0.11), COLORS.skin, 0, -0.38));
    pivot.add(part(ball(0.09), COLORS.skin, 0, -0.54));
  }

  update(pose: RunnerPose): void {
    this.root.position.set(pose.x, pose.y, pose.z);
    const lean = THREE.MathUtils.clamp(-pose.lateralVelocity * LEAN_PER_VELOCITY, -MAX_LEAN, MAX_LEAN);
    this.root.rotation.z = (pose.rollTimeLeft > 0 && !pose.ready) || pose.crashed ? 0 : lean;
    this.root.rotation.x = 0;
    this.blobShadow.position.set(pose.x, pose.groundY + 0.015, pose.z);
    const fade = 1 / (1 + Math.max(0, pose.y - pose.groundY) * 0.6);
    this.blobShadow.scale.setScalar(fade);
    (this.blobShadow.material as THREE.MeshBasicMaterial).opacity = 0.75 * fade;

    if (pose.ready) this.poseReady(pose.time);
    else if (pose.crashed) this.poseFall(pose.fall, pose.time);
    else if (pose.stumble > 0 && pose.grounded) this.poseStumble(pose.stumble, pose.distance);
    else if (pose.rollTimeLeft > 0) this.poseRoll(1 - pose.rollTimeLeft / ROLL_DURATION);
    else if (pose.flying) this.poseFly(pose.time);
    else if (!pose.grounded) this.poseAir(pose.vy);
    else this.poseRun(pose.distance);
  }

  private setLimbs(leftLeg: number, rightLeg: number, leftArm: number, rightArm: number, tilt: number): void {
    this.hips.rotation.x = tilt;
    this.leftLeg.pivot.rotation.x = leftLeg;
    this.rightLeg.pivot.rotation.x = rightLeg;
    this.leftLeg.shoe.rotation.x = -(leftLeg + tilt);
    this.rightLeg.shoe.rotation.x = -(rightLeg + tilt);
    this.leftArm.rotation.x = leftArm;
    this.rightArm.rotation.x = rightArm;
    this.leftArm.rotation.z = 0;
    this.rightArm.rotation.z = 0;
    this.hips.scale.setScalar(1);
    this.hips.position.set(0, 0, 0);
    this.body.rotation.x = 0;
    this.body.position.y = 0;
  }

  private plantedHipHeight(leftLeg: number, rightLeg: number, tilt: number): number {
    const reach = Math.max(Math.cos(leftLeg + tilt), Math.cos(rightLeg + tilt));
    return SHOE_CENTER_DEPTH * reach + SHOE_HALF_HEIGHT;
  }

  private poseReady(time: number): void {
    const breathe = Math.sin(time * 2.4) * 0.04;
    const tilt = -0.05;
    this.setLimbs(-0.08, 0.08, 0.15 + breathe, -0.15 - breathe, tilt);
    this.leftArm.rotation.z = -0.18;
    this.rightArm.rotation.z = 0.18;
    this.hips.position.y = this.plantedHipHeight(-0.08, 0.08, tilt);
  }

  private poseRun(distance: number): void {
    const phase = (distance / STRIDE_LENGTH) * Math.PI * 2;
    const swing = Math.sin(phase) * SWING;
    const tilt = -0.12;
    this.setLimbs(swing, -swing, -swing * 1.1, swing * 1.1, tilt);
    this.hips.position.y = this.plantedHipHeight(swing, -swing, tilt);
  }

  private poseStumble(progress: number, distance: number): void {
    const phase = (distance / STRIDE_LENGTH) * Math.PI * 2;
    const swing = Math.sin(phase) * SWING * 0.6;
    const pitch = Math.sin(progress * Math.PI);
    const tilt = -0.12 - 0.4 * pitch;
    this.setLimbs(swing, -swing, -2.2 * pitch, -1.6 * pitch, tilt);
    this.leftArm.rotation.z = -0.6 * pitch;
    this.rightArm.rotation.z = 0.6 * pitch;
    this.hips.position.y = this.plantedHipHeight(swing, -swing, tilt);
  }

  private poseFall(fall: number, time: number): void {
    const flail = Math.sin(time * 18) * 0.3 * (1 - fall);
    this.setLimbs(-0.5 * fall, 0.3 * fall, -2.4 + flail, -2.1 - flail, 0);
    this.leftArm.rotation.z = -0.5;
    this.rightArm.rotation.z = 0.5;
    this.hips.position.y = HIP_HEIGHT;
    this.root.rotation.x = fall * (Math.PI / 2 - 0.12);
    const lowest = this.lowestPointAboveRoot();
    if (lowest < 0) this.root.position.y -= lowest;
  }

  private poseFly(time: number): void {
    const kick = Math.sin(time * 9) * 0.12;
    this.setLimbs(-0.25 + kick, -0.25 - kick, 0.45, 0.45, -0.3);
    this.leftArm.rotation.z = -0.35;
    this.rightArm.rotation.z = 0.35;
    this.hips.position.y = HIP_HEIGHT;
  }

  private poseAir(vy: number): void {
    const tuck = THREE.MathUtils.clamp(0.4 + vy * 0.03, 0.1, 0.8);
    this.setLimbs(-tuck, tuck * 0.6, -1.2 - tuck, 0.6, -0.15);
    this.hips.position.y = HIP_HEIGHT;
  }

  private poseRoll(progress: number): void {
    this.applyTuck();
    this.hips.scale.setScalar(this.tuckScale);
    this.hips.position.copy(this.tuckCentroid).multiplyScalar(-this.tuckScale);
    this.body.rotation.x = -progress * Math.PI * 2;
    this.body.position.y = ROLL_DIAMETER / 2;
    const lowest = this.lowestPointAboveRoot();
    this.body.position.y -= lowest;
  }
}

const blobTexture = (): THREE.Texture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(20,0,40,0.9)');
    gradient.addColorStop(0.6, 'rgba(20,0,40,0.45)');
    gradient.addColorStop(1, 'rgba(20,0,40,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};
