import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

const toonGradient = (): THREE.DataTexture => {
  if (gradient) return gradient;
  const tones = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(tones, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
};

export const toonMaterial = (color: number, emissive = 0x000000, emissiveIntensity = 0.8): THREE.MeshToonMaterial =>
  new THREE.MeshToonMaterial({ color, emissive, emissiveIntensity, gradientMap: toonGradient() });

export const SKY_HORIZON = 0xffa36b;

export const duskSkyTexture = (): THREE.Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#2b1468');
    sky.addColorStop(0.35, '#7a2bb8');
    sky.addColorStop(0.62, '#ff4f9a');
    sky.addColorStop(0.82, '#ffa36b');
    sky.addColorStop(1, '#ffd88a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const canvasTexture = (width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const TAG_COLORS = ['#ff2f8f', '#18d6c4', '#ffd21a', '#7a3bff', '#39ff6a', '#ff7a1a', '#2fb8ff'];

export const trainSideTexture = (seed: number): THREE.CanvasTexture =>
  canvasTexture(512, 128, (ctx) => {
    const rand = mulberry(seed);
    ctx.fillStyle = '#f3ead2';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#d8262f';
    ctx.fillRect(0, 92, 512, 18);
    ctx.fillStyle = '#25335c';
    for (let x = 18; x < 500; x += 62) ctx.fillRect(x, 22, 44, 30);
    for (let i = 0; i < 5; i++) {
      const cx = rand() * 512;
      const cy = 64 + rand() * 50;
      ctx.fillStyle = TAG_COLORS[Math.floor(rand() * TAG_COLORS.length)];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let k = 0; k < 7; k++) ctx.quadraticCurveTo(cx + (rand() - 0.5) * 120, cy + (rand() - 0.5) * 50, cx + (rand() - 0.5) * 110, cy + (rand() - 0.5) * 44);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#1b0f33';
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.strokeStyle = TAG_COLORS[Math.floor(rand() * TAG_COLORS.length)];
      ctx.beginPath();
      ctx.arc(cx + (rand() - 0.5) * 40, cy, 10 + rand() * 14, rand() * 3, rand() * 3 + 3.5);
      ctx.stroke();
    }
  });

export const stripeTexture = (a: string, b: string, stripes = 6): THREE.CanvasTexture =>
  canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = b;
    const step = 256 / stripes;
    for (let i = -1; i < stripes + 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 64);
      ctx.lineTo(i * step + step / 2, 64);
      ctx.lineTo(i * step + step, 0);
      ctx.lineTo(i * step + step / 2, 0);
      ctx.closePath();
      ctx.fill();
    }
  });

export const chevronSignTexture = (): THREE.CanvasTexture =>
  canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#1a0f3d';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#ffd21a';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, 240, 112);
    ctx.fillStyle = '#ff2f8f';
    for (const x of [70, 128, 186]) {
      ctx.beginPath();
      ctx.moveTo(x - 24, 40);
      ctx.lineTo(x, 88);
      ctx.lineTo(x + 24, 40);
      ctx.lineTo(x + 12, 40);
      ctx.lineTo(x, 64);
      ctx.lineTo(x - 12, 40);
      ctx.closePath();
      ctx.fill();
    }
  });

export const softRectShadowTexture = (): THREE.CanvasTexture =>
  canvasTexture(64, 64, (ctx) => {
    const image = ctx.createImageData(64, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const edge = Math.min(x, 63 - x, y, 63 - y) / 14;
        const alpha = Math.min(1, edge) ** 1.5;
        const i = (y * 64 + x) * 4;
        image.data[i] = 20;
        image.data[i + 1] = 0;
        image.data[i + 2] = 40;
        image.data[i + 3] = Math.round(alpha * 200);
      }
    ctx.putImageData(image, 0, 0);
  });
