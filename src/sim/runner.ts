import {
  COLLIDER_DEPTH,
  COLLIDER_WIDTH,
  FALL_SECONDS,
  FAST_FALL_VELOCITY,
  GRAVITY,
  JETPACK_OMEGA,
  KNOCKBACK_FRICTION,
  KNOCKBACK_VY,
  KNOCKBACK_VZ,
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
  STUMBLE_SECONDS,
} from './constants';

export type SupportProbe = (runner: RunnerState, referenceY: number) => number;

const flatGround: SupportProbe = () => 0;

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
  fromLane: number;
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
  stumbleTimeLeft: number;
  knockbackVz: number;
  fall: number;
  flightAltitude: number;
}

export const createRunner = (): RunnerState => ({
  lane: 0,
  fromLane: 0,
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
  stumbleTimeLeft: 0,
  knockbackVz: 0,
  fall: 0,
  flightAltitude: 0,
});

export const clampLane = (lane: number): number => Math.max(MIN_LANE, Math.min(MAX_LANE, lane));

export const laneX = (lane: number): number => lane * LANE_WIDTH;

export const isRolling = (runner: RunnerState): boolean => runner.rollTimeLeft > 0;

export const isFlying = (runner: RunnerState): boolean => runner.flightAltitude > 0;

export const changeLane = (runner: RunnerState, direction: -1 | 1): void => {
  const next = clampLane(runner.lane + direction);
  if (next === runner.lane) return;
  runner.fromLane = runner.lane;
  runner.lane = next;
};

export const bounceToPreviousLane = (runner: RunnerState, obstacleX: number, bounceVx: number): void => {
  const away = runner.x >= obstacleX ? 1 : -1;
  const target = runner.fromLane !== runner.lane ? runner.fromLane : clampLane(runner.lane + away);
  runner.fromLane = runner.lane;
  runner.lane = target;
  runner.vx = Math.sign(laneX(target) - runner.x || away) * bounceVx;
};

export const stumble = (runner: RunnerState): void => {
  runner.stumbleTimeLeft = STUMBLE_SECONDS;
};

export const knockBack = (runner: RunnerState): void => {
  runner.speed = 0;
  runner.rollTimeLeft = 0;
  runner.rollQueued = false;
  runner.stumbleTimeLeft = 0;
  runner.knockbackVz = KNOCKBACK_VZ;
  runner.vy = KNOCKBACK_VY;
  runner.grounded = false;
  runner.fall = 0;
  runner.flightAltitude = 0;
};

export const takeOff = (runner: RunnerState, altitude: number): void => {
  runner.flightAltitude = altitude;
  runner.grounded = false;
  runner.rollTimeLeft = 0;
  runner.rollQueued = false;
};

export const endFlight = (runner: RunnerState): void => {
  if (!isFlying(runner)) return;
  runner.flightAltitude = 0;
  runner.vy = Math.min(runner.vy, 0);
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

export const roll = (runner: RunnerState): boolean => {
  if (isFlying(runner)) return false;
  if (runner.grounded) {
    runner.rollTimeLeft = ROLL_DURATION;
    return true;
  }
  runner.vy = Math.min(runner.vy, -FAST_FALL_VELOCITY);
  runner.rollQueued = true;
  return true;
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

const stepFlight = (runner: RunnerState, dt: number): void => {
  const offset = runner.y - runner.flightAltitude;
  const carry = runner.vy + JETPACK_OMEGA * offset;
  const decay = Math.exp(-JETPACK_OMEGA * dt);
  runner.y = runner.flightAltitude + (offset + carry * dt) * decay;
  runner.vy = (runner.vy - JETPACK_OMEGA * carry * dt) * decay;
  runner.grounded = false;
  runner.maxJumpHeight = Math.max(runner.maxJumpHeight, runner.y);
};

const stepVertical = (runner: RunnerState, dt: number, support: SupportProbe): void => {
  if (runner.grounded) {
    const ground = support(runner, runner.y);
    if (ground >= runner.y) {
      runner.y = ground;
      return;
    }
    runner.grounded = false;
    runner.vy = 0;
  }
  const startY = runner.y;
  runner.y += runner.vy * dt - 0.5 * GRAVITY * dt * dt;
  runner.vy -= GRAVITY * dt;
  runner.maxJumpHeight = Math.max(runner.maxJumpHeight, runner.y);
  const ground = support(runner, startY);
  if (runner.y <= ground && runner.vy <= 0) {
    runner.y = ground;
    runner.vy = 0;
    runner.grounded = true;
    runner.landings++;
    if (runner.rollQueued) {
      runner.rollQueued = false;
      runner.rollTimeLeft = ROLL_DURATION;
    }
  }
};

export const stepRunner = (runner: RunnerState, dt: number, support: SupportProbe = flatGround): void => {
  runner.elapsed += dt;
  runner.speed = speedAt(runner.elapsed);
  runner.distance += runner.speed * dt;
  runner.z = -runner.distance;
  stepLateral(runner, dt);
  if (isFlying(runner)) stepFlight(runner, dt);
  else stepVertical(runner, dt, support);
  if (runner.rollTimeLeft > 0) runner.rollTimeLeft = Math.max(0, runner.rollTimeLeft - dt);
  if (runner.stumbleTimeLeft > 0) runner.stumbleTimeLeft = Math.max(0, runner.stumbleTimeLeft - dt);
};

export const stepKnockedBack = (runner: RunnerState, dt: number, support: SupportProbe = flatGround): void => {
  runner.z += runner.knockbackVz * dt;
  if (runner.grounded) runner.knockbackVz = Math.max(0, runner.knockbackVz - KNOCKBACK_FRICTION * dt);
  runner.fall = Math.min(1, runner.fall + dt / FALL_SECONDS);
  stepLateral(runner, dt);
  stepVertical(runner, dt, support);
};

export const colliderOf = (runner: RunnerState): Collider => ({
  centerX: runner.x,
  bottomY: runner.y,
  centerZ: runner.z,
  width: COLLIDER_WIDTH,
  height: isRolling(runner) ? ROLL_HEIGHT : STAND_HEIGHT,
  depth: COLLIDER_DEPTH,
});
