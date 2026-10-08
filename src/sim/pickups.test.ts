import { describe, expect, it } from 'vitest';
import {
  COIN_HEIGHT,
  COIN_RADIUS,
  COIN_SPACING,
  FIXED_DT,
  GRAVITY,
  JETPACK_ALTITUDE,
  JUMP_VELOCITY,
  MAGNET_PULL_SPEED,
  MAGNET_RADIUS,
  SNEAKERS_JUMP_VELOCITY,
  TRAIN_HEIGHT,
  TRAIN_LENGTH,
  jumpApexHeight,
} from './constants';
import { partBox } from './collision';
import { OBSTACLE_DEFS } from './obstacleDefs';
import { POWER_UP_DURATIONS, Pickups, arcHeights, attract, distanceToCollider, touches } from './pickups';
import { colliderOf, createRunner, laneX } from './runner';
import { Spawner } from './spawner';
import { World } from './world';

const runningWorld = () => {
  const world = new World({ spawning: false });
  world.start();
  return world;
};

const stepFor = (world: World, seconds: number) => {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) world.step(FIXED_DT);
};

describe('coin collection radius', () => {
  it('collects a coin whose center is within the radius of the runner collider and not beyond it', () => {
    const c = colliderOf(createRunner());
    const edgeX = c.centerX + c.width / 2;
    expect(touches({ x: edgeX + COIN_RADIUS - 0.01, y: COIN_HEIGHT, z: 0 }, c)).toBe(true);
    expect(touches({ x: edgeX + COIN_RADIUS + 0.01, y: COIN_HEIGHT, z: 0 }, c)).toBe(false);
    const top = c.bottomY + c.height;
    expect(touches({ x: 0, y: top + COIN_RADIUS - 0.01, z: 0 }, c)).toBe(true);
    expect(touches({ x: 0, y: top + COIN_RADIUS + 0.01, z: 0 }, c)).toBe(false);
    expect(distanceToCollider({ x: 0, y: 1, z: 0 }, c)).toBe(0);
  });

  it('picks up coins in the runner lane, skips the next lane, and adds them to the score', () => {
    const world = runningWorld();
    world.pickups.spawnLine(0, -10, 5);
    world.pickups.spawnLine(1, -10, 5);
    stepFor(world, 2);
    expect(world.coins).toBe(5);
    expect(world.pickups.coins.every((c) => c.lane === 1)).toBe(true);
    expect(world.score).toBe(Math.floor(world.distancePoints) + 5);
  });

  it('collects every coin of an arc by jumping through it', () => {
    const world = runningWorld();
    const speed = world.runner.speed;
    world.pickups.spawnArc(0, -20, speed);
    const airtime = (2 * JUMP_VELOCITY) / GRAVITY;
    const takeoffZ = -20 + (speed * airtime) / 2;
    while (world.runner.z > takeoffZ) world.step(FIXED_DT);
    world.jump();
    stepFor(world, 1.5);
    expect(world.coins).toBe(9);
  });

  it('places arc coins on the jump parabola', () => {
    for (const { t, y } of arcHeights(9)) expect(y).toBeCloseTo(JUMP_VELOCITY * t - 0.5 * GRAVITY * t * t, 9);
  });
});

describe('coin magnet', () => {
  it('moves a coin straight toward the target at the pull speed without overshooting', () => {
    const coin = { x: 3, y: 1, z: -4 };
    attract(coin, { x: 0, y: 1, z: 0 }, 0.05);
    expect(Math.hypot(coin.x, coin.y - 1, coin.z)).toBeCloseTo(5 - MAGNET_PULL_SPEED * 0.05, 9);
    expect(coin.x / coin.z).toBeCloseTo(3 / -4, 9);
    attract(coin, { x: 0, y: 1, z: 0 }, 1);
    expect(coin).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('pulls nearby coins from other lanes into the runner, but not distant ones', () => {
    const plain = runningWorld();
    plain.pickups.spawnLine(1, -6, 3);
    stepFor(plain, 1);
    expect(plain.coins).toBe(0);

    const world = runningWorld();
    world.grantPowerUp('magnet');
    world.pickups.spawnLine(1, -4, 3);
    world.pickups.spawnCoin(1, COIN_HEIGHT, -200, 'line');
    world.step(FIXED_DT);
    const near = world.pickups.coins.filter((c) => c.z > -50);
    expect(near.length).toBe(3);
    expect(near.every((c) => c.magnetized)).toBe(true);
    expect(world.pickups.coins.find((c) => c.z < -150)?.magnetized).toBe(false);
    stepFor(world, 1);
    expect(world.coins).toBe(3);
    expect(world.runner.lane).toBe(0);
  });

  it('only attracts coins within the magnet radius and stops after the timer ends', () => {
    const world = runningWorld();
    world.grantPowerUp('magnet', 0.5);
    const center = colliderOf(world.runner);
    world.pickups.spawnCoin(1, center.bottomY + center.height / 2, -Math.sqrt(MAGNET_RADIUS ** 2 - laneX(1) ** 2) + 0.2, 'line');
    world.step(FIXED_DT);
    expect(world.pickups.coins[0].magnetized).toBe(true);
    stepFor(world, 0.6);
    expect(world.powerUps.magnet).toBe(0);
    world.pickups.spawnLine(1, world.runner.z - 6, 3);
    stepFor(world, 1);
    expect(world.pickups.coins.some((c) => c.lane === 1 && c.magnetized)).toBe(false);
  });
});

describe('score multiplier', () => {
  it('doubles distance score while active and returns to x1 when it expires', () => {
    const normal = runningWorld();
    const boosted = runningWorld();
    boosted.grantPowerUp('multiplier', 2);
    expect(boosted.multiplier).toBe(2);
    stepFor(normal, 1.5);
    stepFor(boosted, 1.5);
    expect(boosted.runner.distance).toBeCloseTo(normal.runner.distance, 9);
    expect(boosted.distancePoints).toBeCloseTo(normal.distancePoints * 2, 6);
    expect(boosted.score).toBe(Math.floor(normal.distancePoints * 2));
    stepFor(normal, 1.5);
    stepFor(boosted, 1.5);
    expect(boosted.multiplier).toBe(1);
    expect(boosted.powerUps.multiplier).toBe(0);
    const bonus = boosted.distancePoints - normal.distancePoints;
    expect(bonus).toBeGreaterThan(0);
    stepFor(normal, 1);
    stepFor(boosted, 1);
    expect(boosted.distancePoints - normal.distancePoints).toBeCloseTo(bonus, 6);
  });

  it('adds coins once, without retroactively changing earlier distance points', () => {
    const world = runningWorld();
    stepFor(world, 1);
    const before = world.distancePoints;
    world.grantPowerUp('multiplier');
    world.pickups.spawnLine(0, world.runner.z - 3, 2);
    stepFor(world, 0.5);
    expect(world.coins).toBe(2);
    expect(world.distancePoints).toBeGreaterThan(before);
    expect(world.score).toBe(Math.floor(world.distancePoints) + 2);
  });
});

const jumpApexIn = (world: World) => {
  world.jump();
  const heights: number[] = [];
  while (!world.runner.grounded) {
    world.step(FIXED_DT);
    heights.push(world.runner.y);
  }
  return { apex: Math.max(...heights), heights };
};

describe('super sneakers', () => {
  it('raises the jump apex above a train roof while keeping a constant-gravity arc', () => {
    const normal = jumpApexIn(runningWorld());
    const world = runningWorld();
    world.grantPowerUp('sneakers');
    const boosted = jumpApexIn(world);
    expect(normal.apex).toBeCloseTo(jumpApexHeight(JUMP_VELOCITY), 1);
    expect(boosted.apex).toBeCloseTo(jumpApexHeight(SNEAKERS_JUMP_VELOCITY), 1);
    expect(boosted.apex).toBeGreaterThan(normal.apex * 1.6);
    expect(boosted.apex).toBeGreaterThan(TRAIN_HEIGHT);
    const flight = boosted.heights.slice(0, -1);
    for (let i = 2; i < flight.length; i++) expect((flight[i] - 2 * flight[i - 1] + flight[i - 2]) / FIXED_DT ** 2).toBeCloseTo(-GRAVITY, 6);
  });

  it('goes back to the normal jump when the timer ends', () => {
    const world = runningWorld();
    world.grantPowerUp('sneakers', 0.5);
    stepFor(world, 0.6);
    expect(world.jumpVelocity).toBe(JUMP_VELOCITY);
    expect(jumpApexIn(world).apex).toBeCloseTo(jumpApexHeight(JUMP_VELOCITY), 1);
  });
});

describe('jetpack', () => {
  it('flies above the trains for exactly its duration, collecting the sky coin trail', () => {
    const world = runningWorld();
    world.grantPowerUp('jetpack');
    const sky = world.pickups.coins.filter((c) => c.shape === 'sky').length;
    expect(sky).toBeGreaterThan(20);
    let flyingSteps = 0;
    let minFlyingHeight = Infinity;
    let elapsed = 0;
    while (world.runner.flightAltitude > 0) {
      const target = world.pickups.coins.filter((c) => c.shape === 'sky' && c.z < world.runner.z - 3).sort((a, b) => b.z - a.z)[0];
      if (target) world.runner.lane = target.lane;
      world.step(FIXED_DT);
      elapsed += FIXED_DT;
      flyingSteps++;
      if (elapsed > 1.2 && world.runner.flightAltitude > 0) minFlyingHeight = Math.min(minFlyingHeight, world.runner.y);
    }
    expect(Math.abs(flyingSteps * FIXED_DT - POWER_UP_DURATIONS.jetpack)).toBeLessThanOrEqual(FIXED_DT);
    expect(minFlyingHeight).toBeGreaterThan(TRAIN_HEIGHT + 1.5);
    expect(minFlyingHeight).toBeGreaterThan(JETPACK_ALTITUDE - 0.2);
    expect(world.coins).toBeGreaterThan(sky * 0.8);
  });

  it('lands safely with a gravity fall when it expires', () => {
    const world = runningWorld();
    world.grantPowerUp('jetpack', 2);
    stepFor(world, 1.9);
    expect(world.runner.flightAltitude).toBeGreaterThan(0);
    expect(world.runner.y).toBeGreaterThan(TRAIN_HEIGHT);
    while (world.runner.flightAltitude > 0) world.step(FIXED_DT);
    expect(world.invulnerable).toBe(true);
    const startY = world.runner.y;
    let steps = 0;
    const vys: number[] = [];
    while (!world.runner.grounded && steps < 300) {
      world.step(FIXED_DT);
      vys.push(world.runner.vy);
      steps++;
    }
    expect(world.runner.grounded).toBe(true);
    expect(world.runner.y).toBe(0);
    expect(steps * FIXED_DT).toBeLessThanOrEqual(Math.sqrt((2 * startY) / GRAVITY) + 2 * FIXED_DT);
    for (let i = 1; i < vys.length - 1; i++) expect(vys[i] - vys[i - 1]).toBeCloseTo(-GRAVITY * FIXED_DT, 6);
    expect(world.state).toBe('running');
  });

  it('lands on a train roof instead of crashing when a train is below at expiry', () => {
    const world = runningWorld();
    world.grantPowerUp('jetpack', 1.5);
    stepFor(world, 1.4);
    world.spawner.spawn('train', 0, world.runner.z - 4 - TRAIN_LENGTH / 2);
    world.spawner.spawn('train', 0, world.runner.z - 4 - TRAIN_LENGTH * 1.5 - 0.4);
    stepFor(world, 1.2);
    expect(world.state).toBe('running');
    expect(world.hitCounts.crash).toBe(0);
    expect(world.runner.grounded).toBe(true);
    expect(world.runner.y).toBeCloseTo(TRAIN_HEIGHT, 6);
  });

  it('ignores jump and roll while flying', () => {
    const world = runningWorld();
    world.grantPowerUp('jetpack');
    stepFor(world, 0.5);
    expect(world.jump()).toBe(false);
    expect(world.roll()).toBe(false);
    expect(world.runner.rollTimeLeft).toBe(0);
  });
});

describe('pickup spawning', () => {
  it('lays coins in lines and arcs around obstacles, adds power-ups, and pools coin objects', () => {
    const spawner = new Spawner(11);
    const pickups = new Pickups(11);
    let maxActive = 0;
    let insideObstacle = 0;
    const shapes = new Set<string>();
    for (let z = 0; z > -4000; z -= 0.5) {
      spawner.update(z, 20);
      pickups.update(z, 20, spawner.active, true);
      maxActive = Math.max(maxActive, pickups.coins.length);
      if (z % 10 !== 0) continue;
      for (const coin of pickups.coins) {
        shapes.add(coin.shape);
        for (const o of spawner.active) {
          if (o.oncoming) continue;
          for (const part of OBSTACLE_DEFS[o.kind].parts) {
            const box = partBox(part, o.x, o.z, coin.z);
            if (coin.x > box.minX && coin.x < box.maxX && coin.z > box.minZ && coin.z < box.maxZ && coin.y < box.maxY && coin.y > box.minY) insideObstacle++;
          }
        }
      }
    }
    expect(shapes.has('line')).toBe(true);
    expect(shapes.has('arc')).toBe(true);
    expect(pickups.shapeCounts.powerUp).toBeGreaterThan(2);
    expect(pickups.shapeCounts.roof + pickups.shapeCounts.low).toBeGreaterThan(0);
    expect(insideObstacle).toBe(0);
    expect(pickups.created).toBeLessThanOrEqual(maxActive);
    expect(pickups.recycled).toBeGreaterThan(pickups.created * 3);
  });

  it('is deterministic for a seed and spaces line coins evenly', () => {
    const a = new Pickups(3);
    const b = new Pickups(3);
    a.update(0, 12, [], true);
    b.update(0, 12, [], true);
    expect(a.coins.length).toBeGreaterThan(10);
    expect(a.coins.map((c) => [c.lane, c.y, c.z])).toEqual(b.coins.map((c) => [c.lane, c.y, c.z]));
    const line = a.coins.filter((c) => c.shape === 'line');
    const gaps = line.slice(1).map((c, i) => line[i].z - c.z).filter((g) => g > 0 && g < 3);
    for (const gap of gaps) expect(gap).toBeCloseTo(COIN_SPACING, 9);
  });
});
