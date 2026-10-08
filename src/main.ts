import './style.css';
import { createDebugApi } from './game/debugApi';
import { Game } from './game/game';

declare global {
  interface Window {
    __game: ReturnType<typeof createDebugApi>;
  }
}

const host = document.getElementById('app');
if (!host) throw new Error('#app missing');

const game = new Game(host);
Object.defineProperty(window, '__game', { value: createDebugApi(game), writable: false, configurable: false });
game.start();
