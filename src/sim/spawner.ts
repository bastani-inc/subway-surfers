import {
  LANES,
  ONCOMING_ACTIVATION_DISTANCE,
  ONCOMING_CLEARANCE,
  ONCOMING_SPEED,
  TRAIN_COUPLING_GAP,
  TRAIN_LENGTH,
} from './constants';
import { halfLengthOf, type ObstacleKind } from './obstacleDefs';
import { laneX } from './runner';

export const SPAWN_AHEAD = 160;
export const DESPAWN_BEHIND = 15;
export const FIRST_PATTERN_DISTANCE = 70;
export const ONCOMING_MIN_DISTANCE = 150;

export type PatternName = 'trainGroup' | 'barrierRow' | 'barrierPair' | 'mixed';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: number;
  x: number;
  z: number;
  prevZ: number;
  oncoming: boolean;
  moving: boolean;
  scrapeCooldown: number;
  passThrough: boolean;
  pattern: PatternName | 'debug';
}

export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const CAR_PITCH = TRAIN_LENGTH + TRAIN_COUPLING_GAP;

export const patternGap = (speed: number): number => 18 + speed * 0.9;

export class Spawner {
  readonly active: Obstacle[] = [];
  private readonly free: Obstacle[] = [];
  private rng: () => number;
  private nextId = 1;
  nextZ = -FIRST_PATTERN_DISTANCE;
  created = 0;
  spawned = 0;
  recycled = 0;
  lastPattern: PatternName | null = null;
  readonly patternCounts: Record<PatternName, number> = { trainGroup: 0, barrierRow: 0, barrierPair: 0, mixed: 0 };

  constructor(
    private seed: number,
    public enabled = true,
  ) {
    this.rng = mulberry32(seed);
  }

  reset(seed = this.seed): void {
    while (this.active.length) this.release(0);
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.nextZ = -FIRST_PATTERN_DISTANCE;
    this.lastPattern = null;
  }

  get pooled(): number {
    return this.free.length;
  }

  spawn(kind: ObstacleKind, lane: number, z: number, oncoming = false, pattern: Obstacle['pattern'] = 'debug'): Obstacle {
    const obstacle = this.free.pop() ?? this.allocate();
    obstacle.id = this.nextId++;
    obstacle.kind = kind;
    obstacle.lane = lane;
    obstacle.x = laneX(lane);
    obstacle.z = z;
    obstacle.prevZ = z;
    obstacle.oncoming = oncoming;
    obstacle.moving = false;
    obstacle.scrapeCooldown = 0;
    obstacle.passThrough = false;
    obstacle.pattern = pattern;
    this.active.push(obstacle);
    this.spawned++;
    return obstacle;
  }

  private allocate(): Obstacle {
    this.created++;
    return { id: 0, kind: 'train', lane: 0, x: 0, z: 0, prevZ: 0, oncoming: false, moving: false, scrapeCooldown: 0, passThrough: false, pattern: 'debug' };
  }

  private release(index: number): void {
    const [obstacle] = this.active.splice(index, 1);
    this.free.push(obstacle);
    this.recycled++;
  }

  update(runnerZ: number, speed: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      if (o.z - halfLengthOf(o.kind) > runnerZ + DESPAWN_BEHIND) this.release(i);
    }
    if (!this.enabled) return;
    while (this.nextZ > runnerZ - SPAWN_AHEAD) {
      const far = this.placePattern(this.nextZ);
      this.nextZ = far - patternGap(speed);
    }
  }

  moveObstacles(runnerZ: number, dt: number): void {
    for (const o of this.active) {
      o.prevZ = o.z;
      if (o.scrapeCooldown > 0) o.scrapeCooldown = Math.max(0, o.scrapeCooldown - dt);
      if (!o.oncoming) continue;
      if (!o.moving && o.z + halfLengthOf(o.kind) > runnerZ - ONCOMING_ACTIVATION_DISTANCE) o.moving = true;
      if (o.moving) o.z += ONCOMING_SPEED * dt;
    }
  }

  laneClearAhead(lane: number, nearZ: number, clearance: number): boolean {
    return this.active.every((o) => o.lane !== lane || o.z - halfLengthOf(o.kind) - nearZ >= clearance);
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  private shuffledLanes(): number[] {
    const lanes = [...LANES] as number[];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    }
    return lanes;
  }

  private placeCars(lane: number, nearZ: number, count: number, pattern: PatternName): number {
    let far = nearZ;
    for (let i = 0; i < count; i++) {
      this.spawn('train', lane, far - TRAIN_LENGTH / 2, false, pattern);
      far -= i === count - 1 ? TRAIN_LENGTH : CAR_PITCH;
    }
    return far;
  }

  private placePattern(nearZ: number): number {
    const roll = this.rng();
    const pattern: PatternName = roll < 0.45 ? 'trainGroup' : roll < 0.7 ? 'barrierRow' : roll < 0.82 ? 'barrierPair' : 'mixed';
    this.lastPattern = pattern;
    this.patternCounts[pattern]++;
    if (pattern === 'trainGroup') return this.trainGroup(nearZ);
    if (pattern === 'barrierRow') return this.barrierRow(nearZ, pattern);
    if (pattern === 'barrierPair') return this.barrierRow(this.barrierRow(nearZ, pattern) - 14, pattern);
    return this.mixed(nearZ);
  }

  private trainGroup(nearZ: number): number {
    const lanes = this.shuffledLanes();
    const rampLane = this.rng() < 0.6 ? lanes[0] : null;
    let farthest = nearZ;
    let openLanes = 0;
    lanes.forEach((lane, index) => {
      if (lane === rampLane) {
        this.spawn('rampCar', lane, nearZ - TRAIN_LENGTH / 2, false, 'trainGroup');
        farthest = Math.min(farthest, this.placeCars(lane, nearZ - TRAIN_LENGTH, 1 + Math.floor(this.rng() * 2), 'trainGroup'));
        openLanes++;
        return;
      }
      const mustLeaveOpen = index === lanes.length - 1 && openLanes === 0;
      const choice = this.rng();
      if (mustLeaveOpen || choice < 0.3) {
        openLanes++;
        return;
      }
      const offset = Math.floor(this.rng() * 3) * 3;
      const near = nearZ - offset;
      const canOncome = -nearZ > ONCOMING_MIN_DISTANCE && this.laneClearAhead(lane, near, ONCOMING_CLEARANCE);
      if (choice < 0.55 && canOncome) {
        this.spawn('train', lane, near - TRAIN_LENGTH / 2, true, 'trainGroup');
        farthest = Math.min(farthest, near - TRAIN_LENGTH);
        return;
      }
      farthest = Math.min(farthest, this.placeCars(lane, near, 1 + Math.floor(this.rng() * 3), 'trainGroup'));
    });
    return farthest;
  }

  private barrierRow(nearZ: number, pattern: PatternName): number {
    const kinds = LANES.map((): ObstacleKind | null => {
      const r = this.rng();
      return r < 0.4 ? 'barrierLow' : r < 0.75 ? 'barrierHigh' : null;
    });
    if (!kinds.some((k) => k !== null)) kinds[Math.floor(this.rng() * kinds.length)] = this.pick(['barrierLow', 'barrierHigh'] as const);
    let farthest = nearZ;
    kinds.forEach((kind, i) => {
      if (!kind) return;
      const half = halfLengthOf(kind);
      this.spawn(kind, LANES[i], nearZ - half, false, pattern);
      farthest = Math.min(farthest, nearZ - half * 2);
    });
    return farthest;
  }

  private mixed(nearZ: number): number {
    const [trainLane, barrierLane] = this.shuffledLanes();
    const trainFar = this.placeCars(trainLane, nearZ, 1 + Math.floor(this.rng() * 2), 'mixed');
    const kind = this.pick(['barrierLow', 'barrierHigh'] as const);
    const z = nearZ - 4 - Math.floor(this.rng() * 3) * 3;
    this.spawn(kind, barrierLane, z - halfLengthOf(kind), false, 'mixed');
    return Math.min(trainFar, z - halfLengthOf(kind) * 2);
  }
}
