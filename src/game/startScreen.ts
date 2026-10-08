export class StartScreen {
  readonly element = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.element.id = 'start-screen';
    const title = document.createElement('h1');
    title.textContent = 'Neon Rail Rush';
    const prompt = document.createElement('p');
    prompt.textContent = 'Tap or press any key to run';
    this.element.append(title, prompt);
    parent.append(this.element);
  }

  hide(): void {
    this.element.hidden = true;
  }
}
