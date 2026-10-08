export class FpsMeter {
  private readonly frameTimes: number[] = [];
  private sum = 0;

  constructor(private readonly window = 60) {}

  push(frameMs: number): void {
    this.frameTimes.push(frameMs);
    this.sum += frameMs;
    if (this.frameTimes.length > this.window) this.sum -= this.frameTimes.shift() ?? 0;
  }

  get frameMs(): number {
    return this.frameTimes.length ? this.sum / this.frameTimes.length : 0;
  }

  get fps(): number {
    return this.frameMs > 0 ? 1000 / this.frameMs : 0;
  }
}
