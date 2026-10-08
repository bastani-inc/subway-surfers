# Build log

## 2026-10-08 — slice "core"

**Done:** Scaffolded Vite + TypeScript + Three.js with Vitest and Playwright (Chromium). Added scripts dev/build/typecheck/test:unit/test:e2e/check. `base: './'` is set so dist/ works from any path. Added a fixed 60 Hz stepper (`src/sim/fixedStep.ts`). Runner physics live in `src/sim/runner.ts`: the jump uses constant gravity with exact constant-acceleration integration, lanes are clamped to -1..1 and switched by a critically damped spring, and the roll lowers the collider from 1.7 m to 0.8 m for 0.65 s and fast-falls when started mid-air. Speed ramps smoothly to a cap. Rendering parts:
- an endless instanced track (rails, sleepers, neon pylons) recycled around the runner
- a placeholder Nova runner whose arms and legs alternate, phased by distance traveled; its hip height keeps the planted foot at y=0
- a low chase camera
- a PCF soft-shadow directional light that follows the runner, plus a blob ground shadow
- dev panels (performance, physics/colliders, spawns) and a collider wireframe, all toggled by H
- a frozen, getter-only `window.__game` API

public/models/, assets/ and live/ were not touched.

**Verified:** `npm run check` passed: typecheck, 11 unit tests, the build, and 4 Chromium e2e tests against `vite preview`. The e2e fps test measured 59.9 sim steps/s over 3.09 s, with fps samples between 48 and 55 in headless Chromium. Manual screenshots showed the runner on the track with its shadow, and the roll pose with the lowered collider.

## 2026-10-08 — slice "core" (update to current brief)

**Done:** Kept the existing scaffold and brought the slice up to the current brief.
- Lane switches now use an exact critically damped step (ω = 32), so the runner snaps about 0.12 s per lane (90%) with eased momentum and no overshoot. Nova leans slightly into each switch.
- Art direction: toon-shaded materials, a dusk sky gradient (violet to pink to sunset orange) with matching fog, a brighter track, and colorful instanced signal lights on the pylons. The placeholder Nova is now a chunkier cartoon: oversized head, hands and LED sneakers, a teal asymmetric bob, an orange windbreaker with a reflective stripe, and knee pads. Feet are planted at y≈0, with the hip tilt included.
- Start screen: a `ready` state shows Nova idle with a "Tap or press any key to run" prompt. H toggles the dev panels without starting the run.
- Game feel: pooled landing dust bursts, and WebAudio-synthesized SFX for jump and roll. Coin, power-up, stumble and crash sounds are synthesized too, ready for later slices.
- `window.__game` now also exposes `state` (ready/running), `camera.runnerInView`, `runner.model` bounds, `effects`, `audio` and `startScreenVisible`.
- public/models/, assets/ and live/ were not touched.

**Verified:** `npm run check` passed: typecheck, 11 unit tests (including the new lane-snap timing test), the build, and 5 Chromium e2e tests against `vite preview`. The new e2e checks cover start by tap, the runner staying in view mid-jump, the dust burst on landing, and model minY within 0.03 of 0. Over 3.12 s the simulation ran 60.3 steps/s. Headless fps samples were 28.7 to 42.4. Manual Playwright screenshots of the ready screen and of a jump showed the runner on the track with its shadow, against the dusk sky.

## 2026-10-08 — slice "core" (repair after review)

**Done:**
- Roll float (blocker): `RunnerModel.poseRoll` in `src/game/runnerModel.ts` now spins the tucked body around its own centroid. At construction the model measures the tuck pose once: its centroid, and the largest distance of any vertex from it in the y/z plane. From that it computes a tuck scale that fits the spinning shape inside a 0.77 m circle, under the 0.8 m `ROLL_HEIGHT`. Every frame, after rotating, it measures the lowest vertex and moves `body.position.y` so that vertex sits at y=0. The lean is set to zero while rolling.
- Readability (minor): the tuck is a bigger jackknife somersault (hips curled, legs and arms wrapped forward) that spins on the ground at about 0.5–0.77 m tall, no longer a tiny block.
- `runnerModelBounds` now uses exact vertex bounds (`setFromObject(root, true)`).
- New e2e test `rolling runner stays on the track and inside the roll collider`: it samples every ~16 ms through the whole roll and asserts grounded state, collider bottomY = 0, |model.minY| < 0.03, model.maxY ≤ collider.height, and model.maxY > half the collider height.
- fps (minor): Playwright now launches Chromium with Metal ANGLE GPU flags (`--use-angle=metal --ignore-gpu-blocklist --enable-gpu-rasterization`), so headless runs render on the Apple M4 Max GPU. The fps assertion went from > 20 to > 55 for every sample.

**Verified:** `npm run check` passed: typecheck, 11 unit tests, the build, and 6 Chromium e2e tests. Over 3.03 s the simulation ran 60.0 steps/s, and all fps samples were 60.0. During a manual Playwright roll capture (screenshots in `test-results/repair-core/roll-*.png`), model minY stayed at about 0 and maxY was 0.52–0.67 m while rolling. The screenshots show the somersault on the track with its shadow.
