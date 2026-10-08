import * as THREE from 'three';
import type { Coin, PowerUpItem, PowerUpKind } from '../sim/pickups';
import { glowTexture, multiplierTokenTexture, toonMaterial } from './toon';

const MAX_COINS = 480;
const COIN_SPIN = 4.5;

export const POWER_UP_COLORS: Readonly<Record<PowerUpKind, number>> = {
  jetpack: 0xff7a1a,
  sneakers: 0x39ff6a,
  magnet: 0xff2f5a,
  multiplier: 0xb07bff,
};

const boltShape = (): THREE.Shape => {
  const s = new THREE.Shape();
  s.moveTo(0.05, 0.2);
  s.lineTo(-0.1, -0.02);
  s.lineTo(0.0, -0.02);
  s.lineTo(-0.05, -0.2);
  s.lineTo(0.1, 0.03);
  s.lineTo(0.0, 0.03);
  s.closePath();
  return s;
};

export const coinGeometry = (): THREE.BufferGeometry => new THREE.CylinderGeometry(0.3, 0.3, 0.1, 6).rotateX(Math.PI / 2).rotateZ(Math.PI / 6);

const boltGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.ExtrudeGeometry(boltShape(), { depth: 0.13, bevelEnabled: false });
  geometry.translate(0, 0, -0.065);
  return geometry;
};

const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

const powerUpModel = (kind: PowerUpKind): THREE.Group => {
  const group = new THREE.Group();
  const color = POWER_UP_COLORS[kind];
  if (kind === 'jetpack') {
    const shell = toonMaterial(0xd8dde8, 0x223344, 0.2);
    const accent = toonMaterial(color, color, 0.5);
    group.add(mesh(new THREE.BoxGeometry(0.42, 0.5, 0.18), accent));
    for (const x of [-0.17, 0.17]) {
      group.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.56, 14), shell, x, 0, 0.12));
      group.add(mesh(new THREE.ConeGeometry(0.1, 0.18, 14).rotateX(Math.PI), accent, x, -0.36, 0.12));
    }
  } else if (kind === 'sneakers') {
    const sole = toonMaterial(0xffffff);
    const upper = toonMaterial(color, color, 0.45);
    const spring = toonMaterial(0x2fb8ff, 0x2fb8ff, 0.6);
    group.add(mesh(new THREE.BoxGeometry(0.28, 0.22, 0.5), upper, 0, 0.1, 0));
    group.add(mesh(new THREE.BoxGeometry(0.28, 0.24, 0.22), upper, 0, 0.3, 0.12));
    group.add(mesh(new THREE.BoxGeometry(0.32, 0.07, 0.56), sole, 0, -0.04, 0));
    group.add(mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 16).rotateX(Math.PI / 2), spring, 0, -0.14, 0.1));
    group.add(mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 16).rotateX(Math.PI / 2), spring, 0, -0.2, 0.1));
  } else if (kind === 'magnet') {
    const body = toonMaterial(color, color, 0.45);
    const tips = toonMaterial(0xe8f6ff, 0x18d6c4, 0.7);
    group.add(mesh(new THREE.TorusGeometry(0.22, 0.08, 12, 24, Math.PI), body));
    for (const x of [-0.22, 0.22]) group.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 12), tips, x, -0.07, 0));
  } else {
    const face = new THREE.MeshToonMaterial({ map: multiplierTokenTexture(), emissive: 0x3a1a7a, emissiveIntensity: 0.4 });
    const rim = toonMaterial(0xffd21a, 0xffa000, 0.5);
    group.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 32).rotateX(Math.PI / 2), [rim, face, face]));
  }
  return group;
};

interface ItemMesh {
  kind: PowerUpKind;
  root: THREE.Group;
  model: THREE.Group;
  halo: THREE.Sprite;
  ring: THREE.Mesh;
}

export class PickupView {
  readonly group = new THREE.Group();
  readonly coins: THREE.InstancedMesh;
  private readonly bolts: THREE.InstancedMesh;
  private readonly coinShadows: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly euler = new THREE.Euler();
  private readonly glow = glowTexture();
  private readonly itemPool = new Map<PowerUpKind, ItemMesh[]>();
  private readonly bound = new Map<number, ItemMesh>();
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  itemsBuilt = 0;

  constructor() {
    this.coins = new THREE.InstancedMesh(coinGeometry(), toonMaterial(0xffc21a, 0xff9a00, 0.45), MAX_COINS);
    this.bolts = new THREE.InstancedMesh(boltGeometry(), toonMaterial(0xfff2a8, 0xffe14a, 0.6), MAX_COINS);
    this.shadowMaterial = new THREE.MeshBasicMaterial({ map: this.glow, color: 0x14002a, transparent: true, opacity: 0.45, depthWrite: false });
    this.coinShadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.7).rotateX(-Math.PI / 2), this.shadowMaterial, MAX_COINS);
    for (const m of [this.coins, this.bolts, this.coinShadows]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
    }
    this.coins.castShadow = true;
    this.coinShadows.renderOrder = 1;
    this.group.add(this.coins, this.bolts, this.coinShadows);
  }

  get coinsDrawn(): number {
    return this.coins.count;
  }

  sync(coins: readonly Coin[], items: readonly PowerUpItem[], time: number, groundAt: (coin: Coin) => number): void {
    const n = Math.min(coins.length, MAX_COINS);
    for (let i = 0; i < n; i++) {
      const c = coins[i];
      this.euler.set(0, time * COIN_SPIN + c.id * 0.4, 0);
      this.quaternion.setFromEuler(this.euler);
      this.position.set(c.x, c.y, c.z);
      this.scale.setScalar(1);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.coins.setMatrixAt(i, this.matrix);
      this.bolts.setMatrixAt(i, this.matrix);
      this.quaternion.identity();
      this.position.set(c.x, groundAt(c) + 0.02, c.z);
      this.scale.setScalar(Math.max(0.2, 1 - (c.y - groundAt(c)) * 0.15));
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.coinShadows.setMatrixAt(i, this.matrix);
    }
    for (const m of [this.coins, this.bolts, this.coinShadows]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    this.syncItems(items, time);
  }

  private syncItems(items: readonly PowerUpItem[], time: number): void {
    const live = new Set<number>();
    for (const item of items) {
      live.add(item.id);
      let view = this.bound.get(item.id);
      if (!view) {
        view = this.acquire(item.kind);
        this.bound.set(item.id, view);
      }
      const bob = Math.sin(time * 3 + item.id) * 0.12;
      view.root.position.set(item.x, 0, item.z);
      view.model.position.y = item.y + bob;
      view.model.rotation.y = time * 2.2;
      const pulse = 1 + Math.sin(time * 6 + item.id) * 0.12;
      view.halo.position.y = item.y + bob;
      view.halo.scale.setScalar(1.7 * pulse);
      (view.halo.material as THREE.SpriteMaterial).opacity = 0.75 + 0.2 * Math.sin(time * 6);
      view.ring.scale.setScalar(pulse);
    }
    for (const [id, view] of this.bound) {
      if (live.has(id)) continue;
      this.bound.delete(id);
      view.root.visible = false;
      this.itemPool.get(view.kind)?.push(view);
    }
  }

  private acquire(kind: PowerUpKind): ItemMesh {
    const pooled = this.itemPool.get(kind)?.pop();
    if (pooled) {
      pooled.root.visible = true;
      return pooled;
    }
    this.itemsBuilt++;
    const color = POWER_UP_COLORS[kind];
    const root = new THREE.Group();
    const model = powerUpModel(kind);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.6, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.position.y = 0.03;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMaterial);
    shadow.position.y = 0.02;
    root.add(model, halo, ring, shadow);
    this.group.add(root);
    if (!this.itemPool.has(kind)) this.itemPool.set(kind, []);
    return { kind, root, model, halo, ring };
  }

  itemsGlow(): boolean {
    return [...this.bound.values()].every((v) => v.halo.visible && (v.halo.material as THREE.SpriteMaterial).blending === THREE.AdditiveBlending);
  }
}
