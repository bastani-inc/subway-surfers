import * as THREE from 'three';

const POOL_SIZE = 24;
const PUFFS_PER_LANDING = 8;
const LIFETIME = 0.45;

interface Puff {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  vx: number;
  vy: number;
  vz: number;
}

export class DustBursts {
  readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private next = 0;
  bursts = 0;

  constructor() {
    const geometry = new THREE.IcosahedronGeometry(0.12, 0);
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffe2c4, transparent: true, depthWrite: false, opacity: 0 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.puffs.push({ mesh, material, age: LIFETIME, vx: 0, vy: 0, vz: 0 });
    }
  }

  emit(x: number, z: number, y = 0): void {
    this.bursts++;
    for (let i = 0; i < PUFFS_PER_LANDING; i++) {
      const puff = this.puffs[this.next];
      this.next = (this.next + 1) % POOL_SIZE;
      const angle = (i / PUFFS_PER_LANDING) * Math.PI * 2;
      puff.age = 0;
      puff.vx = Math.cos(angle) * 1.6;
      puff.vz = Math.sin(angle) * 1.6;
      puff.vy = 0.9;
      puff.mesh.position.set(x + Math.cos(angle) * 0.2, y + 0.08, z + Math.sin(angle) * 0.2);
      puff.mesh.visible = true;
    }
  }

  get active(): number {
    return this.puffs.filter((p) => p.mesh.visible).length;
  }

  update(dt: number): void {
    for (const puff of this.puffs) {
      if (!puff.mesh.visible) continue;
      puff.age += dt;
      if (puff.age >= LIFETIME) {
        puff.mesh.visible = false;
        continue;
      }
      const life = puff.age / LIFETIME;
      puff.mesh.position.x += puff.vx * dt;
      puff.mesh.position.y += puff.vy * dt;
      puff.mesh.position.z += puff.vz * dt;
      puff.vy *= 0.9;
      puff.mesh.scale.setScalar(1 + life * 2.2);
      puff.material.opacity = 0.7 * (1 - life);
    }
  }
}
