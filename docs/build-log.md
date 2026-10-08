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

## 2026-10-08 — slice "obstacles"

**Done:** Added the obstacle slice on top of the core scaffold.
- Data-driven obstacles: `src/sim/obstacleDefs.ts` defines every kind in one place, each with a model id, size and per-part axis-aligned colliders. The kinds are train (2.0 × 3.2 × 12 m, walkable roof), ramp car (sloped surface from 0 to 3.2 m), low barrier (1.0 m, jump over) and gantry (two posts plus a sign whose underside is at 1.15 m, roll under). Placeholder meshes in `src/game/obstacleView.ts` are built from the same sizes. Trains have abstract graffiti and no letters. Every mesh casts shadows and sits on a soft contact shadow. With the dev panel on, collider wireframes (the ramp drawn as a wedge) show for every part.
- Seeded procedural spawner with object pooling (`src/sim/spawner.ts`). It starts after a 70 m clear runway. Patterns are train groups across lanes (a ramp car followed by 1–2 cars, stationary or oncoming trains, at least one lane always open or reachable by ramp), barrier rows and pairs, and mixed. An oncoming train only starts moving within 70 m of the runner, and only spawns in a lane that is clear ahead of it. Meshes are pooled per kind.
- Collisions (`src/sim/collision.ts`, `src/sim/world.ts`): each hit is classified by the axis the runner entered on. Entering along z is a front-on crash. Entering along x is a side scrape: the runner bounces back to the previous lane and stumbles. Entering from above onto a walkable top is a roof landing; onto a barrier top it is a clip, which counts as a stumble. A support probe lets the runner run up ramps, along roofs and across coupling gaps, and fall off the end with gravity.
- Chase state machine (`src/sim/chase.ts`): Officer Brask and Volt (original placeholder models in `src/game/chasers.ts`) start 1.6 m behind the runner. After 1.6 s they drop back out of view. A stumble brings them close for 4 s, and a second stumble in that window is a catch. After a crash or catch, the runner gets a backward impulse (vz = +7, vy = +5.5), falls, and slides to a stop. The chasers run in, then 0.9 s later the game-over screen appears with score, best and "Run again". The camera rises and pulls back during the crash.
- Score = floor(distance × multiplier) + coins. The high score persists in localStorage under `neonRailRush.highScore`. The speed ramp keeps its ease-out curve to the cap, now covered by tests. Added a HUD and the stumble and crash SFX.
- `window.__game` now also exposes score, highScore, storedHighScore, crash, lastHit, hitCounts, chase, obstacles (collider and mesh bounds), spawner, gameOverVisible and hudVisible. It also has a `debug` object for test setup (`spawnObstacle`, `clearObstacles`, `setSpawning`). `?spawns=off` and `?seed=N` URL parameters keep tests deterministic, and the core e2e tests now use `?spawns=off`.
- live/, public/models/ and assets/ were not touched.

**Verified:** `npm run check` passed: typecheck, 42 unit tests (31 new across collision, chase, score and spawner), the build, and 11 Chromium e2e tests (5 new). The new e2e tests cover:
- colliders matching mesh bounds within 0.06 m, and obstacles resting at y≈0 with shadows
- the chasers' intro and drop-back
- a forced front-on crash: knockback (z rises by more than 0.5 m and y by more than 0.3 m) happens before the catch, then the game-over screen, the stored high score, restart, and the best surviving a page reload
- a side scrape bouncing back with the chasers in view, then a second stumble catching the runner
- climbing a ramp onto a roof at y = 3.2

The fps samples were all 60.0, and the simulation ran 59.8 steps/s. Screenshots in `test-results/obstacles/` show the collider overlay, the close chase, the roof run and the game-over screen.

## 2026-10-08 — Blender cleanup of the Hunyuan3D models

**Done:**
- `scripts/blender/cleanup_models.py` (run `blender -b --python scripts/blender/cleanup_models.py [-- <id> ...]`) does the whole cleanup for all 13 raw GLBs. For each one it imports the GLB, welds verts (merge by distance), removes slabs and loose fragments, caps holes, recalculates normals, decimates (characters ≤ 30k triangles, props ≤ 8k), turns the model to face -Z (trains run along Z), scales it to metres, puts the origin at the bottom center (y = 0), keeps only the base-color texture (packed JPEG: 2048 for characters and the train, 1024 for the rest), and exports `public/models/<id>.glb`. It then re-imports the export, measures it, renders `assets/renders/<id>.png` (Eevee, three-quarter front view, shadowed ground) and writes `assets/manifest.json`.
- Fixes for individual assets: the multiplier token sat between two square background plates, which were removed and the token back capped. The coin was fused onto a square plate; the script finds the cyan rim in the texture, fits an octagon to it, and bisects the plate away. A ground plate was fused around the guard's boots; it was cut and the soles capped. The gantry's feet were skewed 26.6° in plan, so it was straightened, and its posts were compressed so the beam's underside is at 1.20 m (between the 0.8 m roll height and the 1.7 m standing height). The low barrier was squashed to 2.0 × 1.0 m.
- Sizes: runner 1.7 m, guard 1.9 m, dog 0.85 m, train 2.0 × 3.2 × 12 m (non-uniform fit), coin 0.6 m, pickups 0.7–0.9 m, building_a 36 m, building_b 24 m.
- Manifest parts: barrier_high has `beam`, `postLeft` and `postRight`; train has `body` (y up to 2.95) and `roof` (2.95–3.2); everything else has a single `body`. Nothing is a stand-in: every raw mesh existed.
- `scripts/blender/verify_models.py` checks each export independently. `scripts/blender/probe_raw.py` is a diagnostic tool for raw meshes (island stats and four-side views).

**Verified:** I ran the pipeline from scratch (deleted the outputs first): exit 0, no tracebacks. `verify_models.py` passed 13/13. It confirmed that the triangle counts and bounds re-measured from each GLB match the manifest, that every model is within its budget, that min y = 0, that the origin is bottom center, that the packed texture is present and that the render exists. Open edges remaining: guard 4, building_b 2, all others 0. I looked at every render myself. Each model is upright, faces the right way, is textured and casts a shadow, and none has a slab left.

**Notes for the game:** fronts face -Z (the run direction), so pickups and barriers show their back to the chase camera. Rotate them by π in the game if their front should face the camera. building_b's neon signs have letter-like squiggles from Hunyuan. The guard's face texture is rough. The runner is not rigged yet.

## 2026-10-08 — slice "pickups"

**Done:**
- Coins (`src/sim/pickups.ts`): pooled and seeded, generated ahead of the runner and kept in step with the obstacles. The shapes are lane lines, jump arcs on the exact gravity parabola (over low barriers or free-standing), low lines under gantries, and roof trails over ramp-car groups. Coins are never placed in lanes with oncoming trains. A coin is collected when its center is within 0.35 m of the runner collider (sphere vs box).
- Power-ups, each with a timer: jetpack (6 s), super sneakers (10 s), coin magnet (10 s) and score multiplier (12 s).
  - Jetpack: a critically damped climb to 5.6 m, well above the 3.2 m roofs. Granting it lays a weaving sky coin trail. When the timer ends, Nova falls under gravity. Until she lands and for 0.6 s after, obstacle hits are ignored, and if a train is below her she lands on its roof.
  - Sneakers: jump velocity 16, so the apex is 4.0 m instead of 2.07 m, still on a gravity arc.
  - Magnet: coins within 10 m are pulled toward the runner at 45 m/s.
  - Multiplier: x2 applies to distance points as they are earned, so earlier points are not doubled retroactively. Score = floor(distance points) + coins.
- Power-up pickups appear on the track at least 140 m apart; no jetpack spawns while flying.
- Rendering: instanced hex coins with an embossed bolt, spin and soft shadows (`src/game/pickupView.ts`). Pooled placeholder power-up meshes glow with an additive halo, a pulsing ground ring, a bob and a spin. Coin pickups pop and sparkle (`src/game/pickupFx.ts`), and power-ups burst. While flying, Nova wears a jetpack with flickering flames (`src/game/jetpackRig.ts`) and has her own flying pose. The camera pulls back with height.
- HUD (`src/game/hud.ts`): score, x1/x2 badge, coin count with a bump animation, best score, and one row per active power-up with a draining bar and seconds left.
- Game feel:
  - Lane spring ω raised from 32 to 36, so a lane switch is within 0.1 m of the target lane by 0.15 s (about 93% done at 0.12 s), with the body lean.
  - Down in mid-air sets vy ≤ −16 m/s and the roll starts on landing; this now also works when landing on a roof.
  - The coin and power-up sounds are wired in. Coin chimes step up in pitch. Audio stays muted until the first input.
  - The existing start screen and landing dust are kept.
- `window.__game`: `powerUps` (kind, timeLeft, duration), `powerUpTimers`, `pickups`, `runner.flying`, `runner.safeLanding`, `runner.jumpVelocity`, and new fields in `effects` and `audio`. Added `debug.grantPowerUp`, `spawnCoins`, `spawnPowerUp` and `clearPickups`. `setSpawning` now toggles pickups too.
- One existing collision test was moved so the train is beside the runner: with the faster lane snap, its old setup became a genuine front-on crash.
- live/, public/models/ and assets/ were not touched.

**Verified:** `npm run check` passed: typecheck, 60 unit tests and the build, then 18 Chromium e2e tests, all passing.
- New unit tests (`src/sim/pickups.test.ts`, plus additions to `runner.test.ts`): the collection radius boundary, magnet attraction and radius, multiplier scoring and expiry, sneakers apex vs normal apex (constant −g), jetpack duration, gravity landing and roof landing, generator shapes, pooling and determinism, the lane switch finishing within 0.15 s, and down in mid-air (vy ≤ −16, then rolling on landing).
- New e2e tests (`e2e/pickups.spec.ts`): the HUD and coin pop/sound, the four power-ups granted through the debug API (each checks its effect plus a visible, draining HUD timer), a glowing pickup collected by running through it, lane-switch timing and the down-cancel roll in the browser, and audio being muted before the first input.
- Manual Playwright screenshots (`test-results/pickups/`) show coin lines, the glowing pickups, sparkles, the HUD timers and the jetpack sky trail, at 60 fps.
