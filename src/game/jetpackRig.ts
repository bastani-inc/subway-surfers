import * as THREE from 'three';
import { glowTexture, toonMaterial } from './toon';

const BACK_HEIGHT = 1.12;
const BACK_OFFSET = 0.24;

export class JetpackRig {
  readonly group = new THREE.Group();
  private readonly flames: THREE.Mesh[] = [];
  private readonly glow: THREE.Sprite;

  constructor() {
    const shell = toonMaterial(0xd8dde8, 0x223344, 0.2);
    const accent = toonMaterial(0xff7a1a, 0xff7a1a, 0.5);
    const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffb13a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.14), accent);
    pack.castShadow = true;
    this.group.add(pack);
    for (const x of [-0.15, 0.15]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.48, 12), shell);
      tank.position.set(x, 0, 0.1);
      tank.castShadow = true;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 12).rotateX(Math.PI), flameMaterial);
      flame.position.set(x, -0.5, 0.1);
      this.flames.push(flame);
      this.group.add(tank, flame);
    }
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff8a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.position.set(0, -0.6, 0.1);
    this.glow.scale.setScalar(1.2);
    this.group.add(this.glow);
    this.group.visible = false;
  }

  update(visible: boolean, x: number, y: number, z: number, lean: number, time: number): void {
    this.group.visible = visible;
    if (!visible) return;
    this.group.position.set(x, y + BACK_HEIGHT, z + BACK_OFFSET);
    this.group.rotation.z = lean;
    for (const [i, flame] of this.flames.entries()) flame.scale.y = 0.8 + 0.35 * Math.abs(Math.sin(time * 31 + i * 1.7));
    this.glow.scale.setScalar(1.1 + 0.2 * Math.sin(time * 23));
  }
}
