import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const game = <T>(page: Page, expr: string) => page.evaluate(`(() => { const g = window.__game; return ${expr}; })()`) as Promise<T>;

const open = async (page: Page, query: string) => {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as any).__game?.simSteps > 30);
  await page.keyboard.press('Enter');
  await expect.poll(() => game<string>(page, 'g.state')).toBe('running');
};

interface Sample {
  state: string;
  z: number;
  y: number;
  phase: string;
  chaseInView: boolean;
  gameOver: boolean;
}

const recordUntilGameOver = (page: Page, maxMs: number) =>
  page.evaluate(
    (limit) =>
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const start = performance.now();
        const tick = () => {
          const g = (window as any).__game;
          samples.push({
            state: g.state,
            z: g.runner.position.z,
            y: g.runner.position.y,
            phase: g.chase.phase,
            chaseInView: g.chase.inView,
            gameOver: g.gameOverVisible,
          });
          if (g.state === 'gameover' || performance.now() - start > limit) resolve(samples);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    maxMs,
  );

test('procedural obstacles rest on the ground, cast shadows, and their collider boxes match the meshes', async ({ page }) => {
  await open(page, '?seed=5');
  await expect.poll(() => game<number>(page, 'g.obstacles.filter((o) => o.model).length')).toBeGreaterThan(3);
  const obstacles = await game<any[]>(page, 'g.obstacles');
  const kinds = new Set(obstacles.map((o) => o.kind));
  expect(kinds.size).toBeGreaterThan(1);
  for (const o of obstacles) {
    if (!o.model) continue;
    expect(Math.abs(o.model.min.y)).toBeLessThan(0.02);
    for (const corner of ['min', 'max'] as const)
      for (const axis of ['x', 'y', 'z'] as const) expect(Math.abs(o.model[corner][axis] - o.collider[corner][axis])).toBeLessThan(0.06);
  }
  for (const o of obstacles) for (const other of obstacles) {
    if (o === other || o.lane !== other.lane) continue;
    const overlap = Math.min(o.collider.max.z, other.collider.max.z) - Math.max(o.collider.min.z, other.collider.min.z);
    expect(overlap).toBeLessThanOrEqual(1e-6);
  }
  const shadows = await game<Record<string, boolean>>(page, 'g.shadows');
  expect(shadows.obstaclesCastShadow).toBe(true);
  expect(shadows.chasersCastShadow).toBe(true);
  expect(await game<boolean>(page, 'g.debugOverlayVisible')).toBe(true);
  const spawner = await game<any>(page, 'g.spawner');
  expect(spawner.enabled).toBe(true);
  expect(spawner.created).toBe(spawner.active + spawner.pooled);
  await page.screenshot({ path: 'test-results/obstacles/colliders.png' });
});

test('chasers start right behind the runner and drop back out of view', async ({ page }) => {
  await open(page, '?spawns=off');
  expect(await game<string>(page, 'g.chase.phase')).toBe('intro');
  expect(await game<boolean>(page, 'g.chase.inView')).toBe(true);
  await expect.poll(() => game<string>(page, 'g.chase.phase'), { timeout: 4000 }).toBe('far');
  await expect.poll(() => game<boolean>(page, 'g.chase.visible'), { timeout: 4000 }).toBe(false);
  expect(await game<boolean>(page, 'g.chase.inView')).toBe(false);
});

test('a forced front-on crash knocks the runner back, the chasers catch her, then game over and restart', async ({ page }) => {
  await open(page, '?spawns=off');
  await page.evaluate(() => localStorage.removeItem('neonRailRush.highScore'));
  await page.evaluate(() => (window as any).__game.debug.spawnObstacle('train', 0, 14));
  const samples = await recordUntilGameOver(page, 12_000);
  const crashIndex = samples.findIndex((s) => s.state === 'crashed');
  expect(crashIndex).toBeGreaterThan(0);
  const caughtIndex = samples.findIndex((s) => s.phase === 'caught');
  const overIndex = samples.findIndex((s) => s.state === 'gameover');
  expect(caughtIndex).toBeGreaterThan(crashIndex);
  expect(overIndex).toBeGreaterThan(caughtIndex);
  const crashZ = samples[crashIndex].z;
  const knockback = samples.slice(crashIndex, caughtIndex);
  expect(Math.max(...knockback.map((s) => s.z))).toBeGreaterThan(crashZ + 0.5);
  expect(Math.max(...knockback.map((s) => s.y))).toBeGreaterThan(0.3);
  expect(samples.slice(0, overIndex).every((s) => !s.gameOver)).toBe(true);
  expect(samples[caughtIndex].chaseInView || samples.slice(caughtIndex).some((s) => s.chaseInView)).toBe(true);
  expect(await game<string>(page, 'g.crash.cause')).toBe('frontCrash');
  expect(await game<number>(page, 'g.runner.position.y')).toBe(0);

  await expect(page.locator('#game-over')).toBeVisible();
  const score = await game<number>(page, 'g.score');
  expect(score).toBeGreaterThan(5);
  await expect(page.locator('#game-over-score')).toHaveText(String(score));
  await expect(page.locator('#game-over-best')).toHaveText(`best ${score}`);
  expect(await game<number>(page, 'g.storedHighScore')).toBe(score);
  await page.screenshot({ path: 'test-results/obstacles/game-over.png' });

  await page.waitForTimeout(600);
  await page.locator('#game-over-restart').click();
  await expect.poll(() => game<string>(page, 'g.state')).toBe('running');
  await expect(page.locator('#game-over')).toBeHidden();
  expect(await game<number>(page, 'g.distance')).toBeLessThan(5);
  expect(await game<number>(page, 'g.runs')).toBe(2);
  expect(await game<string>(page, 'g.chase.phase')).toBe('intro');
  expect(await game<number>(page, 'g.highScore')).toBe(score);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.simSteps > 5);
  expect(await game<number>(page, 'g.highScore')).toBe(score);
});

test('a side scrape bounces back and brings the chasers close; a second stumble is a catch', async ({ page }) => {
  await open(page, '?spawns=off');
  await expect.poll(() => game<boolean>(page, 'g.chase.visible'), { timeout: 5000 }).toBe(false);
  await page.evaluate(() => (window as any).__game.debug.spawnObstacle('train', 1, -3));
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => game<string>(page, 'g.lastHit?.kind')).toBe('scrape');
  await expect.poll(() => game<number>(page, 'g.runner.lane')).toBe(0);
  expect(await game<string>(page, 'g.state')).toBe('running');
  expect(await game<string>(page, 'g.chase.phase')).toBe('close');
  expect(await game<string>(page, 'g.audio.last')).toBe('stumble');
  await expect.poll(() => game<boolean>(page, 'g.chase.inView')).toBe(true);
  expect(await game<boolean>(page, 'g.camera.runnerInView')).toBe(true);
  await page.screenshot({ path: 'test-results/obstacles/chase-close.png' });

  await page.waitForTimeout(700);
  await page.evaluate(() => (window as any).__game.debug.spawnObstacle('train', -1, -3));
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => game<string>(page, 'g.state')).toBe('crashed');
  expect(await game<string>(page, 'g.crash.cause')).toBe('secondStumble');
  await expect.poll(() => game<string>(page, 'g.state'), { timeout: 6000 }).toBe('gameover');
  await expect(page.locator('#game-over')).toBeVisible();
});

test('a ramp car carries the runner up onto the train roofs', async ({ page }) => {
  await open(page, '?spawns=off');
  await page.evaluate(() => {
    const d = (window as any).__game.debug;
    d.spawnObstacle('rampCar', 0, 10);
    d.spawnObstacle('train', 0, 22);
    d.spawnObstacle('train', 0, 34.4);
  });
  await expect.poll(() => game<number>(page, 'g.runner.position.y'), { timeout: 5000 }).toBe(3.2);
  expect(await game<boolean>(page, 'g.runner.grounded')).toBe(true);
  for (let i = 0; i < 6; i++) {
    expect(await game<string>(page, 'g.state')).toBe('running');
    expect(await game<boolean>(page, 'g.camera.runnerInView')).toBe(true);
    const model = await game<{ minY: number }>(page, 'g.runner.model');
    if (await game<boolean>(page, 'g.runner.grounded')) expect(Math.abs(model.minY - 3.2)).toBeLessThan(0.05);
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: 'test-results/obstacles/roof.png' });
});
