import {
  GAME_OVER_DELAY,
  JETPACK_ALTITUDE,
  JETPACK_LANDING_GRACE,
  JUMP_VELOCITY,
  ROLL_DURATION,
  SCORE_MULTIPLIER,
  SCRAPE_BOUNCE_VX,
  SNEAKERS_JUMP_VELOCITY,
  STEP_UP,
} from './constants';
import { beginCatch, createChase, registerStumble, stepChase, type ChaseState } from './chase';
import { boxOfCollider, classifyHit, footprintOverlaps, overlaps, partBox, type Box, type HitKind } from './collision';
import { OBSTACLE_DEFS, halfLengthOf, type ObstacleKind, type PartDef } from './obstacleDefs';
import { POWER_UP_DURATIONS, POWER_UP_KINDS, Pickups, type PowerUpKind } from './pickups';
import {
  bounceToPreviousLane,
  colliderOf,
  createRunner,
  endFlight,
  isFlying,
  jump,
  knockBack,
  roll,
  stepKnockedBack,
  stepRunner,
  stumble,
  takeOff,
  type RunnerState,
} from './runner';
import { HighScoreStore } from './score';
import { Spawner, type Obstacle } from './spawner';

export type WorldState = 'ready' | 'running' | 'crashed' | 'gameover';
export type CrashCause = 'frontCrash' | 'secondStumble';
export type WorldEvent = 'stumble' | 'crash' | 'roof' | 'gameover' | 'coin' | 'powerUp' | 'powerUpEnd' | 'jetpackLanded';

export type PowerUpTimers = Record<PowerUpKind, number>;

const noPowerUps = (): PowerUpTimers => ({ jetpack: 0, sneakers: 0, magnet: 0, multiplier: 0 });

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
  readonly pickups: Pickups;
  readonly powerUps: PowerUpTimers = noPowerUps();
  readonly powerUpDurations: PowerUpTimers = { ...POWER_UP_DURATIONS };
  readonly highScores: HighScoreStore;
  state: WorldState = 'ready';
  score = 0;
  coins = 0;
  multiplier = 1;
  distancePoints = 0;
  jetpackLanding = false;
  landingGrace = 0;
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
    this.pickups = new Pickups(options.seed ?? 1, options.spawning ?? true);
    this.highScores = options.highScores ?? new HighScoreStore(null);
  }

  start(): void {
    if (this.state === 'ready') this.state = 'running';
  }

  restart(seed?: number): void {
    Object.assign(this.runner, createRunner());
    Object.assign(this.chase, createChase());
    this.spawner.reset(seed);
    this.pickups.reset(seed);
    Object.assign(this.powerUps, noPowerUps());
    Object.assign(this.powerUpDurations, POWER_UP_DURATIONS);
    this.state = 'running';
    this.score = 0;
    this.coins = 0;
    this.multiplier = 1;
    this.distancePoints = 0;
    this.jetpackLanding = false;
    this.landingGrace = 0;
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

  get invulnerable(): boolean {
    return isFlying(this.runner) || this.jetpackLanding || this.landingGrace > 0;
  }

  get jumpVelocity(): number {
    return this.powerUps.sneakers > 0 ? SNEAKERS_JUMP_VELOCITY : JUMP_VELOCITY;
  }

  jump(): boolean {
    return this.state === 'running' && jump(this.runner, this.jumpVelocity);
  }

  roll(): boolean {
    return this.state === 'running' && roll(this.runner);
  }

  grantPowerUp(kind: PowerUpKind, duration = POWER_UP_DURATIONS[kind]): void {
    this.powerUps[kind] = duration;
    this.powerUpDurations[kind] = duration;
    if (kind === 'multiplier') this.multiplier = SCORE_MULTIPLIER;
    if (kind === 'jetpack') {
      this.jetpackLanding = false;
      takeOff(this.runner, JETPACK_ALTITUDE);
      this.pickups.spawnSkyTrail(this.runner.lane, this.runner.z - 14, Math.max(20, this.runner.speed * duration - 18));
    }
  }

  private expirePowerUp(kind: PowerUpKind): void {
    this.powerUps[kind] = 0;
    if (kind === 'multiplier') this.multiplier = 1;
    if (kind === 'jetpack') {
      endFlight(this.runner);
      this.jetpackLanding = true;
    }
    this.events.push('powerUpEnd');
  }

  private stepPowerUps(dt: number): void {
    for (const kind of POWER_UP_KINDS) {
      if (this.powerUps[kind] <= 0) continue;
      this.powerUps[kind] = Math.max(0, this.powerUps[kind] - dt);
      if (this.powerUps[kind] === 0) this.expirePowerUp(kind);
    }
  }

  private stepLanding(dt: number): void {
    if (this.landingGrace > 0) this.landingGrace = Math.max(0, this.landingGrace - dt);
    if (this.jetpackLanding && this.runner.grounded) {
      this.jetpackLanding = false;
      this.landingGrace = JETPACK_LANDING_GRACE;
      this.events.push('jetpackLanded');
    }
  }

  private collectPickups(dt: number): void {
    for (const pickup of this.pickups.collect(colliderOf(this.runner), this.powerUps.magnet > 0, dt)) {
      if (pickup.type === 'coin') {
        this.coins++;
        this.events.push('coin');
      } else if (pickup.kind) {
        this.grantPowerUp(pickup.kind);
        this.events.push('powerUp');
      }
    }
  }

  private stepRunning(dt: number): void {
    const r = this.runner;
    this.spawner.update(r.z, r.speed);
    this.spawner.moveObstacles(r.z, dt);
    this.pickups.update(r.z, r.speed, this.spawner.active, !isFlying(r));
    const before = boxOfCollider(colliderOf(r));
    const distanceBefore = r.distance;
    stepRunner(r, dt, this.supportAt);
    this.distancePoints += (r.distance - distanceBefore) * this.multiplier;
    this.stepPowerUps(dt);
    this.stepLanding(dt);
    stepChase(this.chase, dt);
    this.resolveCollisions(before);
    if (this.state !== 'running') return;
    this.stepLanding(0);
    this.collectPickups(dt);
    this.score = Math.floor(this.distancePoints) + this.coins;
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
    if (kind === 'roof' || (this.jetpackLanding && part.surface !== 'solid')) {
      this.record('roof', o, part);
      r.y = box.maxY;
      r.vy = 0;
      r.grounded = true;
      r.landings++;
      if (r.rollQueued) {
        r.rollQueued = false;
        r.rollTimeLeft = ROLL_DURATION;
      }
      this.events.push('roof');
      return;
    }
    if (this.invulnerable) {
      o.passThrough = true;
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
