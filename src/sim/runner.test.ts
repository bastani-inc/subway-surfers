import { describe, expect, it } from 'vitest';
import {
  FAST_FALL_VELOCITY,
  FIXED_DT,
  GRAVITY,
  LANE_ARRIVAL_TOLERANCE,
  MAX_LANE_SWITCH_SECONDS,
  JUMP_VELOCITY,
  LANE_SETTLE_FRACTION,
  LANE_SWITCH_SECONDS,
  LANE_WIDTH,
  ROLL_DURATION,
  ROLL_HEIGHT,
  STAND_HEIGHT,
  jumpAirtime,
  jumpApexHeight,
} from './constants';
import { changeLane, colliderOf, createRunner, isRolling, jump, roll, stepRunner } from './runner';
import { FixedStepper } from './fixedStep';

const simulateJump = () => {
  const runner = createRunner();
  jump(runner);
  const heights: number[] = [];
  let steps = 0;
  while (!runner.grounded && steps < 10_000) {
    stepRunner(runner, FIXED_DT);
    heights.push(runner.y);
    steps++;
  }
  return { runner, heights, steps };
};

describe('jump physics', () => {
  it('reaches the apex height given by v^2 / 2g', () => {
    const { runner } = simulateJump();
    const expected = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
    expect(jumpApexHeight()).toBeCloseTo(expected, 10);
    expect(runner.maxJumpHeight).toBeGreaterThan(expected - 0.01);
    expect(runner.maxJumpHeight).toBeLessThanOrEqual(expected + 1e-9);
  });

  it('stays airborne for 2v / g seconds', () => {
    const { steps } = simulateJump();
    const expected = (2 * JUMP_VELOCITY) / GRAVITY;
    expect(jumpAirtime()).toBeCloseTo(expected, 10);
    expect(Math.abs(steps * FIXED_DT - expected)).toBeLessThanOrEqual(FIXED_DT);
  });

  it('follows a parabola with constant downward acceleration, not a linear tween', () => {
    const { heights } = simulateJump();
    const flight = heights.slice(0, -1);
    for (let i = 0; i < flight.length; i++) {
      const t = (i + 1) * FIXED_DT;
      expect(flight[i]).toBeCloseTo(JUMP_VELOCITY * t - 0.5 * GRAVITY * t * t, 9);
    }
    for (let i = 2; i < flight.length; i++) {
      const secondDifference = flight[i] - 2 * flight[i - 1] + flight[i - 2];
      expect(secondDifference / (FIXED_DT * FIXED_DT)).toBeCloseTo(-GRAVITY, 6);
    }
  });

  it('cannot double jump while airborne', () => {
    const runner = createRunner();
    expect(jump(runner)).toBe(true);
    stepRunner(runner, FIXED_DT);
    const vy = runner.vy;
    expect(jump(runner)).toBe(false);
    expect(runner.vy).toBe(vy);
  });

  it('lands with feet at y = 0 and records the landing', () => {
    const { runner } = simulateJump();
    expect(runner.y).toBe(0);
    expect(runner.landings).toBe(1);
    expect(colliderOf(runner).bottomY).toBe(0);
  });
});

describe('lane changes', () => {
  it('clamps to the three lanes', () => {
    const runner = createRunner();
    changeLane(runner, -1);
    changeLane(runner, -1);
    changeLane(runner, -1);
    expect(runner.lane).toBe(-1);
    for (let i = 0; i < 5; i++) changeLane(runner, 1);
    expect(runner.lane).toBe(1);
  });

  it('snaps to the next lane in about 0.12 s with eased momentum and no overshoot', () => {
    const runner = createRunner();
    changeLane(runner, 1);
    const xs: number[] = [];
    const vxs: number[] = [];
    for (let i = 0; i < 60; i++) {
      stepRunner(runner, FIXED_DT);
      xs.push(runner.x);
      vxs.push(runner.vx);
    }
    const settleStep = xs.findIndex((x) => x >= LANE_WIDTH * LANE_SETTLE_FRACTION);
    const settleSeconds = (settleStep + 1) * FIXED_DT;
    expect(settleSeconds).toBeGreaterThanOrEqual(LANE_SWITCH_SECONDS - FIXED_DT);
    expect(settleSeconds).toBeLessThanOrEqual(LANE_SWITCH_SECONDS + FIXED_DT);
    expect(xs[0]).toBeLessThan(LANE_WIDTH * 0.2);
    expect(vxs[1]).toBeGreaterThan(0);
    const peak = vxs.indexOf(Math.max(...vxs));
    expect(peak).toBeLessThan(settleStep);
    for (let i = peak + 1; i < vxs.length; i++) expect(vxs[i]).toBeLessThanOrEqual(vxs[i - 1] + 1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(LANE_WIDTH + 1e-9);
    expect(runner.x).toBeCloseTo(LANE_WIDTH, 3);
  });

  it('completes a lane switch within 0.15 s, in both directions and back-to-back', () => {
    const timeToArrive = (runner: ReturnType<typeof createRunner>, targetX: number) => {
      let steps = 0;
      while (Math.abs(runner.x - targetX) > LANE_ARRIVAL_TOLERANCE && steps < 120) {
        stepRunner(runner, FIXED_DT);
        steps++;
      }
      return steps * FIXED_DT;
    };
    const runner = createRunner();
    changeLane(runner, 1);
    expect(timeToArrive(runner, LANE_WIDTH)).toBeLessThanOrEqual(MAX_LANE_SWITCH_SECONDS);
    changeLane(runner, -1);
    expect(timeToArrive(runner, 0)).toBeLessThanOrEqual(MAX_LANE_SWITCH_SECONDS);
    changeLane(runner, -1);
    stepRunner(runner, FIXED_DT);
    stepRunner(runner, FIXED_DT);
    changeLane(runner, 1);
    expect(timeToArrive(runner, 0)).toBeLessThanOrEqual(MAX_LANE_SWITCH_SECONDS);
  });

});

describe('roll', () => {
  it('lowers the collider for exactly the roll duration', () => {
    const runner = createRunner();
    expect(colliderOf(runner).height).toBe(STAND_HEIGHT);
    roll(runner);
    expect(isRolling(runner)).toBe(true);
    expect(colliderOf(runner).height).toBe(ROLL_HEIGHT);
    let steps = 0;
    while (isRolling(runner)) {
      expect(colliderOf(runner).height).toBe(ROLL_HEIGHT);
      stepRunner(runner, FIXED_DT);
      steps++;
    }
    expect(Math.abs(steps * FIXED_DT - ROLL_DURATION)).toBeLessThanOrEqual(FIXED_DT);
    expect(colliderOf(runner).height).toBe(STAND_HEIGHT);
  });

  it('fast-falls when rolling mid-air and rolls on landing', () => {
    const runner = createRunner();
    jump(runner);
    for (let i = 0; i < 10; i++) stepRunner(runner, FIXED_DT);
    expect(runner.vy).toBeGreaterThan(0);
    expect(roll(runner)).toBe(true);
    expect(runner.vy).toBeLessThanOrEqual(-FAST_FALL_VELOCITY);
    expect(isRolling(runner)).toBe(false);
    let steps = 0;
    while (!runner.grounded && steps < 600) {
      expect(runner.vy).toBeLessThanOrEqual(-FAST_FALL_VELOCITY);
      stepRunner(runner, FIXED_DT);
      steps++;
    }
    expect(steps * FIXED_DT).toBeLessThan(jumpAirtime() / 2);
    expect(runner.y).toBe(0);
    expect(isRolling(runner)).toBe(true);
    expect(colliderOf(runner).height).toBe(ROLL_HEIGHT);
    expect(runner.rollTimeLeft).toBeCloseTo(ROLL_DURATION - FIXED_DT, 9);
  });
});

describe('fixed-step integration', () => {
  it('runs 60 steps per simulated second regardless of frame pacing', () => {
    let count = 0;
    const stepper = new FixedStepper(() => count++);
    for (let i = 0; i < 144; i++) stepper.advance(1 / 144);
    expect(count).toBeGreaterThanOrEqual(59);
    expect(count).toBeLessThanOrEqual(60);
    count = 0;
    for (let i = 0; i < 30; i++) stepper.advance(1 / 30);
    expect(count).toBe(60);
  });

  it('caps catch-up steps after a long stall', () => {
    let count = 0;
    const stepper = new FixedStepper(() => count++);
    stepper.advance(5);
    expect(count).toBeLessThanOrEqual(12);
  });
});
