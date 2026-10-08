import { expect, test, type Page } from '@playwright/test';

const game = <T>(page: Page, expr: string) => page.evaluate(`(() => { const g = window.__game; return ${expr}; })()`) as Promise<T>;

const startRun = async (page: Page) => {
  await page.goto('/?spawns=off');
  await page.waitForFunction(() => (window as unknown as { __game?: { simSteps: number } }).__game?.simSteps! > 30);
  expect(await game<boolean>(page, 'g.audio.unlocked')).toBe(false);
  await page.keyboard.press('Enter');
  await expect.poll(() => game<string>(page, 'g.state')).toBe('running');
};

const timer = (page: Page, kind: string) => game<number | null>(page, `(g.powerUps.find((p) => p.kind === '${kind}') ?? { timeLeft: null }).timeLeft`);

const expectTimerRunning = async (page: Page, kind: string, seconds: number) => {
  const first = await timer(page, kind);
  expect(first).not.toBeNull();
  expect(first!).toBeLessThanOrEqual(seconds);
  expect(first!).toBeGreaterThan(seconds - 1);
  const row = page.locator(`#hud-power-${kind}`);
  await expect(row).toBeVisible();
  await expect(row.locator('.hud-power-seconds')).toHaveText(/^\d+\.\ds$/);
  await page.waitForTimeout(400);
  expect((await timer(page, kind))!).toBeLessThan(first! - 0.2);
};

test('HUD shows score, coins and high score; coins pop, sparkle and chime when collected', async ({ page }) => {
  await startRun(page);
  expect(await game<boolean>(page, 'g.audio.unlocked')).toBe(true);
  await expect(page.locator('#hud-score')).toBeVisible();
  await expect(page.locator('#hud-coins')).toHaveText('0');
  await expect(page.locator('#hud-best')).toContainText('best');
  const added = await game<number>(page, "g.debug.spawnCoins('line', 0, 6, 5)");
  expect(added).toBe(5);
  await expect.poll(() => game<number>(page, 'g.pickups.coinsDrawn')).toBeGreaterThanOrEqual(3);
  await expect.poll(() => game<number>(page, 'g.coins')).toBe(5);
  await expect(page.locator('#hud-coins')).toHaveText('5');
  expect(await game<number>(page, 'g.effects.coinPops')).toBe(5);
  expect(await game<number>(page, 'g.audio.counts.coin')).toBe(5);
  const { score, distance } = await game<{ score: number; distance: number }>(page, '({ score: g.score, distance: g.distance })');
  expect(score).toBeGreaterThanOrEqual(Math.floor(distance) + 4);
  expect(score).toBeLessThanOrEqual(Math.floor(distance) + 5);
  await expect(page.locator('#hud-score')).not.toHaveText('0');
});

test('jetpack lifts the runner above the trains along a sky coin trail, shows a timer, then lands safely', async ({ page }) => {
  await startRun(page);
  await game(page, "g.debug.grantPowerUp('jetpack', 3)");
  expect(await game<string>(page, 'g.audio.last')).toBe('powerUp');
  await expectTimerRunning(page, 'jetpack', 3);
  expect(await game<boolean>(page, 'g.runner.flying')).toBe(true);
  expect(await game<boolean>(page, 'g.effects.jetpackVisible')).toBe(true);
  expect(await game<number>(page, "g.pickups.coins.filter((c) => c.shape === 'sky' && c.y > 5).length")).toBeGreaterThan(5);
  await expect.poll(() => game<number>(page, 'g.runner.position.y'), { timeout: 3000 }).toBeGreaterThan(4.5);
  expect(await game<boolean>(page, 'g.camera.runnerInView')).toBe(true);
  await expect.poll(() => game<number>(page, 'g.coins'), { timeout: 3000 }).toBeGreaterThan(2);
  await expect.poll(() => game<boolean>(page, 'g.runner.flying'), { timeout: 4000 }).toBe(false);
  await expect.poll(() => game<boolean>(page, 'g.runner.grounded'), { timeout: 3000 }).toBe(true);
  expect(await game<number>(page, 'g.runner.position.y')).toBe(0);
  expect(await game<string>(page, 'g.state')).toBe('running');
  expect(await game<number>(page, 'g.hitCounts.crash')).toBe(0);
  await expect(page.locator('#hud-power-jetpack')).toHaveCount(0);
  expect(await game<boolean>(page, 'g.effects.jetpackVisible')).toBe(false);
});

test('super sneakers raise the jump apex and show a timer', async ({ page }) => {
  await startRun(page);
  const normalApex = await game<number>(page, 'g.tuning.jumpVelocity ** 2 / (2 * g.tuning.gravity)');
  await game(page, "g.debug.grantPowerUp('sneakers')");
  await expectTimerRunning(page, 'sneakers', 10);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => game<boolean>(page, 'g.runner.grounded'), { intervals: [16] }).toBe(false);
  await expect.poll(() => game<boolean>(page, 'g.runner.grounded'), { timeout: 3000 }).toBe(true);
  const apex = await game<number>(page, 'g.runner.lastJumpApex');
  const expected = await game<number>(page, 'g.tuning.sneakersJumpVelocity ** 2 / (2 * g.tuning.gravity)');
  expect(apex).toBeGreaterThan(normalApex * 1.6);
  expect(Math.abs(apex - expected)).toBeLessThan(0.05);
});

test('coin magnet pulls coins from another lane into the runner and shows a timer', async ({ page }) => {
  await startRun(page);
  await game(page, "g.debug.spawnCoins('line', 1, 5, 3)");
  await page.waitForTimeout(800);
  expect(await game<number>(page, 'g.coins')).toBe(0);
  await game(page, "g.debug.grantPowerUp('magnet')");
  await expectTimerRunning(page, 'magnet', 10);
  await game(page, "g.debug.spawnCoins('line', 1, 5, 3)");
  await expect.poll(() => game<number>(page, 'g.coins'), { timeout: 2000 }).toBe(3);
  expect(await game<number>(page, 'g.runner.lane')).toBe(0);
});

test('score multiplier doubles the score rate, shows x2 and a timer', async ({ page }) => {
  await startRun(page);
  await game(page, "g.debug.grantPowerUp('multiplier')");
  expect(await game<number>(page, 'g.multiplier')).toBe(2);
  await expectTimerRunning(page, 'multiplier', 12);
  await expect(page.locator('#hud-multiplier')).toHaveText('x2');
  const a = await game<{ score: number; distance: number }>(page, '({ score: g.score, distance: g.distance })');
  await page.waitForTimeout(1000);
  const b = await game<{ score: number; distance: number }>(page, '({ score: g.score, distance: g.distance })');
  const ratio = (b.score - a.score) / (b.distance - a.distance);
  expect(ratio).toBeGreaterThan(1.9);
  expect(ratio).toBeLessThan(2.1);
});

test('glowing power-up pickups on the track grant their power-up when run through', async ({ page }) => {
  await startRun(page);
  await game(page, "g.debug.spawnPowerUp('magnet', 0, 14)");
  await expect.poll(() => game<number>(page, 'g.pickups.itemMeshesBuilt')).toBeGreaterThan(0);
  expect(await game<boolean>(page, 'g.pickups.itemsGlow')).toBe(true);
  await expect.poll(() => timer(page, 'magnet'), { timeout: 3000 }).not.toBeNull();
  expect(await game<number>(page, 'g.effects.powerUpBursts')).toBe(1);
  expect(await game<number>(page, 'g.audio.counts.powerUp')).toBe(1);
  await expect(page.locator('#hud-power-magnet')).toBeVisible();
});

test('game feel: lane switch lands within 0.15 s, down mid-air drops fast then rolls on landing', async ({ page }) => {
  await startRun(page);
  const steps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const g = (window as unknown as { __game: { simSteps: number; runner: { position: { x: number } }; tuning: { laneWidth: number } } }).__game;
        const target = g.tuning.laneWidth;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' }));
        const start = g.simSteps;
        const tick = () => {
          if (Math.abs(g.runner.position.x - target) <= 0.1 || g.simSteps - start > 60) resolve(g.simSteps - start);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  expect(steps / 60).toBeLessThanOrEqual(0.15 + 1 / 60);

  await page.keyboard.press('ArrowUp');
  await expect.poll(() => game<number>(page, 'g.runner.position.y'), { intervals: [16] }).toBeGreaterThan(1);
  await page.keyboard.press('ArrowDown');
  const vy = await game<number>(page, 'g.runner.velocity.y');
  expect(vy).toBeLessThan(-15);
  expect(await game<boolean>(page, 'g.runner.rolling')).toBe(false);
  await expect.poll(() => game<boolean>(page, 'g.runner.grounded'), { intervals: [16], timeout: 1000 }).toBe(true);
  expect(await game<boolean>(page, 'g.runner.rolling')).toBe(true);
  expect(await game<string>(page, 'g.audio.last')).toBe('roll');
});
