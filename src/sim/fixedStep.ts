import { FIXED_DT, MAX_STEPS_PER_FRAME } from './constants';

export class FixedStepper {
  private accumulator = 0;
  totalSteps = 0;

  constructor(
    private readonly step: (dt: number) => void,
    readonly dt = FIXED_DT,
    private readonly maxSteps = MAX_STEPS_PER_FRAME,
  ) {}

  advance(frameSeconds: number): number {
    this.accumulator += Math.max(0, frameSeconds);
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxSteps) {
      this.step(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    if (steps === this.maxSteps) this.accumulator = Math.min(this.accumulator, this.dt);
    this.totalSteps += steps;
    return steps;
  }

  get alpha(): number {
    return this.accumulator / this.dt;
  }
}
