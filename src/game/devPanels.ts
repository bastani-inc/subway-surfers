export type PanelId = 'fps' | 'physics' | 'spawn';

const TITLES: Record<PanelId, string> = {
  fps: 'Performance',
  physics: 'Physics / colliders',
  spawn: 'Spawns',
};

export class DevPanels {
  readonly container = document.createElement('div');
  private readonly bodies = new Map<PanelId, HTMLElement>();
  private visibleState = true;
  private readonly listeners: ((visible: boolean) => void)[] = [];

  constructor(parent: HTMLElement) {
    this.container.className = 'dev-panels';
    for (const id of Object.keys(TITLES) as PanelId[]) {
      const panel = document.createElement('section');
      panel.className = 'dev-panel';
      panel.id = `dev-panel-${id}`;
      panel.dataset.devPanel = id;
      const title = document.createElement('h2');
      title.textContent = TITLES[id];
      const body = document.createElement('div');
      panel.append(title, body);
      this.container.append(panel);
      this.bodies.set(id, body);
    }
    parent.append(this.container);
  }

  get visible(): boolean {
    return this.visibleState;
  }

  onToggle(listener: (visible: boolean) => void): void {
    this.listeners.push(listener);
  }

  toggle(): void {
    this.visibleState = !this.visibleState;
    this.container.classList.toggle('dev-hidden', !this.visibleState);
    for (const listener of this.listeners) listener(this.visibleState);
  }

  set(id: PanelId, text: string): void {
    if (!this.visibleState) return;
    const body = this.bodies.get(id);
    if (body && body.textContent !== text) body.textContent = text;
  }
}
