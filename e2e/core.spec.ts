import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const read = <T>(page: Page, fn: (g: any) => T) => page.evaluate(fn as any, undefined) as Promise<T>;
const game = <T>(page: Page, expr: string) => page.evaluate(`(() => { const g = window.__game; return ${expr}; })()`) as Promise<T>;

const startRun = async (page: Page) => {
  await page.keyboard.press('Enter');
  await expect.poll(() => game<string>(page, 'g.state')).toBe('running');
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.simSteps > 30);
});

test('start screen shows Nova ready until a key or tap starts the run', async ({ page }) => {
  expect(await game<string>(page, 'g.state')).toBe('ready');
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#start-screen')).toContainText(/tap or press any key/i);
  await page.waitForTimeout(300);
  expect(await game<number>(page, 'g.distance')).toBe(0);
  expect(await game<boolean>(page, 'g.camera.runnerInView')).toBe(true);
  await page.keyboard.press('h');
  expect(await game<string>(page, 'g.state')).toBe('ready');
  await page.keyboard.press('h');
  await page.mouse.click(640, 360);
  await expect.poll(() => game<string>(page, 'g.state')).toBe('running');
  await expect(page.locator('#start-screen')).toBeHidden();
  await expect.poll(() => game<number>(page, 'g.distance')).toBeGreaterThan(1);
});

test('arrow keys drive lane, jump height and roll state', async ({ page }) => {
  await startRun(page);
  expect(await game<number>(page, 'g.runner.lane')).toBe(0);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => game<number>(page, 'g.runner.lane')).toBe(-1);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => game<number>(page, 'g.runner.lane')).toBe(-1);
  await expect.poll(() => game<number>(page, 'g.runner.position.x'), { timeout: 3000 }).toBeLessThan(-2);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => game<number>(page, 'g.runner.lane')).toBe(1);

  await expect.poll(() => game<boolean>(page, 'g.runner.grounded')).toBe(true);
  expect(await game<number>(page, 'g.runner.position.y')).toBe(0);
  const dustBefore = await game<number>(page, 'g.effects.dustBursts');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => game<number>(page, 'g.runner.jumpHeight'), { intervals: [16], timeout: 2000 }).toBeGreaterThan(1);
  expect(await game<boolean>(page, 'g.camera.runnerInView')).toBe(true);
  expect(await game<string>(page, 'g.audio.last')).toBe('jump');
  await expect.poll(() => game<boolean>(page, 'g.runner.grounded'), { timeout: 3000 }).toBe(true);
  const apex = await game<number>(page, 'g.runner.lastJumpApex');
  const expectedApex = await game<number>(page, 'g.tuning.jumpVelocity ** 2 / (2 * g.tuning.gravity)');
  expect(apex).toBeGreaterThan(expectedApex - 0.02);
  expect(apex).toBeLessThanOrEqual(expectedApex + 1e-6);
  expect(await game<number>(page, 'g.effects.dustBursts')).toBe(dustBefore + 1);

  const standHeight = await game<number>(page, 'g.runner.collider.height');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => game<boolean>(page, 'g.runner.rolling')).toBe(true);
  expect(await game<number>(page, 'g.runner.collider.height')).toBeLessThan(standHeight);
  await expect.poll(() => game<boolean>(page, 'g.runner.rolling'), { timeout: 3000 }).toBe(false);
  expect(await game<number>(page, 'g.runner.collider.height')).toBe(standHeight);
});

test('H hides and shows every developer panel', async ({ page }) => {
  const panels = page.locator('.dev-panel');
  await expect(panels).toHaveCount(3);
  for (const id of ['fps', 'physics', 'spawn']) await expect(page.locator(`#dev-panel-${id}`)).toBeVisible();
  expect(await game<boolean>(page, 'g.debugOverlayVisible')).toBe(true);

  await page.keyboard.press('h');
  for (const id of ['fps', 'physics', 'spawn']) await expect(page.locator(`#dev-panel-${id}`)).toBeHidden();
  expect(await game<boolean>(page, 'g.devPanelsVisible')).toBe(false);
  expect(await game<boolean>(page, 'g.debugOverlayVisible')).toBe(false);

  await page.keyboard.press('h');
  for (const id of ['fps', 'physics', 'spawn']) await expect(page.locator(`#dev-panel-${id}`)).toBeVisible();
  expect(await game<boolean>(page, 'g.devPanelsVisible')).toBe(true);
  expect(await game<boolean>(page, 'g.debugOverlayVisible')).toBe(true);
});

test('fixed-step simulation advances about 60 steps per second', async ({ page }) => {
  await startRun(page);
  await page.waitForTimeout(500);
  const start = await read(page, () => ({ steps: (window as any).__game.simSteps, t: performance.now() }));
  const fpsSamples: number[] = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    fpsSamples.push(await game<number>(page, 'g.fps'));
  }
  const end = await read(page, () => ({ steps: (window as any).__game.simSteps, t: performance.now() }));
  const seconds = (end.t - start.t) / 1000;
  const stepsPerSecond = (end.steps - start.steps) / seconds;
  console.log(`sim steps/s ${stepsPerSecond.toFixed(1)} over ${seconds.toFixed(2)} s; fps samples ${fpsSamples.map((f) => f.toFixed(1)).join(', ')}`);
  expect(seconds).toBeGreaterThanOrEqual(3);
  expect(stepsPerSecond).toBeGreaterThan(57);
  expect(stepsPerSecond).toBeLessThan(63);
  for (const fps of fpsSamples) expect(fps).toBeGreaterThan(55);
});

test('runner is grounded on the track and casts a shadow', async ({ page }) => {
  await startRun(page);
  for (let i = 0; i < 8; i++) {
    const model = await game<{ minY: number; maxY: number }>(page, 'g.runner.model');
    expect(Math.abs(model.minY)).toBeLessThan(0.03);
    expect(model.maxY).toBeGreaterThan(1.55);
    expect(model.maxY).toBeLessThan(1.85);
    expect(await game<boolean>(page, 'g.camera.runnerInView')).toBe(true);
    await page.waitForTimeout(90);
  }
  expect(await game<number>(page, 'g.runner.position.y')).toBe(0);
  expect(await game<number>(page, 'g.runner.collider.bottomY')).toBe(0);
  const shadows = await game<Record<string, boolean>>(page, 'g.shadows');
  expect(shadows).toEqual({ enabled: true, lightCastsShadow: true, runnerCastsShadow: true, blobShadowVisible: true });
  const cam = await game<{ position: { y: number; z: number } }>(page, 'g.camera');
  const runnerZ = await game<number>(page, 'g.runner.position.z');
  expect(cam.position.y).toBeGreaterThan(1.5);
  expect(cam.position.y).toBeLessThan(3.5);
  expect(cam.position.z - runnerZ).toBeGreaterThan(2);
  expect(cam.position.z - runnerZ).toBeLessThan(7);
  const isFrozen = await read(page, () => {
    const g = (window as any).__game;
    try {
      g.state = 'hacked';
    } catch {
      /* strict-mode throw is fine */
    }
    return g.state === 'running' && Object.isFrozen(g) && Object.isFrozen(g.runner.collider);
  });
  expect(isFrozen).toBe(true);
});

test('rolling runner stays on the track and inside the roll collider', async ({ page }) => {
  await startRun(page);
  await expect.poll(() => game<boolean>(page, 'g.runner.grounded')).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => game<boolean>(page, 'g.runner.rolling')).toBe(true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const samples: { minY: number; maxY: number; height: number; bottomY: number; rolling: boolean; grounded: boolean }[] = [];
  while (samples.length < 200) {
    const s = await game<(typeof samples)[number]>(
      page,
      '({ minY: g.runner.model.minY, maxY: g.runner.model.maxY, height: g.runner.collider.height, bottomY: g.runner.collider.bottomY, rolling: g.runner.rolling, grounded: g.runner.grounded })',
    );
    if (!s.rolling) break;
    samples.push(s);
    await page.waitForTimeout(16);
  }
  expect(samples.length).toBeGreaterThan(8);
  for (const s of samples) {
    expect(s.grounded).toBe(true);
    expect(s.bottomY).toBe(0);
    expect(Math.abs(s.minY)).toBeLessThan(0.03);
    expect(s.maxY).toBeLessThanOrEqual(s.height);
    expect(s.maxY).toBeGreaterThan(s.height * 0.5);
  }
});
