import { keepContext } from "@bastani/atomic/workflows";

export const BRIEF = "docs/brief.md";
export const BUILD_LOG = "docs/build-log.md";
export const MANIFEST = "assets/manifest.json";
export const AGENT_BROWSER_SKILL =
  "/Users/alilavaee/.cache/.bun/install/global/node_modules/@bastani/atomic/dist/builtin/subagents/skills/agent-browser/SKILL.md";

const ORIGINALITY = keepContext(
  "All characters and designs are original (Nova, Officer Brask, Volt). Never copy or imitate Subway Surfers characters, names, logos, UI, or audio. Never print, log, or commit credential values.",
);

const COMMON = [
  `Read the project contract at ${BRIEF} first; it is the source of truth for requirements.`,
  `Append a short dated note of what you did and what you verified to ${BUILD_LOG} (create it if missing).`,
  ORIGINALITY,
].join("\n");

export interface SliceSpec {
  readonly id: string;
  readonly title: string;
  readonly scope: string;
  readonly acceptance: readonly string[];
}

export const PLACEHOLDER_SLICES: readonly SliceSpec[] = [
  {
    id: "core",
    title: "Project scaffold, core run loop, physics, camera, dev panels",
    scope: `Scaffold the game in the repository root: Vite + TypeScript + Three.js, Vitest, and Playwright (Chromium). Create these npm scripts: "dev", "build" (Vite with base "./" so dist/ works from any path), "typecheck", "test:unit", "test:e2e", and "check" (typecheck && test:unit && build && test:e2e, where e2e runs against "vite preview"). Add .gitignore entries for node_modules, dist, live, test-results, playwright-report, and assets/raw.
Implement the core loop with placeholder geometry (models arrive in a later slice; do not touch public/models/ or assets/): an endless scrolling three-lane track with rails and sleepers, a placeholder humanoid runner with procedurally alternating arms and legs, lane switching with eased momentum, a jump on a true gravity arc (constant acceleration, fixed-timestep integration at 60 Hz), a roll that lowers the collider, a low close chase camera behind the runner, a directional light with soft shadow maps, a ground shadow under the runner, developer panels (FPS/frame time, physics/collider debug overlay, spawn info) toggled by the H key, and a read-only window.__game debug API as described in the brief.`,
    acceptance: [
      "npm run check passes.",
      "Unit tests prove the jump apex height and airtime match the gravity and jump-velocity constants (parabolic, not tweened), that lane changes clamp to the three lanes, and that a roll lowers the collider height for a fixed duration.",
      "An e2e test drives arrow keys and confirms window.__game lane, jump height, and roll state change; another confirms that H hides and shows every developer panel; another samples fps over 3 s in the browser and asserts the 60 Hz fixed-step simulation advances about 60 steps per second.",
      "The runner sits on the track (feet at y≈0 when grounded) and casts a visible shadow.",
    ],
  },
  {
    id: "obstacles",
    title: "Trains, barriers, collisions, crash and catch sequence, score, speed ramp",
    scope: `With placeholder geometry sized to the brief's dimensions (models arrive later; keep obstacle definitions data-driven so models can replace meshes and colliders), add procedural spawning with object pooling: stationary and oncoming trains, train roofs reachable by ramps, low barriers (jump) and high gantries (roll). Use axis-aligned per-part colliders defined in one place. Classify collisions: a front-on hit is a crash, a side scrape bounces the runner back to the previous lane with a stumble, and landing on a roof keeps running. Chase (see "The chase" in the brief): placeholder Officer Brask and Volt start right behind the runner and drop back out of view. A stumble brings them back into view, close behind, for about 4 s, and a second stumble in that window is a catch. Crash sequence (front-on hit or second stumble): a backward physical impulse, a fall, Brask and Volt run in and catch the runner, then the game-over screen with score, high score, and restart. Trains come in groups across lanes with a ramp car you can run up onto the roofs. Score = distance × multiplier + coins; the high score persists in localStorage. Speed ramps smoothly over time to a cap.`,
    acceptance: [
      "npm run check passes.",
      "Unit tests cover front-on crash vs side scrape vs roof landing classification, gantry roll-under clearance, ramp climbing onto a roof, the chase state machine (stumble brings chasers close for ~4 s, a second stumble in that window catches, they drop back after it), the speed ramp curve and cap, and high-score persistence.",
      "An e2e test forces a crash via the debug API (or a seeded spawn), observes knockback (runner z decreases or y impulse) before the catch, then the game-over screen and a restart.",
      "Obstacles and runner rest on the ground with shadows; collider debug boxes visibly match the meshes when the dev panel is on.",
    ],
  },
  {
    id: "pickups",
    title: "Coins and power-ups",
    scope: `Add pooled coins in lane lines and jump arcs, and four power-ups with visible HUD timers: jetpack (rises above trains, flies a sky coin trail, lands safely when it expires), super sneakers (higher jump apex, still a gravity arc), coin magnet (pulls nearby coins toward the runner), and score multiplier (x2 score). Add a HUD with score, coins, and high score. Then do a game-feel pass per "Game feel" in the brief: lane switches snap in about 0.12 s with a body lean, down in mid-air cancels into a fast drop and roll, landing dust, coin pop-and-sparkle, glowing power-up pickups, original WebAudio synthesized sound effects (coin, jump, roll, power-up, stumble, crash; muted until the first user input), and a start screen with a tap-or-key-to-run prompt. Use placeholder meshes; models arrive later.`,
    acceptance: [
      "npm run check passes.",
      "Unit tests cover coin collection radius, magnet attraction, multiplier scoring, sneakers apex vs normal apex, and jetpack duration and landing.",
      "An e2e test grants each power-up via the debug API and asserts its effect and timer.",
      "Unit or e2e tests confirm the lane switch completes in ≤ 0.15 s and that down in mid-air makes vertical velocity strongly negative and then rolls on landing.",
    ],
  },
];

export const MODEL_SLICES: readonly SliceSpec[] = [
  {
    id: "models",
    title: "Swap in the generated 3D models, the mocap run, and model-derived colliders",
    scope: `Copy-free integration: load the cleaned GLBs from public/models/ (listed in ${MANIFEST}) with GLTFLoader and replace every placeholder: runner (play its motion-captured "run" clip with playback rate tied to ground speed so feet do not slide; use "jump"/"roll" clips if present, otherwise pose procedurally), guard and dog in the catch sequence, trains, barriers, coins, power-ups. Derive every collider from the model's measured bounds in ${MANIFEST} (per-part boxes such as the gantry beam and posts). Keep models grounded at y=0 with castShadow/receiveShadow. If a manifest entry is flagged as a stand-in, still use it.`,
    acceptance: [
      "npm run check passes.",
      "A unit test loads the manifest and asserts each collider equals the model's measured bounds (within 2 cm) and every model's min y is 0 (within 1 cm).",
      "An e2e test confirms the runner GLB animation mixer is playing the run clip while running and that the clip's time scale follows speed.",
      "A browser screenshot shows the textured models in the game with shadows under them.",
    ],
  },
  {
    id: "city",
    title: "Neon city, camera occlusion handling, 60 fps",
    scope: `Build the neon futuristic city around the tracks: instanced building_a/building_b towers on both sides, neon emissive accents with a cheap bloom (or emissive-only if bloom costs frames), fog, and the skyline image (assets/concept/skyline.png copied into public/) as a distant backdrop. Finish the camera: low and close behind the runner, with smooth lane and height follow, and when the runner is beside a train, on a roof, mid-jump, or on the jetpack the camera raises or pulls back so the runner stays fully in view and unoccluded. Profile and hit a steady 60 fps in Chrome (instancing, pooling, frustum culling, shadow-map budget).`,
    acceptance: [
      "npm run check passes.",
      "An e2e test places the runner (via the debug API) beside a train, on a roof, at jump apex, and on the jetpack, and for each asserts the runner's bounding box projects inside the camera's view and that a ray from the camera to the runner's chest hits nothing else first.",
      "An e2e fps test in headed Chrome (GPU) over 5 s of play reports average ≥ 58 fps and 1% low ≥ 50 fps with the city on.",
    ],
  },
];

export function implementPrompt(slice: SliceSpec): string {
  return [
    COMMON,
    `Implement slice "${slice.id}": ${slice.title}.`,
    slice.scope,
    keepContext(`Acceptance for this slice:\n- ${slice.acceptance.join("\n- ")}`),
    "The repository may already contain earlier work for this or previous slices. Inspect it and build on it rather than starting over, but bring it fully up to the current brief, which may have changed since the code was written (for example the art direction, chase, and game-feel sections).",
    keepContext("Work only on this slice's scope. Do not edit live/, public/models/, or assets/ unless the scope says so. Do not commit; the workflow commits verified work. Run `npm run check` yourself before finishing and fix failures."),
    "Finish with a short summary: files changed, tests added, the check result you observed.",
  ].join("\n\n");
}

export function repairPrompt(slice: SliceSpec, problem: string): string {
  return [
    COMMON,
    `Slice "${slice.id}" (${slice.title}) did not pass verification. Fix the root causes; do not weaken, skip, or delete tests to get green.`,
    keepContext(`Acceptance for this slice:\n- ${slice.acceptance.join("\n- ")}`),
    `Failure evidence:\n${problem}`,
    "Run `npm run check` before finishing and report the observed result.",
  ].join("\n\n");
}

export function reviewPrompt(slice: SliceSpec, checkOutput: string): string {
  return [
    `You are an independent reviewer. Read ${BRIEF}, then review slice "${slice.id}": ${slice.title}.`,
    keepContext(`Acceptance for this slice:\n- ${slice.acceptance.join("\n- ")}\nReview only. Do not edit source files.`),
    `The deterministic gate already passed. Tail of npm run check:\n${checkOutput.slice(-1500)}`,
    `Inspect the diff (git status / git diff) and the tests: do they really prove the criteria, or are they hollow? Then play the built game: run \`npx vite preview --port 4318\` in the background and use agent-browser (read ${AGENT_BROWSER_SKILL} first) to load http://127.0.0.1:4318, play with the keyboard, toggle H, and take screenshots into test-results/review-${slice.id}/. Look at the screenshots: models on the track, shadows, camera framing, physical motion. Stop the preview server when done.`,
    "Approve only if every acceptance criterion is met with real evidence. Otherwise list concrete, actionable findings.",
  ].join("\n\n");
}

export function conceptReviewPrompt(paths: readonly string[]): string {
  return [
    `Read ${BRIEF}. Inspect each concept image below with the read tool (they are PNGs).`,
    paths.map((path) => `- ${path}`).join("\n"),
    "For each 3D-bound asset, check it is a single complete subject, centered on a plain background, matching its design notes, suitable for image-to-3D (no cropping, no extra objects), and clearly original (not resembling Subway Surfers characters). Report the ids that must be regenerated, with a one-sentence prompt correction each. The skyline only needs to be a usable wide backdrop.",
  ].join("\n\n");
}

export function blenderPrompt(meshReport: string): string {
  return [
    COMMON,
    "Clean up the raw Hunyuan3D models in Blender (headless: `blender -b --python <script>`), keeping scripts in scripts/blender/ so the step is reproducible.",
    `Raw meshes and their status:\n${meshReport}`,
    keepContext(`For every asset: import the raw GLB from assets/raw/, remove loose fragments and the background slab if any, merge by distance, recalculate normals, decimate to the brief's triangle budget, scale to game units per ${BRIEF}, orient it facing -Z (trains along Z), place the origin at the bottom center so it rests at y=0, keep and pack the base-color texture, and export to public/models/<id>.glb (glTF binary, Y-up). Render a preview PNG per model to assets/renders/<id>.png (Eevee, three-quarter view, ground plane with shadow).`),
    keepContext(`Write ${MANIFEST}: for each id, {file, triangles, bounds: {min:[x,y,z], max:[x,y,z]}, parts: [{name, min, max}], standIn: boolean}. For barrier_high give separate parts for the overhead beam and each post; for train give body and roof. Measure bounds from the exported mesh.`),
    "If a raw mesh is missing because generation failed, model a simple stand-in in Blender matching the concept image, mark standIn: true, and say so. Do not rig the runner in this step. Finish with a table of id, triangles, height, and stand-in status, and look at every render yourself before finishing.",
  ].join("\n\n");
}

export function rigPrompt(): string {
  return [
    COMMON,
    keepContext("Rig the runner (public/models/runner.glb) and give it a real motion-captured run cycle. Keep scripts in scripts/blender/."),
    `Steps: build an armature for the runner mesh (Rigify human meta-rig fitted to the mesh, or a clean humanoid armature) and bind with automatic weights; fix bad weights around the hips, knees, and shoulders. Download a free motion-capture running BVH (CMU Graphics Lab Motion Capture Database, for example subject 16 or 35 run trials, via a public BVH mirror such as the cgspeed/CMU BVH conversion), import it in Blender, retarget it onto the runner armature, extract one seamless in-place run loop (remove root forward translation, keep vertical bob), and name the action "run". If you can find mocap jump and roll clips, add them as "jump" and "roll"; otherwise skip them. Do the same for the guard with the run clip if its mesh rigs cleanly. Export to public/models/runner.glb (and guard.glb) with animations, and update ${MANIFEST} with clip names, durations, and run stride length in metres (distance covered per loop at the source speed).`,
    keepContext("Verify numerically and visually: in Blender, sample the run loop and confirm the left and right feet alternate contact (each foot bone's lowest point within 3 cm of the ground for a contiguous stance phase) and that arms swing opposite to legs. Render an 8-frame contact strip to assets/renders/runner_run_strip.png and look at it. Report the measured stance phases and stride length."),
  ].join("\n\n");
}

export function assetReviewPrompt(): string {
  return [
    `You are an independent reviewer. Read ${BRIEF} and ${MANIFEST}. Review only; do not edit files.`,
    "Open every PNG in assets/renders/ with the read tool. Check that each model is recognizably its concept, matches the brief's bright cartoon art direction, is clearly an original design (not resembling any Subway Surfers character), sits on the ground plane with a shadow, has a sensible scale, has a texture, and that the runner run strip shows alternating legs with planted feet and opposite arm swing. Check that manifest bounds are plausible (runner about 1.7 m, train about 3.2 m tall) and that the GLBs exist in public/models/.",
    "Approve, or list concrete fixes.",
  ].join("\n\n");
}

export function acceptancePrompt(liveUrl: string): string {
  return [
    `You are the final acceptance tester for Neon Rail Rush. Read ${BRIEF}. Review only; do not edit source files.`,
    `The verified build is live at ${liveUrl}. Use agent-browser (read ${AGENT_BROWSER_SKILL} first) to open it in a separate session, play several runs, and check every acceptance item in the brief: lanes, jump arc, roll, trains and barriers, coins, each power-up (use window.__game where play is impractical), speed ramp, crash knockback then catch then game over, score and high score after reload, camera framing beside trains and in the air, shadows and grounding, H toggling developer panels, and fps from the panel or window.__game.`,
    "Save screenshots to test-results/acceptance/ and write docs/acceptance.md with one line per criterion: pass/fail, evidence (screenshot path or measured value).",
    "Return whether the game is accepted and list any failed criteria.",
  ].join("\n\n");
}
