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
