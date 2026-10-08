import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAX_SPEED, SPEED_RAMP_SECONDS, START_SPEED, TRAIN_LENGTH } from './constants';
import { speedAt } from './runner';
import { computeScore, HIGH_SCORE_KEY, HighScoreStore, type ScoreStorage } from './score';
import { World } from './world';

const memoryStorage = (): ScoreStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('speed ramp', () => {
  it('starts at the start speed and rises smoothly and monotonically to the cap', () => {
    expect(speedAt(0)).toBe(START_SPEED);
    let previous = speedAt(0);
    let previousSlope = Infinity;
    for (let t = 1; t <= SPEED_RAMP_SECONDS; t++) {
      const speed = speedAt(t);
      const slope = speed - previous;
      expect(slope).toBeGreaterThan(0);
      expect(slope).toBeLessThanOrEqual(previousSlope + 1e-9);
      expect(slope).toBeLessThan(0.25);
      previous = speed;
      previousSlope = slope;
    }
    expect(speedAt(SPEED_RAMP_SECONDS / 2)).toBeGreaterThan(START_SPEED + (MAX_SPEED - START_SPEED) / 2);
  });

  it('holds the cap after the ramp ends', () => {
    expect(speedAt(SPEED_RAMP_SECONDS)).toBe(MAX_SPEED);
    expect(speedAt(SPEED_RAMP_SECONDS * 3)).toBe(MAX_SPEED);
    expect(speedAt(SPEED_RAMP_SECONDS - 1)).toBeLessThan(MAX_SPEED);
    expect(MAX_SPEED - speedAt(SPEED_RAMP_SECONDS - 1)).toBeLessThan(0.01);
  });
});

describe('score', () => {
  it('is distance times multiplier plus coins', () => {
    expect(computeScore(0, 1, 0)).toBe(0);
    expect(computeScore(123.9, 1, 0)).toBe(123);
    expect(computeScore(100, 2, 15)).toBe(215);
  });

  it('grows with distance while running and freezes on a crash', () => {
    const world = new World({ spawning: false });
    world.start();
    world.spawner.spawn('train', 0, -40 - TRAIN_LENGTH / 2);
    for (let i = 0; i < 60; i++) world.step(FIXED_DT);
    expect(world.score).toBe(Math.floor(world.runner.distance));
    while (world.state === 'running') world.step(FIXED_DT);
    const atCrash = world.score;
    for (let i = 0; i < 60; i++) world.step(FIXED_DT);
    expect(world.score).toBe(atCrash);
  });
});

describe('high score persistence', () => {
  it('saves a new best to storage and reloads it in a new session', () => {
    const storage = memoryStorage();
    const first = new HighScoreStore(storage);
    expect(first.value).toBe(0);
    expect(first.submit(250)).toEqual({ best: 250, isNew: true });
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe('250');
    expect(first.submit(100)).toEqual({ best: 250, isNew: false });
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe('250');
    const reloaded = new HighScoreStore(storage);
    expect(reloaded.value).toBe(250);
    expect(reloaded.submit(400).isNew).toBe(true);
    expect(new HighScoreStore(storage).value).toBe(400);
  });

  it('ignores corrupt values and storage failures', () => {
    const storage = memoryStorage();
    storage.data.set(HIGH_SCORE_KEY, 'not a number');
    expect(new HighScoreStore(storage).value).toBe(0);
    const broken: ScoreStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = new HighScoreStore(broken);
    expect(store.value).toBe(0);
    expect(store.submit(10)).toEqual({ best: 10, isNew: true });
    expect(store.persisted).toBe(false);
  });

  it('is submitted when the crash sequence ends in game over', () => {
    const storage = memoryStorage();
    const world = new World({ spawning: false, highScores: new HighScoreStore(storage) });
    world.start();
    world.spawner.spawn('train', 0, -30 - TRAIN_LENGTH / 2);
    const states: string[] = [];
    for (let i = 0; i < 60 * 8 && world.state !== 'gameover'; i++) {
      world.step(FIXED_DT);
      if (states.at(-1) !== world.state) states.push(world.state);
    }
    expect(states).toEqual(['running', 'crashed', 'gameover']);
    expect(world.chase.phase).toBe('caught');
    expect(world.score).toBeGreaterThan(20);
    expect(storage.data.get(HIGH_SCORE_KEY)).toBe(String(world.score));
    expect(world.newHighScore).toBe(true);
    world.restart();
    expect(world.state).toBe('running');
    expect(world.score).toBe(0);
    expect(world.highScore).toBe(Number(storage.data.get(HIGH_SCORE_KEY)));
  });
});
