# Neon Rail Rush — project brief

Improved from the original request ("Build Subway Surfers…") with the prompt-engineer skill. Every workflow stage reads this file as its contract.

## Role

You are one stage of an automated pipeline that builds an original browser endless-runner and its 3D assets. Do only your stage's part, then report evidence.

## Goal

Ship **Neon Rail Rush**: an endless three-lane runner along subway tracks in a neon futuristic city. It should play and feel like Subway Surfers: the same three-lane genre, a low chase camera, trains with ramps and walkable roofs, an inspector and his dog chasing you, snappy swipes, and a bright cartoon look. Every character, name, logo, UI, and sound is still original. Do not copy or imitate Subway Surfers characters (Jake, Tricky, Fresh, or SYBO's inspector and dog), their likenesses, branding, logo, UI layout, or audio.

## Feel and art direction

- **Art style**: bright, saturated, chunky stylized cartoon, like a polished mobile 3D game, with big readable shapes, slightly oversized heads, hands, and shoes, and clean toon-like materials. The city is a neon futuristic metro at dusk: warm sunset sky fading to neon, graffiti-tagged trains (original abstract tags, no readable words), and colorful signal lights.
- **The chase**: Officer Brask, the train inspector, and Volt, his robo-hound, start the run right behind Nova, then drop back out of view. A side scrape or barrier clip makes Nova stumble, and Brask and Volt close in, visible behind her for about 4 seconds. A second stumble while they're close, or any front-on crash, means they catch her.
- **Game feel**: lane switches snap in about 0.12 s, with a slight body lean. Down in mid-air cancels the jump into a fast drop and roll. Landing kicks up dust, coins pop and sparkle on pickup, power-ups have glowing pickups, and short original sound effects (synthesized with WebAudio) play for coin, jump, roll, power-up, stumble, and crash. The start screen shows Nova ready with a tap-or-key-to-run prompt.

## Cast and assets (original designs)

| id | Asset | Design notes |
| --- | --- | --- |
| runner | Nova, the player | Teen courier with a teal asymmetric bob, reflective cropped orange windbreaker, black cargo shorts, knee pads, chunky LED sneakers. Full body, A-pose. |
| guard | Officer Brask, the train inspector | Stocky cartoon train inspector in an original design: teal conductor-style jacket with brass buttons and orange piping, round peaked cap with a lightning-bolt badge, thick mustache, whistle on a lanyard, chunky boots. Full body, A-pose. |
| dog | Volt, the inspector's robo-hound | Chunky cartoon robot hound, round white body panels, stubby legs, big friendly LED eyes, cyan light strips. |
| train | Subway car | Long, boxy cartoon subway car, cream and red with colorful abstract graffiti tags (no readable letters), flat roof you can run on, a slanted ramp car variant implied. |
| barrier_low | Low hazard barrier | Striped barrier, waist height: the runner jumps over it. |
| barrier_high | Overhead sign gantry | Barrier with a gap underneath: the runner rolls under it. |
| coin | Coin | Thick hex-edged coin with an embossed lightning bolt. |
| jetpack | Jetpack power-up | Twin-thruster backpack. |
| sneakers | Super sneakers power-up | Spring-soled high-tops. |
| magnet | Coin magnet power-up | Horseshoe magnet with glow coils. |
| multiplier | Score multiplier power-up | Floating "x2" token. |
| building_a, building_b | City blocks | Neon towers placed beside the tracks. |
| skyline | City backdrop | Wide night skyline used as the background (image only). |

## Pipeline requirements

1. **Concept art**: one image per asset from `gpt-image-2.5-flare`, called directly through the OpenAI Images API with the OpenAI API key saved in Atomic (provider `openai-api`). Single subject, centered, full view, plain light background, so image-to-3D works.
2. **3D**: each image (except the skyline) becomes a textured GLB through the `tencent/Hunyuan3D-2.1` Hugging Face Space, using the Hugging Face token saved in Atomic (provider `huggingface`).
3. **Blender cleanup**: Blender in background mode recenters each model, puts its origin at the base, scales it to game units (1 unit = 1 m; runner ≈ 1.7 m tall, train ≈ 3.2 m tall and ≈ 12 m long), fixes normals, decimates to a web budget (characters ≤ 30k triangles, props ≤ 8k), keeps the texture, and renders a preview PNG of each model for review.
4. **Rig and motion capture**: rig the runner and retarget a real motion-captured run cycle (for example a CMU Graphics Lab Motion Capture Database BVH, which is free to use) so arms and legs alternate and feet plant on the ground. Export the run as a named animation clip in the runner GLB. Rig the guard with a run cycle too if feasible.
5. Never print, log, commit, or pass credential values in prompts or artifacts.

## Game requirements (acceptance criteria)

- Three.js + TypeScript + Vite, running in the browser.
- Endless three-lane track. Left/right (arrows or A/D) switch lanes, up/W/Space jumps, down/S rolls. Swipe works on touch.
- Trains (some stationary, some oncoming) and barriers are spawned procedurally. Low barriers are jumped, high gantries are rolled under, and trains can be dodged or climbed via ramps.
- Coins appear in lines and arcs. Power-ups: jetpack (fly above trains collecting a sky coin trail), super sneakers (higher jumps), coin magnet (pulls in nearby coins), score multiplier (x2). Each power-up has a visible timer.
- Speed increases smoothly over time up to a cap. Score grows with distance × multiplier plus coins. The high score persists in `localStorage`.
- **Physical motion**: the runner plays the mocap run with alternating arms and legs and feet planted on the track, with no sliding (animation speed matched to ground speed). Jumps follow a gravity arc: constant downward acceleration, with no linear tweening. A roll drops the collider and plays a ground-level roll. Lane changes ease with momentum.
- **Grounding**: every model rests on the track or ground plane (origin at its base) and casts a shadow; there are soft shadows under the runner, trains, barriers, and pickups.
- **Collisions match the models**: colliders come from each model's measured bounds (per-part boxes where one box is too coarse, such as the gantry gap). A front-on hit with a train or barrier is a crash; a side scrape knocks the runner back into the previous lane and stumbles them.
- **Crash**: on a front-on crash or a second stumble, the runner is knocked backward with a physical impulse and falls. Officer Brask and Volt run in and catch them, and only then does the game-over screen appear with score, high score, and restart.
- **Camera**: low and close behind the runner, slightly above shoulder height, looking down the track, smoothly following lane changes and height. The runner stays fully in view and unoccluded at all times, including beside trains, on train roofs, mid-jump, and on the jetpack (pull back or raise when needed).
- **Performance**: steady 60 fps on this Mac in Chrome. Use a fixed-timestep simulation at 60 Hz, instancing and object pooling for spawned items, and baked or limited real-time lights.
- **Developer panels**: FPS/frame time, physics/collider debug, and spawn info panels. The **H** key toggles all developer panels on and off.
- The game exposes a read-only `window.__game` debug API (state, speed, runner position and collider, camera, active power-ups, fps) for automated tests.

## Live preview and promotion

The user watches the game build in Chrome. A local server serves only the `live/` directory. A build is copied into `live/` only after it passes `npm run check` (typecheck, unit tests, and browser end-to-end tests) and an independent review. Failing work is never shown.

## Stop rules

Finish your stage's whole contract and its checks. Report blockers precisely (missing access, quota, failed tool) rather than faking results. Never record a check as passed unless it ran and passed.
