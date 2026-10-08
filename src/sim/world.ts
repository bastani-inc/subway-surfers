import { GAME_OVER_DELAY, SCRAPE_BOUNCE_VX, STEP_UP } from './constants';
import { beginCatch, createChase, registerStumble, stepChase, type ChaseState } from './chase';
import { boxOfCollider, classifyHit, footprintOverlaps, overlaps, partBox, type Box, type HitKind } from './collision';
import { OBSTACLE_DEFS, halfLengthOf, type ObstacleKind, type PartDef } from './obstacleDefs';
import {
  bounceToPreviousLane,
  colliderOf,
  createRunner,
  knockBack,
  stepKnockedBack,
  stepRunner,
  stumble,
  type RunnerState,
} from './runner';
import { computeScore, HighScoreStore } from './score';
import { Spawner, type Obstacle } from './spawner';

export type WorldState = 'ready' | 'running' | 'crashed' | 'gameover';
export type CrashCause = 'frontCrash' | 'secondStumble';
export type WorldEvent = 'stumble' | 'crash' | 'roof' | 'gameover';

export interface HitRecord {
  kind: HitKind;
  obstacle: ObstacleKind;
  part: string;
  lane: number;
  time: number;
}

export interface WorldOptions {
  seed?: number;
  spawning?: boolean;
  highScores?: HighScoreStore;
}

const NEARBY = 1.5;

export class World {
  readonly runner: RunnerState = createRunner();
  readonly chase: ChaseState = createChase();
  readonly spawner: Spawner;
  readonly highScores: HighScoreStore;
  state: WorldState = 'ready';
  score = 0;
  coins = 0;
  multiplier = 1;
  time = 0;
  crashCause: CrashCause | null = null;
  crashTime = 0;
  crashZ = 0;
  newHighScore = false;
  lastHit: HitRecord | null = null;
  readonly hitCounts: Record<HitKind, number> = { roof: 0, crash: 0, scrape: 0, clip: 0 };
  readonly events: WorldEvent[] = [];

  constructor(options: WorldOptions = {}) {
    this.spawner = new Spawner(options.seed ?? 1, options.spawning ?? true);
    this.highScores = options.highScores ?? new HighScoreStore(null);
  }

  start(): void {
    if (this.state === 'ready') this.state = 'running';
  }

  restart(seed?: number): void {
    Object.assign(this.runner, createRunner());
    Object.assign(this.chase, createChase());
    this.spawner.reset(seed);
    this.state = 'running';
    this.score = 0;
    this.coins = 0;
    this.multiplier = 1;
    this.crashCause = null;
    this.crashTime = 0;
    this.newHighScore = false;
    this.lastHit = null;
    for (const key of Object.keys(this.hitCounts) as HitKind[]) this.hitCounts[key] = 0;
  }

  get highScore(): number {
    return this.highScores.value;
  }

  step(dt: number): void {
    this.time += dt;
    if (this.state === 'running') this.stepRunning(dt);
    else if (this.state === 'crashed') this.stepCrashed(dt);
  }

  private stepRunning(dt: number): void {
    const r = this.runner;
    this.spawner.update(r.z, r.speed);
    this.spawner.moveObstacles(r.z, dt);
    const before = boxOfCollider(colliderOf(r));
    stepRunner(r, dt, this.supportAt);
    stepChase(this.chase, dt);
    this.resolveCollisions(before);
    if (this.state === 'running') this.score = computeScore(r.distance, this.multiplier, this.coins);
  }

  private stepCrashed(dt: number): void {
    stepKnockedBack(this.runner, dt, this.supportAt);
    stepChase(this.chase, dt);
    if (this.chase.phase === 'caught' && this.chase.timer >= GAME_OVER_DELAY) {
      this.state = 'gameover';
      const result = this.highScores.submit(this.score);
      this.newHighScore = result.isNew;
      this.events.push('gameover');
    }
  }

  private nearby(o: Obstacle, z: number): boolean {
    return Math.abs(o.z - z) <= halfLengthOf(o.kind) + NEARBY;
  }

  readonly supportAt = (runner: RunnerState, referenceY: number): number => {
    const footprint = boxOfCollider(colliderOf(runner));
    let ground = 0;
    for (const o of this.spawner.active) {
      if (!this.nearby(o, runner.z)) continue;
      for (const part of OBSTACLE_DEFS[o.kind].parts) {
        if (part.surface === 'solid') continue;
        const box = partBox(part, o.x, o.z, runner.z);
        if (box.maxY > referenceY + STEP_UP || box.maxY <= ground) continue;
        if (footprintOverlaps(footprint, box)) ground = box.maxY;
      }
    }
    return ground;
  };

  private resolveCollisions(before: Box): void {
    const r = this.runner;
    for (const o of this.spawner.active) {
      if (o.passThrough || !this.nearby(o, r.z)) continue;
      for (const part of OBSTACLE_DEFS[o.kind].parts) {
        const now = boxOfCollider(colliderOf(r));
        const box = partBox(part, o.x, o.z, r.z);
        if (!overlaps(now, box)) continue;
        const previous = partBox(part, o.x, o.prevZ, r.z);
        const kind = classifyHit(before, now, previous, box, part.surface !== 'solid');
        if (kind) this.applyHit(kind, o, part, box);
        if (this.state !== 'running') return;
      }
    }
  }

  private record(kind: HitKind, o: Obstacle, part: PartDef): void {
    this.hitCounts[kind]++;
    this.lastHit = { kind, obstacle: o.kind, part: part.name, lane: o.lane, time: this.time };
  }

  private applyHit(kind: HitKind, o: Obstacle, part: PartDef, box: Box): void {
    const r = this.runner;
    if (kind === 'roof') {
      this.record(kind, o, part);
      r.y = box.maxY;
      r.vy = 0;
      r.grounded = true;
      r.landings++;
      this.events.push('roof');
      return;
    }
    if (kind === 'crash') {
      this.record(kind, o, part);
      this.crash('frontCrash');
      return;
    }
    if (kind === 'scrape') {
      if (o.scrapeCooldown > 0) return;
      this.record(kind, o, part);
      o.scrapeCooldown = 0.6;
      bounceToPreviousLane(r, (box.minX + box.maxX) / 2, SCRAPE_BOUNCE_VX);
      this.stumble();
      return;
    }
    this.record(kind, o, part);
    o.passThrough = true;
    this.stumble();
  }

  private stumble(): void {
    if (registerStumble(this.chase) === 'caught') {
      this.crash('secondStumble');
      return;
    }
    stumble(this.runner);
    this.events.push('stumble');
  }

  crash(cause: CrashCause): void {
    if (this.state !== 'running') return;
    this.state = 'crashed';
    this.crashCause = cause;
    this.crashTime = this.time;
    this.crashZ = this.runner.z;
    knockBack(this.runner);
    beginCatch(this.chase);
    this.events.push('crash');
  }

  drainEvents(): WorldEvent[] {
    return this.events.splice(0);
  }
}
