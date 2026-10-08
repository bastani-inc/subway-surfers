import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStoredCredential } from "@bastani/atomic";

export const IMAGE_MODEL = "gpt-image-2.5-flare";
export const SUPPORT_DIR = dirname(fileURLToPath(import.meta.url));

export interface AssetSpec {
  readonly id: string;
  readonly to3d: boolean;
  readonly size: "1024x1024" | "1536x1024";
  readonly subject: string;
}

const STYLE =
  "Original character/prop design for an indie mobile-style 3D endless-runner game set in a neon futuristic metro. Bright saturated stylized cartoon 3D look, chunky readable shapes, slightly oversized heads, hands and shoes on characters, clean toon-like materials, cheerful energetic mood. Entirely original design: must not resemble any existing game, film or brand character (in particular not any Subway Surfers character); no logos, no readable text.";

const FOR_3D =
  "Single subject only, centered, entire subject visible with margin, three-quarter front view, neutral even studio lighting, plain light-grey seamless background, no ground clutter, no cast shadow, no other objects.";

export const ASSETS: readonly AssetSpec[] = [
  { id: "runner", to3d: true, size: "1024x1024", subject: "Nova, a cartoon teen courier girl standing in a relaxed A-pose, arms slightly away from the body: teal asymmetric bob haircut, reflective cropped orange windbreaker, black cargo shorts, knee pads, chunky white sneakers with cyan LED soles." },
  { id: "guard", to3d: true, size: "1024x1024", subject: "Officer Brask, a stocky cartoon train inspector standing in a relaxed A-pose: teal conductor-style jacket with brass buttons and orange piping, round peaked cap with a lightning-bolt badge, thick brown mustache, whistle on a lanyard, chunky black boots." },
  { id: "dog", to3d: true, size: "1024x1024", subject: "Volt, a chunky cartoon robot hound standing in three-quarter view: round white body panels, stubby legs, big friendly glowing LED eyes, cyan light strips, antenna tail." },
  { id: "train", to3d: true, size: "1536x1024", subject: "A long boxy cartoon subway car seen from the front three-quarter angle: cream and red body covered in colorful abstract graffiti shapes with no letters or words, flat walkable roof, big round headlights, windows along the side." },
  { id: "barrier_low", to3d: true, size: "1024x1024", subject: "A waist-high track hazard barrier: sturdy frame with diagonal yellow-black and neon-orange stripes, small warning lights on top, two feet resting on the ground." },
  { id: "barrier_high", to3d: true, size: "1024x1024", subject: "An overhead track gantry barrier: two thin posts holding a wide striped warning sign high up with an open crawl-under gap below it, neon magenta warning lamps." },
  { id: "coin", to3d: true, size: "1024x1024", subject: "A thick hexagonal-edged gold game coin standing upright, embossed lightning-bolt emblem, subtle cyan rim glow." },
  { id: "jetpack", to3d: true, size: "1024x1024", subject: "A compact twin-thruster jetpack power-up: rounded orange shell, chrome nozzles with blue flame glow, shoulder straps." },
  { id: "sneakers", to3d: true, size: "1024x1024", subject: "A pair of super-sneaker power-up high-tops with exaggerated coiled spring soles, lime green and white, glowing laces." },
  { id: "magnet", to3d: true, size: "1024x1024", subject: "A chunky red-and-silver horseshoe magnet power-up with glowing cyan energy coils wrapped around its arms." },
  { id: "multiplier", to3d: true, size: "1024x1024", subject: "A floating score-multiplier power-up token: thick rounded purple badge with a bold raised 'x2' shape, glossy finish." },
  { id: "building_a", to3d: true, size: "1024x1024", subject: "A slim futuristic city tower block: stacked setbacks, glowing window grid, vertical neon strips, rooftop antenna, full height visible." },
  { id: "building_b", to3d: true, size: "1024x1024", subject: "A chunky futuristic apartment block with balconies, holographic billboards without text, magenta and teal neon trim, full height visible." },
  { id: "skyline", to3d: false, size: "1536x1024", subject: "Wide panoramic dusk skyline of a cartoon neon futuristic metro seen from elevated subway tracks: warm orange-pink sunset sky fading to purple, layered colorful towers with glowing signs (no readable text), distant elevated rails. Background matte painting, no foreground objects." },
];

export function promptFor(asset: AssetSpec): string {
  return [STYLE, asset.subject, asset.to3d ? FOR_3D : "Wide establishing background painting."].join(" ");
}

function storedKey(provider: string): string {
  const credential = readStoredCredential(provider);
  if (credential?.type !== "api_key" || !credential.key) {
    throw new Error(`No API key saved in Atomic for provider "${provider}". Run /login ${provider}.`);
  }
  return credential.key;
}

export async function generateConcept(asset: AssetSpec, outputPath: string, signal: AbortSignal, correction = ""): Promise<{ path: string; bytes: number }> {
  if (!correction && existsSync(outputPath)) return { path: outputPath, bytes: 0 };
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${storedKey("openai-api")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: [promptFor(asset), correction].join(" ").trim(), size: asset.size, quality: "high", n: 1 }),
  });
  const payload = (await response.json()) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(`Images API ${response.status} for ${asset.id}: ${payload.error?.message ?? "unknown error"}`);
  const item = payload.data?.[0];
  let image: Buffer;
  if (item?.b64_json) image = Buffer.from(item.b64_json, "base64");
  else if (item?.url) image = Buffer.from(await (await fetch(item.url, { signal })).arrayBuffer());
  else throw new Error(`Images API returned no image for ${asset.id}`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, image);
  return { path: outputPath, bytes: image.length };
}

export function imageTo3d(imagePath: string, outputPath: string, signal: AbortSignal): Promise<{ path: string; log: string }> {
  if (existsSync(outputPath)) return Promise.resolve({ path: outputPath, log: "cached" });
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "uv",
      ["run", "--quiet", "--with", "gradio_client", "python", join(SUPPORT_DIR, "hunyuan.py"), imagePath, outputPath],
      { signal, env: { ...process.env, HF_TOKEN: storedKey("huggingface") } },
    );
    let log = "";
    child.stdout.on("data", (chunk) => (log += chunk));
    child.stderr.on("data", (chunk) => (log += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const tail = log.slice(-1500).replace(/hf_[A-Za-z0-9]+/g, "hf_***");
      if (code === 0 && existsSync(outputPath)) resolvePromise({ path: outputPath, log: tail });
      else reject(new Error(`Hunyuan3D failed (exit ${code}): ${tail}`));
    });
  });
}

export function run(command: string, args: readonly string[], cwd: string, signal: AbortSignal): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, signal, env: { ...process.env, CI: "1" } });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, output: output.slice(-6000) }));
  });
}
