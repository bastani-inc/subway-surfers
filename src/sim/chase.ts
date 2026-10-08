export type ChasePhase = 'intro' | 'far' | 'close' | 'catching' | 'caught';

export const CHASE = {
  closeGap: 1.6,
  farGap: 16,
  catchGap: 1.2,
  visibleGap: 4,
  introSeconds: 1.6,
  closeSeconds: 4,
  approachSpeed: 18,
  retreatSpeed: 5,
  catchSpeed: 9,
  catchMinSeconds: 0.8,
} as const;

export interface ChaseState {
  phase: ChasePhase;
  gap: number;
  timer: number;
  stumbles: number;
}

export type StumbleOutcome = 'close' | 'caught' | 'ignored';

export const createChase = (): ChaseState => ({ phase: 'intro', gap: CHASE.closeGap, timer: CHASE.introSeconds, stumbles: 0 });

export const beginCatch = (chase: ChaseState): void => {
  if (chase.phase === 'catching' || chase.phase === 'caught') return;
  chase.phase = 'catching';
  chase.timer = 0;
};

export const registerStumble = (chase: ChaseState): StumbleOutcome => {
  if (chase.phase === 'catching' || chase.phase === 'caught') return 'ignored';
  chase.stumbles++;
  if (chase.phase === 'close') {
    beginCatch(chase);
    return 'caught';
  }
  chase.phase = 'close';
  chase.timer = CHASE.closeSeconds;
  return 'close';
};

const targetGap = (phase: ChasePhase): number => {
  if (phase === 'far') return CHASE.farGap;
  if (phase === 'catching' || phase === 'caught') return CHASE.catchGap;
  return CHASE.closeGap;
};

export const stepChase = (chase: ChaseState, dt: number): void => {
  if (chase.phase === 'intro' || chase.phase === 'close') {
    chase.timer -= dt;
    if (chase.timer <= 0) {
      chase.phase = 'far';
      chase.timer = 0;
    }
  } else if (chase.phase !== 'far') {
    chase.timer += dt;
  }
  const target = targetGap(chase.phase);
  const closing = target < chase.gap;
  const speed = closing ? (chase.phase === 'catching' ? CHASE.catchSpeed : CHASE.approachSpeed) : CHASE.retreatSpeed;
  const step = speed * dt;
  chase.gap = Math.abs(target - chase.gap) <= step ? target : chase.gap + Math.sign(target - chase.gap) * step;
  if (chase.phase === 'catching' && chase.gap <= CHASE.catchGap && chase.timer >= CHASE.catchMinSeconds) {
    chase.phase = 'caught';
    chase.timer = 0;
  }
};

export const chaseVisible = (chase: ChaseState): boolean => chase.gap < CHASE.visibleGap;
