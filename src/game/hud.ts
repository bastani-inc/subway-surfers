const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

export interface PowerUpTimer {
  kind: string;
  label: string;
  timeLeft: number;
  duration: number;
  color: string;
}

interface TimerRow {
  row: HTMLDivElement;
  fill: HTMLDivElement;
  seconds: HTMLSpanElement;
  shown: string;
}

export interface HudValues {
  score: number;
  coins: number;
  best: number;
  multiplier: number;
  timers: readonly PowerUpTimer[];
}

export class Hud {
  readonly element = element('div', 'hud');
  private readonly score = element('div', 'hud-score', '0');
  private readonly coins = element('div', 'hud-coins');
  private readonly coinCount = element('span', 'hud-coin-count', '0');
  private readonly best = element('div', 'hud-best', 'best 0');
  private readonly multiplier = element('div', 'hud-multiplier', 'x1');
  private readonly powerUps = element('div', 'hud-powerups');
  private readonly rows = new Map<string, TimerRow>();
  private shown = { score: -1, coins: -1, best: -1, multiplier: -1 };

  constructor(parent: HTMLElement) {
    this.element.id = 'hud';
    this.score.id = 'hud-score';
    this.coins.id = 'hud-coins';
    this.best.id = 'hud-best';
    this.multiplier.id = 'hud-multiplier';
    this.powerUps.id = 'hud-powerups';
    this.coins.append(element('span', 'hud-coin-icon'), this.coinCount);
    const top = element('div', 'hud-top');
    top.append(this.multiplier, this.score);
    this.element.append(top, this.coins, this.best, this.powerUps);
    this.element.hidden = true;
    parent.append(this.element);
  }

  set visible(value: boolean) {
    this.element.hidden = !value;
  }

  update({ score, coins, best, multiplier, timers }: HudValues): void {
    if (score !== this.shown.score) this.score.textContent = String(score);
    if (coins !== this.shown.coins) {
      this.coinCount.textContent = String(coins);
      if (coins > this.shown.coins && this.shown.coins >= 0) this.bump(this.coins);
    }
    if (best !== this.shown.best) this.best.textContent = `best ${best}`;
    if (multiplier !== this.shown.multiplier) {
      this.multiplier.textContent = `x${multiplier}`;
      this.multiplier.classList.toggle('boosted', multiplier > 1);
    }
    this.shown = { score, coins, best, multiplier };
    this.updateTimers(timers);
  }

  private bump(node: HTMLElement): void {
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  private updateTimers(timers: readonly PowerUpTimer[]): void {
    const live = new Set<string>();
    for (const timer of timers) {
      live.add(timer.kind);
      let row = this.rows.get(timer.kind);
      if (!row) {
        row = this.createRow(timer);
        this.rows.set(timer.kind, row);
      }
      const fraction = Math.max(0, Math.min(1, timer.timeLeft / timer.duration));
      row.fill.style.transform = `scaleX(${fraction.toFixed(3)})`;
      const text = `${timer.timeLeft.toFixed(1)}s`;
      if (text !== row.shown) {
        row.seconds.textContent = text;
        row.shown = text;
      }
      row.row.classList.toggle('ending', timer.timeLeft < 2);
    }
    for (const [kind, row] of this.rows) {
      if (live.has(kind)) continue;
      row.row.remove();
      this.rows.delete(kind);
    }
  }

  private createRow(timer: PowerUpTimer): TimerRow {
    const row = element('div', 'hud-power');
    row.id = `hud-power-${timer.kind}`;
    row.dataset.kind = timer.kind;
    row.style.setProperty('--power-color', timer.color);
    const label = element('span', 'hud-power-label', timer.label);
    const bar = element('div', 'hud-power-bar');
    const fill = element('div', 'hud-power-fill');
    bar.append(fill);
    const seconds = element('span', 'hud-power-seconds', '');
    row.append(label, bar, seconds);
    this.powerUps.append(row);
    return { row, fill, seconds, shown: '' };
  }
}

export class GameOverScreen {
  readonly element = element('div', 'game-over');
  readonly restartButton = element('button', 'game-over-restart', 'Run again');
  private readonly title = element('h1', 'game-over-title', 'Caught!');
  private readonly subtitle = element('p', 'game-over-subtitle', '');
  private readonly score = element('div', 'game-over-score', '0');
  private readonly best = element('div', 'game-over-best', 'best 0');
  private readonly newBest = element('div', 'game-over-new-best', 'New best!');

  constructor(parent: HTMLElement, onRestart: () => void) {
    this.element.id = 'game-over';
    this.score.id = 'game-over-score';
    this.best.id = 'game-over-best';
    this.restartButton.id = 'game-over-restart';
    this.restartButton.type = 'button';
    const card = element('div', 'game-over-card');
    const scoreLabel = element('div', 'game-over-label', 'score');
    card.append(this.title, this.subtitle, scoreLabel, this.score, this.newBest, this.best, this.restartButton);
    this.element.append(card);
    this.element.hidden = true;
    this.restartButton.addEventListener('pointerup', (event) => {
      event.stopPropagation();
      onRestart();
    });
    this.restartButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.restartButton.addEventListener('click', (event) => event.stopPropagation());
    parent.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  show(score: number, best: number, isNewBest: boolean, cause: string): void {
    this.subtitle.textContent = cause;
    this.score.textContent = String(score);
    this.best.textContent = `best ${best}`;
    this.newBest.hidden = !isNewBest;
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }
}
