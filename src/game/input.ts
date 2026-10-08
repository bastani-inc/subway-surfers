export type Action = 'left' | 'right' | 'jump' | 'roll' | 'toggleDev' | 'start';

const KEY_ACTIONS: Record<string, Action> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  Space: 'jump',
  ArrowDown: 'roll',
  KeyS: 'roll',
  KeyH: 'toggleDev',
  Enter: 'start',
};

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock', 'Escape']);
const SWIPE_MIN_PX = 30;

export const bindInput = (onAction: (action: Action) => void): void => {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || MODIFIER_KEYS.has(event.key)) return;
    const action = KEY_ACTIONS[event.code] ?? 'start';
    event.preventDefault();
    if (event.repeat) return;
    onAction(action);
  });

  let start: { x: number; y: number } | null = null;
  window.addEventListener('pointerdown', (event) => {
    start = { x: event.clientX, y: event.clientY };
  });
  window.addEventListener('pointerup', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) onAction('start');
    else if (Math.abs(dx) > Math.abs(dy)) onAction(dx < 0 ? 'left' : 'right');
    else onAction(dy < 0 ? 'jump' : 'roll');
  });
};
