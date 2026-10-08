import { describe, expect, it } from 'vitest';
import {
  BARRIER_LOW_HEIGHT,
  FIXED_DT,
  GANTRY_CLEARANCE,
  LANE_WIDTH,
  ROLL_HEIGHT,
  STAND_HEIGHT,
  TRAIN_HEIGHT,
  TRAIN_LENGTH,
  jumpApexHeight,
} from './constants';
import { classifyHit, partBox, type Box } from './collision';
import { OBSTACLE_DEFS, rampHeightAt } from './obstacleDefs';
import { changeLane, jump, roll } from './runner';
import { World } from './world';

const box = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Box => ({ minX, maxX, minY, maxY, minZ, maxZ });
const trainBox = box(-1, 1, 0, TRAIN_HEIGHT, -16, -4);

const newWorld = () => {
  const world = new World({ spawning: false });
  world.start();
  return world;
};

const run = (world: World, seconds: number, each?: (w: World) => void) => {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    world.step(FIXED_DT);
    each?.(world);
  }
};

const runUntil = (world: World, done: (w: World) => boolean, maxSeconds = 10) => {
  for (let i = 0; i < maxSeconds / FIXED_DT && !done(world); i++) world.step(FIXED_DT);
  return done(world);
};

describe('hit classification', () => {
  it('treats running into the front face of a train as a crash', () => {
    const before = box(-0.35, 0.35, 0, 1.7, -3.8, -3.2);
    const after = box(-0.35, 0.35, 0, 1.7, -4.3, -3.7);
    expect(classifyHit(before, after, trainBox, trainBox, true)).toBe('crash');
  });

  it('treats an oncoming train closing on the runner as a crash', () => {
    const runner = box(-0.35, 0.35, 0, 1.7, -0.3, 0.3);
    const prevTrain = box(-1, 1, 0, TRAIN_HEIGHT, -12.5, -0.5);
    const train = box(-1, 1, 0, TRAIN_HEIGHT, -12.1, -0.1);
    expect(classifyHit(runner, runner, prevTrain, train, true)).toBe('crash');
  });

  it('treats sliding sideways into a train you are beside as a side scrape', () => {
    const before = box(0.1, 0.8, 0, 1.7, -10.3, -9.7);
    const after = box(0.6, 1.3, 0, 1.7, -10.8, -10.2);
    const rightTrain = box(1.2, 3.2, 0, TRAIN_HEIGHT, -16, -4);
    expect(classifyHit(before, after, rightTrain, rightTrain, true)).toBe('scrape');
  });

  it('treats coming down onto a train roof as a roof landing', () => {
    const before = box(-0.35, 0.35, 3.3, 5.0, -10.3, -9.7);
    const after = box(-0.35, 0.35, 3.1, 4.8, -10.8, -10.2);
    expect(classifyHit(before, after, trainBox, trainBox, true)).toBe('roof');
  });

  it('treats feet clipping the top of a low barrier as a clip, not a roof', () => {
    const barrier = box(-1, 1, 0, BARRIER_LOW_HEIGHT, -5.2, -4.8);
    const before = box(-0.35, 0.35, 1.05, 2.75, -4.9, -4.3);
    const after = box(-0.35, 0.35, 0.95, 2.65, -5.3, -4.7);
    expect(classifyHit(before, after, barrier, barrier, false)).toBe('clip');
  });
});

describe('world collisions', () => {
  it('crashes front-on into a stationary train and knocks the runner backward', () => {
    const world = newWorld();
    world.spawner.spawn('train', 0, -20 - TRAIN_LENGTH / 2);
    expect(runUntil(world, (w) => w.state !== 'running')).toBe(true);
    expect(world.state).toBe('crashed');
    expect(world.crashCause).toBe('frontCrash');
    expect(world.lastHit?.kind).toBe('crash');
    const crashZ = world.runner.z;
    world.step(FIXED_DT);
    expect(world.runner.z).toBeGreaterThan(crashZ);
    expect(world.runner.vy).toBeGreaterThan(0);
  });

  it('crashes front-on into an oncoming train', () => {
    const world = newWorld();
    world.spawner.spawn('train', 0, -60 - TRAIN_LENGTH / 2, true);
    expect(runUntil(world, (w) => w.state !== 'running')).toBe(true);
    expect(world.crashCause).toBe('frontCrash');
    expect(world.runner.distance).toBeLessThan(60);
  });

  it('bounces a side scrape back to the previous lane with a stumble and keeps running', () => {
    const world = newWorld();
    world.spawner.spawn('train', 1, -2 - TRAIN_LENGTH / 2);
    run(world, 0.1);
    changeLane(world.runner, 1);
    run(world, 0.6);
    expect(world.state).toBe('running');
    expect(world.lastHit?.kind).toBe('scrape');
    expect(world.runner.lane).toBe(0);
    expect(world.runner.x).toBeLessThan(LANE_WIDTH / 2);
    expect(world.chase.phase).toBe('close');
    expect(world.drainEvents()).toContain('stumble');
  });

  it('lands on a train roof and keeps running, then drops off the end', () => {
    const world = newWorld();
    world.spawner.spawn('train', 0, -2 - TRAIN_LENGTH / 2);
    world.runner.y = 4;
    world.runner.grounded = false;
    world.runner.vy = 0;
    run(world, 0.4);
    expect(world.state).toBe('running');
    expect(world.runner.grounded).toBe(true);
    expect(world.runner.y).toBe(TRAIN_HEIGHT);
    run(world, 1.6);
    expect(world.state).toBe('running');
    expect(world.runner.y).toBe(0);
  });

  it('rolls under a high gantry but crashes into it standing or jumping', () => {
    const sign = OBSTACLE_DEFS.barrierHigh.parts.find((p) => p.name === 'sign');
    expect(sign?.min[1]).toBe(GANTRY_CLEARANCE);
    expect(GANTRY_CLEARANCE).toBeGreaterThan(ROLL_HEIGHT);
    expect(GANTRY_CLEARANCE).toBeLessThan(STAND_HEIGHT);
    expect(jumpApexHeight()).toBeLessThan(OBSTACLE_DEFS.barrierHigh.size.height);

    const rolled = newWorld();
    rolled.spawner.spawn('barrierHigh', 0, -5);
    roll(rolled.runner);
    run(rolled, 0.6);
    expect(rolled.runner.z).toBeLessThan(-6);
    expect(rolled.state).toBe('running');
    expect(rolled.lastHit).toBeNull();

    const standing = newWorld();
    standing.spawner.spawn('barrierHigh', 0, -5);
    run(standing, 0.6);
    expect(standing.state).toBe('crashed');
    expect(standing.lastHit?.part).toBe('sign');

    const jumped = newWorld();
    jumped.spawner.spawn('barrierHigh', 0, -5);
    jump(jumped.runner);
    run(jumped, 0.6);
    expect(jumped.state).toBe('crashed');
  });

  it('jumps over a low barrier but crashes into it front-on', () => {
    const jumped = newWorld();
    jumped.spawner.spawn('barrierLow', 0, -4);
    jump(jumped.runner);
    run(jumped, 0.8);
    expect(jumped.state).toBe('running');
    expect(jumped.lastHit).toBeNull();

    const ran = newWorld();
    ran.spawner.spawn('barrierLow', 0, -4);
    run(ran, 0.6);
    expect(ran.state).toBe('crashed');
  });

  it('climbs a ramp car onto the train roof and runs along it', () => {
    const world = newWorld();
    world.spawner.spawn('rampCar', 0, -10 - TRAIN_LENGTH / 2);
    world.spawner.spawn('train', 0, -10 - TRAIN_LENGTH - TRAIN_LENGTH / 2);
    const ramp = OBSTACLE_DEFS.rampCar.parts[0];
    const heights: number[] = [];
    let maxY = 0;
    runUntil(world, (w) => {
      if (w.runner.z < -10 && w.runner.z > -22) heights.push(w.runner.y);
      maxY = Math.max(maxY, w.runner.y);
      return w.runner.z < -28 || w.state !== 'running';
    });
    expect(world.state).toBe('running');
    expect(world.runner.grounded).toBe(true);
    expect(world.runner.y).toBe(TRAIN_HEIGHT);
    expect(maxY).toBe(TRAIN_HEIGHT);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
    const mid = partBox(ramp, 0, -16, -16);
    expect(mid.maxY).toBeCloseTo(rampHeightAt(ramp, 0), 9);
    expect(mid.maxY).toBeCloseTo(TRAIN_HEIGHT / 2, 9);
    expect(world.lastHit).toBeNull();
  });

  it('scrapes the side of a tall ramp section instead of stepping up onto it', () => {
    const world = newWorld();
    world.spawner.spawn('rampCar', 1, -2);
    run(world, 0.05);
    changeLane(world.runner, 1);
    run(world, 0.4);
    expect(world.lastHit?.kind).toBe('scrape');
    expect(world.runner.lane).toBe(0);
  });
});
