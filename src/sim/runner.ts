import {
  COLLIDER_DEPTH,
  COLLIDER_WIDTH,
  FAST_FALL_VELOCITY,
  GRAVITY,
  JUMP_VELOCITY,
  LANE_OMEGA,
  LANE_WIDTH,
  MAX_LANE,
  MAX_SPEED,
  MIN_LANE,
  ROLL_DURATION,
  ROLL_HEIGHT,
  SPEED_RAMP_SECONDS,
  STAND_HEIGHT,
  START_SPEED,
} from './constants';

export interface Collider {
  centerX: number;
  bottomY: number;
  centerZ: number;
  width: number;
  height: number;
  depth: number;
}

export interface RunnerState {
  lane: number;
  x: number;
  vx: number;
  y: number;
  vy: number;
  z: number;
  grounded: boolean;
  rollTimeLeft: number;
  rollQueued: boolean;
  distance: number;
  speed: number;
  elapsed: number;
  maxJumpHeight: number;
  landings: number;
}

export const createRunner = (): RunnerState => ({
  lane: 0,
  x: 0,
  vx: 0,
  y: 0,
  vy: 0,
  z: 0,
  grounded: true,
  rollTimeLeft: 0,
  rollQueued: false,
  distance: 0,
  speed: START_SPEED,
  elapsed: 0,
  maxJumpHeight: 0,
  landings: 0,
});

export const clampLane = (lane: number): number => Math.max(MIN_LANE, Math.min(MAX_LANE, lane));

export const laneX = (lane: number): number => lane * LANE_WIDTH;

export const isRolling = (runner: RunnerState): boolean => runner.rollTimeLeft > 0;

export const changeLane = (runner: RunnerState, direction: -1 | 1): void => {
  runner.lane = clampLane(runner.lane + direction);
};

export const jump = (runner: RunnerState, velocity = JUMP_VELOCITY): boolean => {
  if (!runner.grounded) return false;
  runner.rollTimeLeft = 0;
  runner.rollQueued = false;
  runner.grounded = false;
  runner.vy = velocity;
  runner.maxJumpHeight = 0;
  return true;
};

export const roll = (runner: RunnerState): void => {
  if (runner.grounded) {
    runner.rollTimeLeft = ROLL_DURATION;
    return;
  }
  runner.vy = Math.min(runner.vy, -FAST_FALL_VELOCITY);
  runner.rollQueued = true;
};

export const speedAt = (elapsed: number): number => {
  const t = Math.min(1, elapsed / SPEED_RAMP_SECONDS);
  const eased = 1 - (1 - t) * (1 - t);
  return START_SPEED + (MAX_SPEED - START_SPEED) * eased;
};

const stepLateral = (runner: RunnerState, dt: number): void => {
  const offset = runner.x - laneX(runner.lane);
  const carry = runner.vx + LANE_OMEGA * offset;
  const decay = Math.exp(-LANE_OMEGA * dt);
  runner.x = laneX(runner.lane) + (offset + carry * dt) * decay;
  runner.vx = (runner.vx - LANE_OMEGA * carry * dt) * decay;
};

const stepVertical = (runner: RunnerState, dt: number): void => {
  if (runner.grounded) return;
  runner.y += runner.vy * dt - 0.5 * GRAVITY * dt * dt;
  runner.vy -= GRAVITY * dt;
  runner.maxJumpHeight = Math.max(runner.maxJumpHeight, runner.y);
  if (runner.y <= 0) {
    runner.y = 0;
    runner.vy = 0;
    runner.grounded = true;
    runner.landings++;
    if (runner.rollQueued) {
      runner.rollQueued = false;
      runner.rollTimeLeft = ROLL_DURATION;
    }
  }
};

export const stepRunner = (runner: RunnerState, dt: number): void => {
  runner.elapsed += dt;
  runner.speed = speedAt(runner.elapsed);
  runner.distance += runner.speed * dt;
  runner.z = -runner.distance;
  stepLateral(runner, dt);
  stepVertical(runner, dt);
  if (runner.rollTimeLeft > 0) runner.rollTimeLeft = Math.max(0, runner.rollTimeLeft - dt);
};

export const colliderOf = (runner: RunnerState): Collider => ({
  centerX: runner.x,
  bottomY: runner.y,
  centerZ: runner.z,
  width: COLLIDER_WIDTH,
  height: isRolling(runner) ? ROLL_HEIGHT : STAND_HEIGHT,
  depth: COLLIDER_DEPTH,
});
