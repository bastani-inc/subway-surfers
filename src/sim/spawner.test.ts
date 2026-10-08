import { describe, expect, it } from 'vitest';
import { LANES, ONCOMING_CLEARANCE, TRAIN_LENGTH } from './constants';
import { halfLengthOf } from './obstacleDefs';
import { FIRST_PATTERN_DISTANCE, SPAWN_AHEAD, Spawner } from './spawner';

const drive = (spawner: Spawner, meters: number, onStep?: (z: number) => void) => {
  for (let z = 0; z > -meters; z -= 2) {
    spawner.update(z, 20);
    spawner.moveObstacles(z, 0.1);
    onStep?.(z);
  }
};

describe('procedural spawner', () => {
  it('keeps an obstacle-free runway and fills the view ahead', () => {
    const spawner = new Spawner(7);
    spawner.update(0, 12);
    expect(spawner.active.length).toBeGreaterThan(0);
    for (const o of spawner.active) expect(o.z + halfLengthOf(o.kind)).toBeLessThanOrEqual(-FIRST_PATTERN_DISTANCE + 1e-9);
    expect(spawner.nextZ).toBeLessThanOrEqual(-SPAWN_AHEAD);
  });

  it('recycles obstacles through a bounded pool', () => {
    const spawner = new Spawner(3);
    drive(spawner, 4000);
    expect(spawner.spawned).toBeGreaterThan(150);
    expect(spawner.recycled).toBeGreaterThan(100);
    expect(spawner.created).toBeLessThan(80);
    expect(spawner.created).toBe(spawner.active.length + spawner.pooled);
  });

  it('is deterministic for a seed', () => {
    const layout = (seed: number) => {
      const s = new Spawner(seed);
      s.update(-500, 20);
      return s.active.map((o) => `${o.kind}:${o.lane}:${o.z.toFixed(2)}:${o.oncoming}`).join('|');
    };
    expect(layout(11)).toBe(layout(11));
    expect(layout(11)).not.toBe(layout(12));
  });

  it('spawns every obstacle type, groups trains with ramp cars, and leaves a lane open', () => {
    const spawner = new Spawner(5);
    const seen = new Set<string>();
    drive(spawner, 3000, () => {
      for (const o of spawner.active) seen.add(o.oncoming ? 'oncoming' : o.kind);
    });
    expect([...seen].sort()).toEqual(['barrierHigh', 'barrierLow', 'oncoming', 'rampCar', 'train']);
    expect(spawner.patternCounts.trainGroup).toBeGreaterThan(5);

    const fresh = new Spawner(9);
    fresh.update(-2000, 20);
    const ramps = fresh.active.filter((o) => o.kind === 'rampCar');
    expect(ramps.length).toBeGreaterThan(0);
    for (const ramp of ramps) {
      const behind = fresh.active.find((o) => o.kind === 'train' && o.lane === ramp.lane && Math.abs(o.z - (ramp.z - TRAIN_LENGTH)) < 1e-6);
      expect(behind).toBeDefined();
    }
  });

  it('never blocks all three lanes with stationary trains at once', () => {
    const spawner = new Spawner(21);
    spawner.update(-3000, 20);
    const trains = spawner.active.filter((o) => o.kind === 'train' && !o.oncoming);
    for (let z = -60; z > -3000; z -= 1) {
      const blocked = LANES.filter((lane) =>
        spawner.active.some((o) => o.lane === lane && o.kind === 'train' && Math.abs(o.z - z) < halfLengthOf(o.kind)),
      );
      const rampAvailable = spawner.active.some((o) => {
        const rampFar = o.z - halfLengthOf(o.kind);
        return o.kind === 'rampCar' && z <= rampFar && z > rampFar - 40;
      });
      expect(blocked.length < 3 || rampAvailable).toBe(true);
    }
    expect(trains.length).toBeGreaterThan(10);
  });

  it('only sends oncoming trains down a lane that is clear ahead of them', () => {
    const spawner = new Spawner(13);
    drive(spawner, 4000, () => {
      for (const o of spawner.active) {
        if (!o.oncoming) continue;
        const near = o.z + halfLengthOf(o.kind);
        for (const other of spawner.active) {
          if (other === o || other.lane !== o.lane || other.z < o.z) continue;
          expect(other.z - halfLengthOf(other.kind)).toBeGreaterThanOrEqual(near - 1e-6);
        }
      }
    });
    expect(ONCOMING_CLEARANCE).toBeGreaterThan(30);
  });
});
