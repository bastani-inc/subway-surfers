const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

export class Hud {
  readonly element = element('div', 'hud');
  private readonly score = element('div', 'hud-score', '0');
  private readonly best = element('div', 'hud-best', 'best 0');
  private readonly multiplier = element('div', 'hud-multiplier', 'x1');
  private shown = { score: -1, best: -1, multiplier: -1 };

  constructor(parent: HTMLElement) {
    this.element.id = 'hud';
    this.element.append(this.score, this.multiplier, this.best);
    this.element.hidden = true;
    parent.append(this.element);
  }

  set visible(value: boolean) {
    this.element.hidden = !value;
  }

  update(score: number, best: number, multiplier: number): void {
    if (score !== this.shown.score) this.score.textContent = String(score);
    if (best !== this.shown.best) this.best.textContent = `best ${best}`;
    if (multiplier !== this.shown.multiplier) this.multiplier.textContent = `x${multiplier}`;
    this.shown = { score, best, multiplier };
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
