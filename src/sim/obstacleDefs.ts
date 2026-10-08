import {
  BARRIER_LOW_DEPTH,
  BARRIER_LOW_HEIGHT,
  BARRIER_LOW_WIDTH,
  GANTRY_CLEARANCE,
  GANTRY_DEPTH,
  GANTRY_HEIGHT,
  GANTRY_POST_WIDTH,
  GANTRY_WIDTH,
  TRAIN_HEIGHT,
  TRAIN_LENGTH,
  TRAIN_WIDTH,
} from './constants';

export type ObstacleKind = 'train' | 'rampCar' | 'barrierLow' | 'barrierHigh';

export type Vec3 = readonly [number, number, number];

export type PartSurface = 'solid' | 'roof' | 'ramp';

export interface PartDef {
  readonly name: string;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly surface: PartSurface;
}

export interface ObstacleDef {
  readonly kind: ObstacleKind;
  readonly modelId: string;
  readonly size: { readonly width: number; readonly height: number; readonly length: number };
  readonly parts: readonly PartDef[];
}

const halfBox = (name: string, width: number, minY: number, maxY: number, length: number, surface: PartSurface): PartDef => ({
  name,
  min: [-width / 2, minY, -length / 2],
  max: [width / 2, maxY, length / 2],
  surface,
});

const postX = GANTRY_WIDTH / 2 - GANTRY_POST_WIDTH;

export const OBSTACLE_DEFS: Readonly<Record<ObstacleKind, ObstacleDef>> = {
  train: {
    kind: 'train',
    modelId: 'train',
    size: { width: TRAIN_WIDTH, height: TRAIN_HEIGHT, length: TRAIN_LENGTH },
    parts: [halfBox('car', TRAIN_WIDTH, 0, TRAIN_HEIGHT, TRAIN_LENGTH, 'roof')],
  },
  rampCar: {
    kind: 'rampCar',
    modelId: 'train',
    size: { width: TRAIN_WIDTH, height: TRAIN_HEIGHT, length: TRAIN_LENGTH },
    parts: [halfBox('ramp', TRAIN_WIDTH, 0, TRAIN_HEIGHT, TRAIN_LENGTH, 'ramp')],
  },
  barrierLow: {
    kind: 'barrierLow',
    modelId: 'barrier_low',
    size: { width: BARRIER_LOW_WIDTH, height: BARRIER_LOW_HEIGHT, length: BARRIER_LOW_DEPTH },
    parts: [halfBox('barrier', BARRIER_LOW_WIDTH, 0, BARRIER_LOW_HEIGHT, BARRIER_LOW_DEPTH, 'solid')],
  },
  barrierHigh: {
    kind: 'barrierHigh',
    modelId: 'barrier_high',
    size: { width: GANTRY_WIDTH, height: GANTRY_HEIGHT, length: GANTRY_DEPTH },
    parts: [
      { name: 'postLeft', min: [-GANTRY_WIDTH / 2, 0, -GANTRY_DEPTH / 2], max: [-postX, GANTRY_HEIGHT, GANTRY_DEPTH / 2], surface: 'solid' },
      { name: 'postRight', min: [postX, 0, -GANTRY_DEPTH / 2], max: [GANTRY_WIDTH / 2, GANTRY_HEIGHT, GANTRY_DEPTH / 2], surface: 'solid' },
      { name: 'sign', min: [-postX, GANTRY_CLEARANCE, -GANTRY_DEPTH / 2], max: [postX, GANTRY_HEIGHT, GANTRY_DEPTH / 2], surface: 'solid' },
    ],
  },
};

export const OBSTACLE_KINDS = Object.keys(OBSTACLE_DEFS) as ObstacleKind[];

export const halfLengthOf = (kind: ObstacleKind): number => OBSTACLE_DEFS[kind].size.length / 2;

export const rampHeightAt = (part: PartDef, localZ: number): number => {
  const t = (part.max[2] - Math.min(part.max[2], Math.max(part.min[2], localZ))) / (part.max[2] - part.min[2]);
  return part.min[1] + (part.max[1] - part.min[1]) * t;
};
