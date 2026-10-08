import { colliderOf, isRolling } from '../sim/runner';
import type { Game } from './game';

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const createDebugApi = (game: Game) => {
  const api = {};
  const define = (name: string, read: () => unknown) =>
    Object.defineProperty(api, name, { enumerable: true, get: () => deepFreeze(read()) });

  define('state', () => game.state);
  define('speed', () => game.runner.speed);
  define('distance', () => game.runner.distance);
  define('runner', () => {
    const r = game.runner;
    return {
      lane: r.lane,
      position: { x: r.x, y: r.y, z: r.z },
      velocity: { x: r.vx, y: r.vy, z: -r.speed },
      grounded: r.grounded,
      jumpHeight: r.y,
      lastJumpApex: r.maxJumpHeight,
      rolling: isRolling(r),
      rollTimeLeft: r.rollTimeLeft,
      collider: colliderOf(r),
      model: game.runnerModelBounds(),
    };
  });
  define('camera', () => {
    const p = game.camera.position;
    const t = game.cameraTarget;
    return { position: { x: p.x, y: p.y, z: p.z }, target: { x: t.x, y: t.y, z: t.z }, fov: game.camera.fov, runnerInView: game.runnerInView() };
  });
  define('powerUps', () => []);
  define('fps', () => game.fpsMeter.fps);
  define('frameTimeMs', () => game.fpsMeter.frameMs);
  define('simSteps', () => game.stepper.totalSteps);
  define('simStepsPerSecond', () => game.stepsPerSecond);
  define('devPanelsVisible', () => game.devPanels.visible);
  define('debugOverlayVisible', () => game.colliderHelper.visible);
  define('shadows', () => ({
    enabled: game.renderer.shadowMap.enabled,
    lightCastsShadow: game.sun.castShadow,
    runnerCastsShadow: game.runnerModel.root.children.length > 0 && hasShadowCaster(game.runnerModel.root),
    blobShadowVisible: game.runnerModel.blobShadow.visible,
  }));
  define('effects', () => ({ dustBursts: game.dust.bursts, activeDust: game.dust.active }));
  define('audio', () => ({ played: game.sfx.played, last: game.sfx.last }));
  define('startScreenVisible', () => !game.startScreen.element.hidden);
  define('tuning', () => game.tuning);
  return Object.freeze(api);
};

const hasShadowCaster = (root: import('three').Object3D): boolean => {
  let found = false;
  root.traverse((o) => {
    if ((o as import('three').Mesh).isMesh && o.castShadow) found = true;
  });
  return found;
};
