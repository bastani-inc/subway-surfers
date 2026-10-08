export const SIM_HZ = 60;
export const FIXED_DT = 1 / SIM_HZ;
export const MAX_STEPS_PER_FRAME = 12;

export const LANE_WIDTH = 2.2;
export const LANES = [-1, 0, 1] as const;
export const MIN_LANE = -1;
export const MAX_LANE = 1;

export const GRAVITY = 32;
export const JUMP_VELOCITY = 11.5;
export const FAST_FALL_VELOCITY = 16;

export const LANE_SWITCH_SECONDS = 0.12;
export const LANE_SETTLE_FRACTION = 0.9;
export const LANE_OMEGA = 32;

export const STAND_HEIGHT = 1.7;
export const ROLL_HEIGHT = 0.8;
export const ROLL_DURATION = 0.65;
export const COLLIDER_WIDTH = 0.7;
export const COLLIDER_DEPTH = 0.6;

export const START_SPEED = 12;
export const MAX_SPEED = 30;
export const SPEED_RAMP_SECONDS = 180;

export const STRIDE_LENGTH = 2.6;

export const jumpApexHeight = (velocity = JUMP_VELOCITY, gravity = GRAVITY): number =>
  (velocity * velocity) / (2 * gravity);

export const jumpAirtime = (velocity = JUMP_VELOCITY, gravity = GRAVITY): number =>
  (2 * velocity) / gravity;

export const STEP_UP = 0.3;

export const TRAIN_WIDTH = 2.0;
export const TRAIN_HEIGHT = 3.2;
export const TRAIN_LENGTH = 12;
export const TRAIN_COUPLING_GAP = 0.4;
export const ONCOMING_SPEED = 10;
export const ONCOMING_ACTIVATION_DISTANCE = 70;
export const ONCOMING_CLEARANCE = 36;

export const BARRIER_LOW_WIDTH = 2.0;
export const BARRIER_LOW_HEIGHT = 1.0;
export const BARRIER_LOW_DEPTH = 0.35;

export const GANTRY_WIDTH = 2.1;
export const GANTRY_HEIGHT = 2.5;
export const GANTRY_CLEARANCE = 1.15;
export const GANTRY_POST_WIDTH = 0.14;
export const GANTRY_DEPTH = 0.3;

export const KNOCKBACK_VZ = 7;
export const KNOCKBACK_VY = 5.5;
export const KNOCKBACK_FRICTION = 14;
export const FALL_SECONDS = 0.45;
export const STUMBLE_SECONDS = 0.45;
export const SCRAPE_BOUNCE_VX = 5;
export const GAME_OVER_DELAY = 0.9;
