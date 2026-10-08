import * as THREE from 'three';
import { LANE_WIDTH, LANES } from '../sim/constants';
import { toonMaterial } from './toon';

const SIGNAL_COLORS = [0xff3355, 0x39ff6a, 0xffc21a, 0x2fd8ff];

const SLEEPER_SPACING = 1.1;
const VIEW_BEHIND = 20;
const VIEW_AHEAD = 140;
const SLEEPERS_PER_LANE = Math.ceil((VIEW_BEHIND + VIEW_AHEAD) / SLEEPER_SPACING) + 1;
const PYLON_SPACING = 16;
const PYLONS_PER_SIDE = Math.ceil((VIEW_BEHIND + VIEW_AHEAD) / PYLON_SPACING) + 1;
const RAIL_GAUGE = 1.1;
const RAIL_LENGTH = VIEW_BEHIND + VIEW_AHEAD;

export class Track {
  readonly group = new THREE.Group();
  private readonly sleepers: THREE.InstancedMesh;
  private readonly pylons: THREE.InstancedMesh;
  private readonly signals: THREE.InstancedMesh;
  private readonly rails: THREE.Group;
  private readonly ground: THREE.Mesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly signalColor = new THREE.Color();
  recycledSleepers = 0;

  constructor() {
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, RAIL_LENGTH + 40),
      toonMaterial(0x6b5a8c),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    this.sleepers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(RAIL_GAUGE + 0.8, 0.08, 0.28),
      toonMaterial(0x9a6340),
      SLEEPERS_PER_LANE * LANES.length,
    );
    this.sleepers.receiveShadow = true;
    this.sleepers.frustumCulled = false;
    this.group.add(this.sleepers);

    this.rails = new THREE.Group();
    const railGeometry = new THREE.BoxGeometry(0.08, 0.1, RAIL_LENGTH);
    const railMaterial = toonMaterial(0xdfe8f5, 0x334466, 0.4);
    for (const lane of LANES) {
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(railGeometry, railMaterial);
        rail.position.set(lane * LANE_WIDTH + (side * RAIL_GAUGE) / 2, 0.13, 0);
        rail.receiveShadow = true;
        this.rails.add(rail);
      }
    }
    this.group.add(this.rails);

    this.pylons = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.4, 5, 0.4),
      toonMaterial(0x4a2f8a, 0xff2fb8, 0.45),
      PYLONS_PER_SIDE * 2,
    );
    this.pylons.castShadow = true;
    this.pylons.frustumCulled = false;
    this.group.add(this.pylons);

    this.signals = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.28, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      PYLONS_PER_SIDE * 2,
    );
    this.signals.frustumCulled = false;
    for (let i = 0; i < this.signals.count; i++) this.signals.setColorAt(i, this.signalColor.setHex(SIGNAL_COLORS[i % SIGNAL_COLORS.length]));
    this.group.add(this.signals);
  }

  update(runnerZ: number): void {
    const centerZ = runnerZ - (VIEW_AHEAD - VIEW_BEHIND) / 2;
    this.ground.position.z = centerZ;
    this.rails.position.z = centerZ;

    const firstSleeper = Math.floor((runnerZ - VIEW_AHEAD) / SLEEPER_SPACING);
    let index = 0;
    for (const lane of LANES) {
      for (let i = 0; i < SLEEPERS_PER_LANE; i++) {
        this.matrix.makeTranslation(lane * LANE_WIDTH, 0.04, (firstSleeper + i) * SLEEPER_SPACING);
        this.sleepers.setMatrixAt(index++, this.matrix);
      }
    }
    this.sleepers.instanceMatrix.needsUpdate = true;
    this.recycledSleepers = Math.max(0, Math.floor(-runnerZ / SLEEPER_SPACING));

    const firstPylon = Math.floor((runnerZ - VIEW_AHEAD) / PYLON_SPACING);
    index = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < PYLONS_PER_SIDE; i++) {
        const x = side * (LANE_WIDTH * 1.5 + 1.6);
        const z = (firstPylon + i) * PYLON_SPACING;
        this.matrix.makeTranslation(x, 2.5, z);
        this.pylons.setMatrixAt(index, this.matrix);
        this.matrix.makeTranslation(x, 5.3, z);
        this.signals.setMatrixAt(index, this.matrix);
        const signalColor = SIGNAL_COLORS[(((firstPylon + i) % 4) + 4 + (side > 0 ? 2 : 0)) % SIGNAL_COLORS.length];
        this.signals.setColorAt(index, this.signalColor.setHex(signalColor));
        index++;
      }
    }
    this.pylons.instanceMatrix.needsUpdate = true;
    this.signals.instanceMatrix.needsUpdate = true;
    if (this.signals.instanceColor) this.signals.instanceColor.needsUpdate = true;
  }

  get instanceCounts(): { sleepers: number; pylons: number; signals: number } {
    return { sleepers: this.sleepers.count, pylons: this.pylons.count, signals: this.signals.count };
  }
}
