import * as THREE from 'three';
import { OBSTACLE_DEFS, type ObstacleKind } from '../sim/obstacleDefs';
import { POWER_UP_KINDS, type CoinShape, type PowerUpKind } from '../sim/pickups';
import { colliderOf, isFlying, isRolling } from '../sim/runner';
import { HIGH_SCORE_KEY } from '../sim/score';
import type { Game } from './game';

const safeRead = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const boxJson = (b: THREE.Box3) => ({ min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } });

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
      velocity: { x: r.vx, y: r.vy, z: game.state === 'running' ? -r.speed : r.knockbackVz },
      grounded: r.grounded,
      jumpHeight: r.y,
      lastJumpApex: r.maxJumpHeight,
      rolling: isRolling(r),
      rollTimeLeft: r.rollTimeLeft,
      stumbling: r.stumbleTimeLeft > 0,
      fall: r.fall,
      flying: isFlying(r),
      safeLanding: game.world.invulnerable,
      jumpVelocity: game.world.jumpVelocity,
      collider: colliderOf(r),
      model: game.runnerModelBounds(),
    };
  });
  define('camera', () => {
    const p = game.camera.position;
    const t = game.cameraTarget;
    return { position: { x: p.x, y: p.y, z: p.z }, target: { x: t.x, y: t.y, z: t.z }, fov: game.camera.fov, runnerInView: game.runnerInView() };
  });
  define('powerUps', () => game.powerUpTimers().map(({ kind, timeLeft, duration }) => ({ kind, timeLeft, duration })));
  define('powerUpTimers', () => ({ ...game.world.powerUps }));
  define('pickups', () => {
    const p = game.world.pickups;
    return {
      enabled: p.enabled,
      coins: p.coins.map((c) => ({ id: c.id, lane: c.lane, shape: c.shape, magnetized: c.magnetized, x: c.x, y: c.y, z: c.z })),
      items: p.items.map((i) => ({ id: i.id, kind: i.kind, lane: i.lane, x: i.x, y: i.y, z: i.z })),
      created: p.created,
      pooled: p.pooled,
      spawned: p.spawned,
      recycled: p.recycled,
      coinsCollected: p.coinsCollected,
      itemsCollected: p.itemsCollected,
      shapes: { ...p.shapeCounts },
      coinsDrawn: game.pickupView.coinsDrawn,
      itemMeshesBuilt: game.pickupView.itemsBuilt,
      itemsGlow: game.pickupView.itemsGlow(),
    };
  });
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
    obstaclesCastShadow: game.obstacleView.castsShadows(),
    chasersCastShadow: game.chasers.roots.every(hasShadowCaster),
  }));
  define('score', () => game.world.score);
  define('highScore', () => game.world.highScore);
  define('storedHighScore', () => Number(safeRead(HIGH_SCORE_KEY) ?? 0));
  define('coins', () => game.world.coins);
  define('multiplier', () => game.world.multiplier);
  define('runs', () => game.runs);
  define('crash', () => ({
    cause: game.world.crashCause,
    time: game.world.crashTime,
    z: game.world.crashZ,
    knockbackVelocity: { z: game.runner.knockbackVz, y: game.runner.vy },
    fall: game.runner.fall,
  }));
  define('lastHit', () => game.world.lastHit);
  define('hitCounts', () => ({ ...game.world.hitCounts }));
  define('chase', () => {
    const c = game.world.chase;
    const bounds = game.chasers.bounds();
    return {
      phase: c.phase,
      gap: c.gap,
      closeTimeLeft: c.phase === 'close' ? c.timer : 0,
      stumbles: c.stumbles,
      visible: game.chaseVisible,
      inView: game.chasersInView(),
      brask: boxJson(bounds.brask),
      volt: boxJson(bounds.volt),
    };
  });
  define('obstacles', () =>
    game.world.spawner.active.map((o) => {
      const model = game.obstacleView.modelBounds(o);
      const collider = game.obstacleView.colliderBounds(o);
        return {
        id: o.id,
        kind: o.kind,
        lane: o.lane,
        z: o.z,
        oncoming: o.oncoming,
        moving: o.moving,
        parts: OBSTACLE_DEFS[o.kind].parts.map((p) => ({ name: p.name, surface: p.surface, min: [...p.min], max: [...p.max] })),
        collider: boxJson(collider),
        model: model ? boxJson(model) : null,
      };
    }),
  );
  define('spawner', () => ({
    enabled: game.world.spawner.enabled,
    active: game.world.spawner.active.length,
    created: game.world.spawner.created,
    pooled: game.world.spawner.pooled,
    spawned: game.world.spawner.spawned,
    recycled: game.world.spawner.recycled,
    patterns: { ...game.world.spawner.patternCounts },
    meshes: game.obstacleView.stats,
  }));
  define('gameOverVisible', () => game.gameOver.visible);
  define('hudVisible', () => !game.hud.element.hidden);
  define('effects', () => ({
    dustBursts: game.dust.bursts,
    activeDust: game.dust.active,
    coinPops: game.pickupFx.coinPops,
    powerUpBursts: game.pickupFx.powerUpBursts,
    activeSparkles: game.pickupFx.activeSparkles,
    jetpackVisible: game.jetpackRig.group.visible,
  }));
  define('audio', () => ({ played: game.sfx.played, last: game.sfx.last, unlocked: game.sfx.unlocked, counts: { ...game.sfx.counts } }));
  define('startScreenVisible', () => !game.startScreen.element.hidden);
  define('tuning', () => game.tuning);
  Object.defineProperty(api, 'debug', {
    enumerable: true,
    value: Object.freeze({
      spawnObstacle: (kind: ObstacleKind, lane: number, ahead: number, oncoming = false) => {
        if (!(kind in OBSTACLE_DEFS)) throw new Error(`unknown obstacle ${kind}`);
        return game.spawnObstacle(kind, lane, ahead, oncoming);
      },
      clearObstacles: () => game.clearObstacles(),
      setSpawning: (enabled: boolean) => game.setSpawning(enabled),
      grantPowerUp: (kind: PowerUpKind, seconds?: number) => {
        if (!POWER_UP_KINDS.includes(kind)) throw new Error(`unknown power-up ${kind}`);
        game.grantPowerUp(kind, seconds);
      },
      spawnCoins: (shape: Exclude<CoinShape, 'roof'>, lane: number, ahead: number, count?: number) => game.spawnCoins(shape, lane, ahead, count),
      spawnPowerUp: (kind: PowerUpKind, lane: number, ahead: number) => {
        if (!POWER_UP_KINDS.includes(kind)) throw new Error(`unknown power-up ${kind}`);
        return game.spawnPowerUp(kind, lane, ahead);
      },
      clearPickups: () => game.clearPickups(),
    }),
  });
  return Object.freeze(api);
};

const hasShadowCaster = (root: THREE.Object3D): boolean => {
  let found = false;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.castShadow) found = true;
  });
  return found;
};
