export const HIGH_SCORE_KEY = 'neonRailRush.highScore';

export const computeScore = (distance: number, multiplier: number, coins: number): number =>
  Math.floor(Math.max(0, distance) * multiplier) + coins;

export type ScoreStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class HighScoreStore {
  private best: number;
  persisted = false;

  constructor(
    private readonly storage: ScoreStorage | null,
    private readonly key = HIGH_SCORE_KEY,
  ) {
    this.best = this.load();
  }

  private load(): number {
    try {
      const value = Number.parseInt(this.storage?.getItem(this.key) ?? '', 10);
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  get value(): number {
    return this.best;
  }

  submit(score: number): { best: number; isNew: boolean } {
    const isNew = score > this.best;
    if (isNew) {
      this.best = Math.floor(score);
      try {
        this.storage?.setItem(this.key, String(this.best));
        this.persisted = this.storage !== null;
      } catch {
        this.persisted = false;
      }
    }
    return { best: this.best, isNew };
  }
}
