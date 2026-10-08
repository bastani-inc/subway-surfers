import * as THREE from 'three';
import { partBox } from '../sim/collision';
import { OBSTACLE_DEFS, OBSTACLE_KINDS, type ObstacleDef, type ObstacleKind, type PartDef } from '../sim/obstacleDefs';
import type { Obstacle } from '../sim/spawner';
import { chevronSignTexture, softRectShadowTexture, stripeTexture, toonMaterial, trainSideTexture } from './toon';

const BOGIE_HEIGHT = 0.35;
const DEBUG_COLOR = 0xff3b6b;
const GRAFFITI_VARIANTS = 4;

interface ObstacleMesh {
  kind: ObstacleKind;
  root: THREE.Group;
  model: THREE.Group;
  headlights: THREE.Object3D | null;
}

const shadowed = <T extends THREE.Object3D>(object: T): T => {
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
};

const boxMesh = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
};

class Materials {
  readonly trainBody = toonMaterial(0xf3ead2);
  readonly trainRoof = toonMaterial(0xc9c3b5);
  readonly trainRed = toonMaterial(0xd8262f);
  readonly bogie = toonMaterial(0x2a2638);
  readonly glass = toonMaterial(0x25335c, 0x2fb8ff, 0.35);
  readonly headlight = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  readonly rampDeck = toonMaterial(0xffffff);
  readonly barrierPanel = toonMaterial(0xffffff);
  readonly barrierLeg = toonMaterial(0x3a3550);
  readonly gantryPost = toonMaterial(0x4a2f8a, 0xff2fb8, 0.35);
  readonly gantrySign = toonMaterial(0xffffff, 0xffffff, 0.25);
  readonly contactShadow = new THREE.MeshBasicMaterial({ map: softRectShadowTexture(), transparent: true, depthWrite: false, opacity: 0.85 });
  readonly trainSides: THREE.MeshToonMaterial[] = [];

  constructor() {
    for (let i = 0; i < GRAFFITI_VARIANTS; i++) {
      const material = toonMaterial(0xffffff);
      material.map = trainSideTexture(101 + i * 37);
      this.trainSides.push(material);
    }
    this.rampDeck.map = stripeTexture('#ffd21a', '#2a2638', 8);
    this.barrierPanel.map = stripeTexture('#ffffff', '#ff2f5a', 6);
    this.gantrySign.map = chevronSignTexture();
    this.gantrySign.emissiveMap = this.gantrySign.map;
  }
}

const trainModel = (def: ObstacleDef, m: Materials, variant: number): { model: THREE.Group; headlights: THREE.Object3D } => {
  const { width, height, length } = def.size;
  const model = new THREE.Group();
  const bodyHeight = height - BOGIE_HEIGHT;
  const side = m.trainSides[variant % m.trainSides.length];
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, bodyHeight, length), [side, side, m.trainRoof, m.bogie, m.trainBody, m.trainBody]);
  body.position.y = BOGIE_HEIGHT + bodyHeight / 2;
  model.add(body);
  model.add(boxMesh(width * 0.82, BOGIE_HEIGHT, length * 0.86, m.bogie, 0, BOGIE_HEIGHT / 2, 0));
  model.add(boxMesh(width * 0.9, 0.12, length * 0.94, m.trainRoof, 0, height - 0.06, 0));
  model.add(boxMesh(width * 0.7, 0.8, 0.02, m.glass, 0, height - 1.05, length / 2 - 0.009));
  model.add(boxMesh(width * 0.98, 0.18, 0.02, m.trainRed, 0, BOGIE_HEIGHT + 0.5, length / 2 - 0.009));
  const headlights = new THREE.Group();
  for (const x of [-0.6, 0.6]) headlights.add(boxMesh(0.28, 0.18, 0.02, m.headlight, x, BOGIE_HEIGHT + 0.85, length / 2 - 0.008));
  model.add(headlights);
  return { model, headlights };
};

const rampGeometry = (def: ObstacleDef): THREE.BufferGeometry => {
  const { width, height, length } = def.size;
  const shape = new THREE.Shape();
  shape.moveTo(length / 2, 0);
  shape.lineTo(-length / 2, 0);
  shape.lineTo(-length / 2, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width / 2, 0, 0);
  return geometry;
};

const rampModel = (def: ObstacleDef, m: Materials): THREE.Group => {
  const { width, height, length } = def.size;
  const model = new THREE.Group();
  const wedge = new THREE.Mesh(rampGeometry(def), m.trainRed);
  model.add(wedge);
  const deckLength = Math.hypot(length, height);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.96, deckLength), m.rampDeck);
  deck.rotation.x = -Math.PI / 2 + Math.atan2(height, length);
  deck.position.set(0, height / 2 + 0.01, 0);
  model.add(deck);
  return model;
};

const partModel = (part: PartDef, material: THREE.Material): THREE.Mesh => {
  const [x0, y0, z0] = part.min;
  const [x1, y1, z1] = part.max;
  return boxMesh(x1 - x0, y1 - y0, z1 - z0, material, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
};

const barrierLowModel = (def: ObstacleDef, m: Materials): THREE.Group => {
  const { width, height, length } = def.size;
  const model = new THREE.Group();
  const panelBottom = height * 0.38;
  model.add(boxMesh(width, height - panelBottom, length * 0.6, m.barrierPanel, 0, (height + panelBottom) / 2, 0));
  for (const x of [-width * 0.38, width * 0.38]) {
    model.add(boxMesh(0.12, panelBottom, 0.12, m.barrierLeg, x, panelBottom / 2, 0));
    model.add(boxMesh(0.3, 0.08, length, m.barrierLeg, x, 0.04, 0));
  }
  return model;
};

const gantryModel = (def: ObstacleDef, m: Materials): THREE.Group => {
  const model = new THREE.Group();
  for (const part of def.parts) model.add(partModel(part, part.name === 'sign' ? m.gantrySign : m.gantryPost));
  return model;
};

const contactShadow = (def: ObstacleDef, m: Materials): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.size.width + 0.5, def.size.length + 0.6), m.contactShadow);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  mesh.renderOrder = 1;
  return mesh;
};

const debugLines = (def: ObstacleDef): THREE.LineSegments => {
  const geometries = def.parts.map((part) => {
    if (part.surface === 'ramp') return new THREE.EdgesGeometry(rampGeometry(def));
    const box = new THREE.BoxGeometry(part.max[0] - part.min[0], part.max[1] - part.min[1], part.max[2] - part.min[2]);
    box.translate((part.min[0] + part.max[0]) / 2, (part.min[1] + part.max[1]) / 2, (part.min[2] + part.max[2]) / 2);
    return new THREE.EdgesGeometry(box);
  });
  const positions: number[] = [];
  for (const g of geometries) positions.push(...(g.getAttribute('position').array as Float32Array));
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(merged, new THREE.LineBasicMaterial({ color: DEBUG_COLOR, depthTest: false, transparent: true }));
};

export class ObstacleView {
  readonly group = new THREE.Group();
  private readonly materials = new Materials();
  private readonly free = new Map<ObstacleKind, ObstacleMesh[]>(OBSTACLE_KINDS.map((k) => [k, []]));
  private readonly bound = new Map<number, ObstacleMesh>();
  private readonly seen = new Set<number>();
  private debugVisible = true;
  private created = 0;
  private trainVariant = 0;

  private build(kind: ObstacleKind): ObstacleMesh {
    const def = OBSTACLE_DEFS[kind];
    const root = new THREE.Group();
    let model: THREE.Group;
    let headlights: THREE.Object3D | null = null;
    if (kind === 'train') ({ model, headlights } = trainModel(def, this.materials, this.trainVariant++));
    else if (kind === 'rampCar') model = rampModel(def, this.materials);
    else if (kind === 'barrierLow') model = barrierLowModel(def, this.materials);
    else model = gantryModel(def, this.materials);
    shadowed(model);
    model.name = 'model';
    const debug = debugLines(def);
    debug.name = 'colliders';
    debug.renderOrder = 10;
    root.add(model, contactShadow(def, this.materials), debug);
    this.group.add(root);
    this.created++;
    return { kind, root, model, headlights };
  }

  setDebugVisible(visible: boolean): void {
    this.debugVisible = visible;
    for (const mesh of this.bound.values()) mesh.root.getObjectByName('colliders')!.visible = visible;
  }

  sync(active: readonly Obstacle[], alpha: number): void {
    this.seen.clear();
    for (const o of active) {
      this.seen.add(o.id);
      let mesh = this.bound.get(o.id);
      if (!mesh) {
        mesh = this.free.get(o.kind)!.pop() ?? this.build(o.kind);
        mesh.root.visible = true;
        mesh.root.getObjectByName('colliders')!.visible = this.debugVisible;
        this.bound.set(o.id, mesh);
      }
      if (mesh.headlights) mesh.headlights.visible = o.oncoming;
      mesh.root.position.set(o.x, 0, o.prevZ + (o.z - o.prevZ) * alpha);
    }
    for (const [id, mesh] of this.bound) {
      if (this.seen.has(id)) continue;
      mesh.root.visible = false;
      this.bound.delete(id);
      this.free.get(mesh.kind)!.push(mesh);
    }
  }

  modelBounds(o: Obstacle): THREE.Box3 | null {
    const mesh = this.bound.get(o.id);
    if (!mesh) return null;
    mesh.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(mesh.model, true);
  }

  colliderBounds(o: Obstacle): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const part of OBSTACLE_DEFS[o.kind].parts) {
      const box = partBox(part, o.x, o.z, o.z + part.min[2]);
      bounds.expandByPoint(new THREE.Vector3(box.minX, box.minY, box.minZ));
      bounds.expandByPoint(new THREE.Vector3(box.maxX, box.maxY, box.maxZ));
    }
    return bounds;
  }

  castsShadows(): boolean {
    for (const mesh of this.bound.values()) {
      let any = false;
      mesh.model.traverse((c) => {
        if ((c as THREE.Mesh).isMesh && c.castShadow) any = true;
      });
      if (!any) return false;
    }
    return true;
  }

  get stats(): { created: number; bound: number; pooled: number } {
    let pooled = 0;
    for (const list of this.free.values()) pooled += list.length;
    return { created: this.created, bound: this.bound.size, pooled };
  }
}
