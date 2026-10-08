import { describe, expect, it } from 'vitest';
import { FIXED_DT } from './constants';
import { CHASE, chaseVisible, createChase, registerStumble, stepChase, type ChaseState } from './chase';

const advance = (chase: ChaseState, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) stepChase(chase, FIXED_DT);
};

const visibleSeconds = (chase: ChaseState, maxSeconds: number) => {
  let steps = 0;
  for (let i = 0; i < maxSeconds / FIXED_DT; i++) {
    stepChase(chase, FIXED_DT);
    if (chaseVisible(chase)) steps++;
  }
  return steps * FIXED_DT;
};

describe('chase state machine', () => {
  it('starts right behind the runner, then drops back out of view', () => {
    const chase = createChase();
    expect(chase.phase).toBe('intro');
    expect(chaseVisible(chase)).toBe(true);
    advance(chase, CHASE.introSeconds - 0.1);
    expect(chaseVisible(chase)).toBe(true);
    advance(chase, 0.2);
    expect(chase.phase).toBe('far');
    advance(chase, 4);
    expect(chaseVisible(chase)).toBe(false);
    expect(chase.gap).toBe(CHASE.farGap);
  });

  it('brings the chasers close for about 4 s after a stumble, then drops them back', () => {
    const chase = createChase();
    advance(chase, 6);
    expect(registerStumble(chase)).toBe('close');
    expect(chase.phase).toBe('close');
    advance(chase, 1);
    expect(chaseVisible(chase)).toBe(true);
    expect(chase.gap).toBe(CHASE.closeGap);
    const remaining = visibleSeconds(chase, 6);
    expect(remaining + 1).toBeGreaterThan(3.5);
    expect(remaining + 1).toBeLessThan(5);
    expect(chase.phase).toBe('far');
    expect(chaseVisible(chase)).toBe(false);
  });

  it('catches the runner on a second stumble inside the close window', () => {
    const chase = createChase();
    advance(chase, 6);
    registerStumble(chase);
    advance(chase, 3.5);
    expect(registerStumble(chase)).toBe('caught');
    expect(chase.phase).toBe('catching');
    advance(chase, CHASE.catchMinSeconds - 0.1);
    expect(chase.phase).toBe('catching');
    advance(chase, 0.5);
    expect(chase.phase).toBe('caught');
    expect(chase.gap).toBe(CHASE.catchGap);
    expect(registerStumble(chase)).toBe('ignored');
  });

  it('does not catch on a stumble after the window has expired', () => {
    const chase = createChase();
    advance(chase, 6);
    registerStumble(chase);
    advance(chase, CHASE.closeSeconds + 0.1);
    expect(chase.phase).toBe('far');
    expect(registerStumble(chase)).toBe('close');
    expect(chase.stumbles).toBe(2);
  });

  it('treats a stumble during the opening chase as the first stumble', () => {
    const chase = createChase();
    advance(chase, 0.5);
    expect(registerStumble(chase)).toBe('close');
    expect(chase.timer).toBe(CHASE.closeSeconds);
  });
});
