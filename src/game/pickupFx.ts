import * as THREE from 'three';
import { coinGeometry } from './pickupView';
import { sparkleTexture } from './toon';

const POP_POOL = 20;
const SPARKLE_POOL = 120;
const POP_LIFETIME = 0.32;
const SPARKLE_LIFETIME = 0.45;
const SPARKLES_PER_COIN = 6;
const SPARKLES_PER_POWER_UP = 18;

interface Pop {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
}

interface Sparkle {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  velocity: THREE.Vector3;
}

export class PickupFx {
  readonly group = new THREE.Group();
  private readonly pops: Pop[] = [];
  private readonly sparkles: Sparkle[] = [];
  private nextPop = 0;
  private nextSparkle = 0;
  coinPops = 0;
  powerUpBursts = 0;

  constructor() {
    const geometry = coinGeometry();
    for (let i = 0; i < POP_POOL; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.pops.push({ mesh, material, age: POP_LIFETIME });
    }
    const map = sparkleTexture();
    for (let i = 0; i < SPARKLE_POOL; i++) {
      const material = new THREE.SpriteMaterial({ map, color: 0xfff2a8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.group.add(sprite);
      this.sparkles.push({ sprite, material, age: SPARKLE_LIFETIME, velocity: new THREE.Vector3() });
    }
  }

  coin(x: number, y: number, z: number): void {
    this.coinPops++;
    const pop = this.pops[this.nextPop];
    this.nextPop = (this.nextPop + 1) % POP_POOL;
    pop.age = 0;
    pop.mesh.position.set(x, y, z);
    pop.mesh.visible = true;
    this.burst(x, y, z, SPARKLES_PER_COIN, 0xfff2a8, 3);
  }

  powerUp(x: number, y: number, z: number, color: number): void {
    this.powerUpBursts++;
    this.burst(x, y, z, SPARKLES_PER_POWER_UP, color, 5);
  }

  private burst(x: number, y: number, z: number, count: number, color: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.sparkles[this.nextSparkle];
      this.nextSparkle = (this.nextSparkle + 1) % SPARKLE_POOL;
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      s.age = 0;
      s.velocity.set(Math.cos(angle) * speed, 1.5 + Math.random() * speed * 0.6, Math.sin(angle) * speed * 0.5);
      s.sprite.position.set(x, y, z);
      s.material.color.setHex(color);
      s.sprite.visible = true;
    }
  }

  get activeSparkles(): number {
    return this.sparkles.filter((s) => s.sprite.visible).length;
  }

  update(dt: number, runnerZ: number, runnerZPrevious: number): void {
    const follow = runnerZ - runnerZPrevious;
    for (const pop of this.pops) {
      if (!pop.mesh.visible) continue;
      pop.age += dt;
      if (pop.age >= POP_LIFETIME) {
        pop.mesh.visible = false;
        continue;
      }
      const life = pop.age / POP_LIFETIME;
      pop.mesh.position.z += follow;
      pop.mesh.position.y += dt * 2.5;
      pop.mesh.rotation.y += dt * 20;
      pop.mesh.scale.setScalar(1 + life * 0.9);
      pop.material.opacity = 1 - life;
    }
    for (const s of this.sparkles) {
      if (!s.sprite.visible) continue;
      s.age += dt;
      if (s.age >= SPARKLE_LIFETIME) {
        s.sprite.visible = false;
        continue;
      }
      const life = s.age / SPARKLE_LIFETIME;
      s.sprite.position.addScaledVector(s.velocity, dt);
      s.sprite.position.z += follow;
      s.velocity.y -= 6 * dt;
      s.sprite.scale.setScalar(0.35 * (1 - life * 0.6));
      s.material.opacity = 1 - life;
      s.material.rotation += dt * 6;
    }
  }
}
