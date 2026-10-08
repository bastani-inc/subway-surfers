import type { Collider } from './runner';
import { rampHeightAt, type PartDef } from './obstacleDefs';

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type HitKind = 'roof' | 'crash' | 'scrape' | 'clip';

export const boxOfCollider = (c: Collider): Box => ({
  minX: c.centerX - c.width / 2,
  maxX: c.centerX + c.width / 2,
  minY: c.bottomY,
  maxY: c.bottomY + c.height,
  minZ: c.centerZ - c.depth / 2,
  maxZ: c.centerZ + c.depth / 2,
});

export const overlaps = (a: Box, b: Box): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;

export const footprintOverlaps = (a: Box, b: Box): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

export const partBox = (part: PartDef, originX: number, originZ: number, probeZ = originZ): Box => ({
  minX: originX + part.min[0],
  maxX: originX + part.max[0],
  minY: part.min[1],
  maxY: part.surface === 'ramp' ? rampHeightAt(part, probeZ - originZ) : part.max[1],
  minZ: originZ + part.min[2],
  maxZ: originZ + part.max[2],
});

type Axis = 'x' | 'y' | 'z';

const gap = (a: Box, b: Box, axis: Axis): number => {
  if (axis === 'x') return Math.max(b.minX - a.maxX, a.minX - b.maxX);
  if (axis === 'y') return Math.max(b.minY - a.maxY, a.minY - b.maxY);
  return Math.max(b.minZ - a.maxZ, a.minZ - b.maxZ);
};

export const entryAxis = (prevRunner: Box, runner: Box, prevPart: Box, part: Box): Axis | null => {
  let axis: Axis | null = null;
  let latest = -Infinity;
  for (const candidate of ['x', 'y', 'z'] as const) {
    const before = gap(prevRunner, prevPart, candidate);
    if (before < 0) continue;
    const after = gap(runner, part, candidate);
    const entry = before / Math.max(1e-9, before - after);
    if (entry > latest) {
      latest = entry;
      axis = candidate;
    }
  }
  return axis;
};

export const classifyHit = (prevRunner: Box, runner: Box, prevPart: Box, part: Box, walkable: boolean): HitKind | null => {
  const axis = entryAxis(prevRunner, runner, prevPart, part);
  if (axis === null) return null;
  if (axis === 'x') return 'scrape';
  if (axis === 'z') return 'crash';
  const fromAbove = prevRunner.minY >= prevPart.maxY;
  return fromAbove && walkable ? 'roof' : 'clip';
};
