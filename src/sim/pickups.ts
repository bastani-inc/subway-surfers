import {
  COIN_HEIGHT,
  COIN_LOW_HEIGHT,
  COIN_RADIUS,
  COIN_SPACING,
  GRAVITY,
  JUMP_VELOCITY,
  LANES,
  MAGNET_PULL_SPEED,
  MAGNET_RADIUS,
  POWER_UP_HEIGHT,
  POWER_UP_RADIUS,
  SKY_COIN_HEIGHT,
  jumpAirtime,
} from './constants';
import { partBox } from './collision';
import { OBSTACLE_DEFS, halfLengthOf } from './obstacleDefs';
import { clampLane, laneX, type Collider } from './runner';
import { mulberry32, type Obstacle } from './spawner';

export type PowerUpKind = 'jetpack' | 'sneakers' | 'magnet' | 'multiplier';
export const POWER_UP_KINDS: readonly PowerUpKind[] = ['jetpack', 'sneakers', 'magnet', 'multiplier'];
export const POWER_UP_DURATIONS: Readonly<Record<PowerUpKind, number>> = { jetpack: 6, sneakers: 10, magnet: 10, multiplier: 12 };

export type CoinShape = 'line' | 'arc' | 'low' | 'roof' | 'sky';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface Coin extends Point3 {
  id: number;
  lane: number;
  shape: CoinShape;
  magnetized: boolean;
}

export interface PowerUpItem extends Point3 {
  id: number;
  kind: PowerUpKind;
  lane: number;
}

export interface Collected extends Point3 {
  type: 'coin' | 'powerUp';
  kind: PowerUpKind | null;
}

export const PICKUP_AHEAD = 130;
export const PICKUP_BEHIND = 6;
export const FIRST_PICKUP_DISTANCE = 30;
export const POWER_UP_MIN_GAP = 140;
const LINE_COUNT = [5, 9] as const;
const ARC_COINS = 9;
const ROOF_COIN_SPACING = 2.6;

export const distanceToCollider = (p: Point3, c: Collider): number => {
  const dx = Math.max(Math.abs(p.x - c.centerX) - c.width / 2, 0);
  const dy = Math.max(c.bottomY - p.y, p.y - (c.bottomY + c.height), 0);
  const dz = Math.max(Math.abs(p.z - c.centerZ) - c.depth / 2, 0);
  return Math.hypot(dx, dy, dz);
};

export const touches = (p: Point3, c: Collider, radius = COIN_RADIUS): boolean => distanceToCollider(p, c) <= radius;

export const colliderCenter = (c: Collider): Point3 => ({ x: c.centerX, y: c.bottomY + c.height / 2, z: c.centerZ });

export const attract = (coin: Point3, target: Point3, dt: number, pullSpeed = MAGNET_PULL_SPEED): void => {
  const dx = target.x - coin.x;
  const dy = target.y - coin.y;
  const dz = target.z - coin.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-9) return;
  const step = Math.min(distance, pullSpeed * dt) / distance;
  coin.x += dx * step;
  coin.y += dy * step;
  coin.z += dz * step;
};

export const arcHeights = (count: number, velocity = JUMP_VELOCITY, gravity = GRAVITY): { t: number; y: number }[] => {
  const airtime = jumpAirtime(velocity, gravity);
  return Array.from({ length: count }, (_, i) => {
    const t = (airtime * (i + 0.5)) / count;
    return { t, y: velocity * t - 0.5 * gravity * t * t };
  });
};

export class Pickups {
  readonly coins: Coin[] = [];
  readonly items: PowerUpItem[] = [];
  readonly collected: Collected[] = [];
  private readonly free: Coin[] = [];
  private rng: () => number;
  private nextId = 1;
  nextZ = -FIRST_PICKUP_DISTANCE;
  nextPowerUpZ = -FIRST_PICKUP_DISTANCE - 60;
  created = 0;
  spawned = 0;
  recycled = 0;
  coinsCollected = 0;
  itemsCollected = 0;
  readonly shapeCounts: Record<CoinShape | 'powerUp', number> = { line: 0, arc: 0, low: 0, roof: 0, sky: 0, powerUp: 0 };

  constructor(
    private seed: number,
    public enabled = true,
  ) {
    this.rng = mulberry32(seed ^ 0x5eed);
  }

  reset(seed = this.seed): void {
    while (this.coins.length) this.release(0);
    this.items.length = 0;
    this.collected.length = 0;
    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x5eed);
    this.nextZ = -FIRST_PICKUP_DISTANCE;
    this.nextPowerUpZ = -FIRST_PICKUP_DISTANCE - 60;
    this.coinsCollected = 0;
    this.itemsCollected = 0;
  }

  get pooled(): number {
    return this.free.length;
  }

  spawnCoin(lane: number, y: number, z: number, shape: CoinShape): Coin {
    const coin = this.free.pop() ?? this.allocate();
    coin.id = this.nextId++;
    coin.lane = lane;
    coin.x = laneX(lane);
    coin.y = y;
    coin.z = z;
    coin.shape = shape;
    coin.magnetized = false;
    this.coins.push(coin);
    this.spawned++;
    return coin;
  }

  spawnLine(lane: number, nearZ: number, count: number, y = COIN_HEIGHT, shape: CoinShape = 'line'): number {
    for (let i = 0; i < count; i++) this.spawnCoin(lane, y, nearZ - i * COIN_SPACING, shape);
    this.shapeCounts[shape]++;
    return nearZ - (count - 1) * COIN_SPACING;
  }

  spawnArc(lane: number, centerZ: number, speed: number, baseY = 0): number {
    const airtime = jumpAirtime();
    const startZ = centerZ + (speed * airtime) / 2;
    for (const { t, y } of arcHeights(ARC_COINS)) this.spawnCoin(lane, baseY + COIN_HEIGHT + y, startZ - speed * t, 'arc');
    this.shapeCounts.arc++;
    return startZ - speed * airtime;
  }

  spawnSkyTrail(startLane: number, nearZ: number, length: number): number {
    let lane = startLane;
    let z = nearZ;
    let run = 0;
    while (z > nearZ - length) {
      this.spawnCoin(lane, SKY_COIN_HEIGHT, z, 'sky');
      z -= COIN_SPACING;
      if (++run >= 8) {
        run = 0;
        const step = this.rng() < 0.5 ? -1 : 1;
        lane = clampLane(lane + step) === lane ? lane - step : clampLane(lane + step);
      }
    }
    this.shapeCounts.sky++;
    return z;
  }

  spawnItem(kind: PowerUpKind, lane: number, z: number, baseY = 0): PowerUpItem {
    const item: PowerUpItem = { id: this.nextId++, kind, lane, x: laneX(lane), y: baseY + POWER_UP_HEIGHT, z };
    this.items.push(item);
    this.shapeCounts.powerUp++;
    return item;
  }

  clear(): void {
    while (this.coins.length) this.release(0);
    this.items.length = 0;
  }

  private allocate(): Coin {
    this.created++;
    return { id: 0, lane: 0, x: 0, y: 0, z: 0, shape: 'line', magnetized: false };
  }

  private release(index: number): void {
    const [coin] = this.coins.splice(index, 1);
    this.free.push(coin);
    this.recycled++;
  }

  update(runnerZ: number, speed: number, obstacles: readonly Obstacle[], allowJetpack: boolean): void {
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (!coin.magnetized && coin.z > runnerZ + PICKUP_BEHIND) this.release(i);
    }
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].z > runnerZ + PICKUP_BEHIND) this.items.splice(i, 1);
    if (!this.enabled) return;
    while (this.nextZ > runnerZ - PICKUP_AHEAD) {
      const far = this.placeGroup(this.nextZ, speed, obstacles, allowJetpack);
      this.nextZ = far - (10 + this.rng() * 16);
    }
  }

  collect(collider: Collider, magnet: boolean, dt: number): Collected[] {
    const found: Collected[] = [];
    const center = colliderCenter(collider);
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (magnet && !coin.magnetized && Math.hypot(coin.x - center.x, coin.y - center.y, coin.z - center.z) <= MAGNET_RADIUS) coin.magnetized = true;
      if (coin.magnetized) attract(coin, center, dt);
      if (!touches(coin, collider)) continue;
      found.push({ type: 'coin', kind: null, x: coin.x, y: coin.y, z: coin.z });
      this.coinsCollected++;
      this.release(i);
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (!touches(item, collider, POWER_UP_RADIUS)) continue;
      found.push({ type: 'powerUp', kind: item.kind, x: item.x, y: item.y, z: item.z });
      this.itemsCollected++;
      this.items.splice(i, 1);
    }
    this.collected.push(...found);
    return found;
  }

  drainCollected(): Collected[] {
    return this.collected.splice(0);
  }

  private shuffledLanes(): number[] {
    const lanes = [...LANES] as number[];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    return lanes;
  }

  private placeGroup(nearZ: number, speed: number, obstacles: readonly Obstacle[], allowJetpack: boolean): number {
    const count = LINE_COUNT[0] + Math.floor(this.rng() * (LINE_COUNT[1] - LINE_COUNT[0] + 1));
    const span = (count - 1) * COIN_SPACING;
    for (const lane of this.shuffledLanes()) {
      if (obstacles.some((o) => o.lane === lane && o.oncoming && o.z < nearZ + 4)) continue;
      const inLane = obstacles.filter(
        (o) => o.lane === lane && o.z + halfLengthOf(o.kind) > nearZ - span - 3 && o.z - halfLengthOf(o.kind) < nearZ + 3,
      );
      if (inLane.length === 0) {
        if (nearZ <= this.nextPowerUpZ && this.rng() < 0.35) {
          const kinds = allowJetpack ? POWER_UP_KINDS : POWER_UP_KINDS.filter((k) => k !== 'jetpack');
          this.spawnItem(kinds[Math.floor(this.rng() * kinds.length)], lane, nearZ);
          this.nextPowerUpZ = nearZ - POWER_UP_MIN_GAP;
          return this.spawnLine(lane, nearZ - COIN_SPACING * 2, Math.max(3, count - 3));
        }
        if (this.rng() < 0.25 && speed > 0) return this.spawnArc(lane, nearZ - (speed * jumpAirtime()) / 2, speed);
        return this.spawnLine(lane, nearZ, count);
      }
      if (inLane.every((o) => o.kind === 'barrierLow') && inLane.length === 1) return this.spawnArc(lane, inLane[0].z, speed);
      if (inLane.every((o) => o.kind === 'barrierHigh')) {
        const center = inLane[0].z;
        return this.spawnLine(lane, center + 2 * COIN_SPACING, 5, COIN_LOW_HEIGHT, 'low');
      }
      const ramp = inLane.find((o) => o.kind === 'rampCar' && !o.oncoming);
      if (ramp && inLane.every((o) => (o.kind === 'train' || o.kind === 'rampCar') && !o.oncoming)) return this.roofTrail(lane, ramp, obstacles);
    }
    return nearZ - 8;
  }

  private roofTrail(lane: number, ramp: Obstacle, obstacles: readonly Obstacle[]): number {
    const cars = obstacles.filter((o) => o.lane === lane && !o.oncoming && (o.kind === 'train' || o.kind === 'rampCar'));
    let near = ramp.z + halfLengthOf(ramp.kind) - 2;
    let far = ramp.z - halfLengthOf(ramp.kind);
    for (let extended = true; extended; ) {
      extended = false;
      for (const car of cars) {
        const carNear = car.z + halfLengthOf(car.kind);
        if (carNear >= far - 1 && car.z - halfLengthOf(car.kind) < far - 0.5) {
          far = car.z - halfLengthOf(car.kind);
          extended = true;
        }
      }
    }
    for (let z = near; z > far + 1; z -= ROOF_COIN_SPACING) this.spawnCoin(lane, this.surfaceAt(cars, z) + COIN_HEIGHT, z, 'roof');
    this.shapeCounts.roof++;
    near = far;
    return near;
  }

  private surfaceAt(cars: readonly Obstacle[], z: number): number {
    let top = 0;
    for (const car of cars)
      for (const part of OBSTACLE_DEFS[car.kind].parts) {
        const box = partBox(part, car.x, car.z, z);
        if (z >= box.minZ && z <= box.maxZ) top = Math.max(top, box.maxY);
      }
    return top;
  }
}
