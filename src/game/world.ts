import * as THREE from "three";
import { GAME_CONFIG, COLORS } from "./config";
import { distanceToSegment, mulberry32, valueNoise } from "./random";
import type { BiomeDef, Course, Vec2, WorldControl } from "./types";
import { VegetationSystem, type VegetationKind } from "./vegetation";
import { TrafficSystem } from "./traffic";

export type Surface = "trail" | "grass" | "marsh" | "water" | "road" | VegetationKind;
interface Obstacle { x: number; z: number; r: number }
export interface WaterBody { x: number; z: number; r: number; level: number }
export interface MarshBody { x: number; z: number; r: number; level: number }
export interface BuildingFootprint { x: number; z: number; w: number; d: number; rotation: number }
export interface TreePoint { x: number; z: number; s: number; birch: boolean }

const HALF = GAME_CONFIG.WORLD_SIZE / 2;
const CELL = 12;
const TREE_CELL = 10;

export class World {
  readonly group = new THREE.Group();
  readonly controls: WorldControl[];
  readonly trails: Vec2[][];
  readonly cityPaths: Vec2[][] = [];
  readonly streams: Vec2[][];
  readonly waters: WaterBody[];
  readonly marshes: MarshBody[];
  readonly buildings: BuildingFootprint[] = [];
  readonly rocks: Array<{ x: number; z: number; s: number }> = [];
  readonly trees: TreePoint[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly vegetation: VegetationSystem;
  readonly traffic?: TrafficSystem;
  readonly monster = new THREE.Group();
  private readonly obstacleGrid = new Map<string, Obstacle[]>();
  private readonly treeGrid = new Map<string, TreePoint[]>();
  private readonly controlGroups: THREE.Group[] = [];
  private readonly halos: THREE.Mesh[] = [];
  private readonly beacons: THREE.Mesh[] = [];
  private readonly birds: THREE.Group[] = [];
  private waterMaterial?: THREE.MeshStandardMaterial;
  private cityTexture?: THREE.CanvasTexture;
  private elapsed = 0;
  private monsterTime = 0;

  constructor(private scene: THREE.Scene, readonly biome: BiomeDef, readonly course: Course) {
    this.controls = course.controls.map((cp, index) => ({ ...cp, index }));
    this.trails = this.makeTrails();
    this.waters = biome.urban || biome.mine ? [] : [this.makeWater(82, 42, 27), this.makeWater(-94, -84, 17)];
    this.marshes = biome.urban || biome.mine ? [] : [
      this.makeMarsh(42, -28, 28 + biome.marshiness * 12),
      this.makeMarsh(-78, 5, 13 + biome.marshiness * 15),
      this.makeMarsh(95, 105, 10 + biome.marshiness * 8),
    ];
    this.streams = biome.urban || biome.mine ? [] : this.makeStreams();
    scene.add(this.group);
    this.buildTerrain();
    this.buildWaterAndMarsh();
    this.buildTrails();
    if (biome.urban) this.buildCity();
    if (biome.id === "recreation") this.buildRecreation();
    if (biome.mine) this.buildMine();
    this.traffic = biome.urban ? new TrafficSystem(this.group, (x, z) => this.heightAt(x, z)) : undefined;
    this.buildFeatures();
    this.vegetation = new VegetationSystem(this.group, biome, course, {
      heightAt: (x, z) => this.heightAt(x, z),
      isNearTrail: (x, z, d) => this.isNearTrail(x, z, d),
      isNearControl: (x, z, d) => this.isNearControl(x, z, d),
      inWater: (x, z, m) => this.inWater(x, z, m),
      isObstacle: (x, z, m) => this.isObstacle(x, z, m),
    });
    if (!biome.mine) {
      this.buildVegetation();
      this.buildMarshVegetation();
      this.buildWildlife();
    }
    this.buildControls();
    this.buildStartFinish();
    this.rebuildObstacleGrid();
  }

  private rawHeight(x: number, z: number): number {
    if (this.biome.mine) return valueNoise(x / 18, z / 18, this.biome.seed) * 0.12;
    const a = this.biome.terrainAmplitude;
    let h = valueNoise(x / 82, z / 82, this.biome.seed) * a;
    h += valueNoise(x / 31, z / 31, this.biome.seed + 17) * a * 0.22;
    h += valueNoise(x / 14, z / 14, this.biome.seed + 41) * a * 0.055;
    h += valueNoise(x / 5.5, z / 5.5, this.biome.seed + 83) * Math.min(0.55, a * 0.035);
    h += Math.exp(-((x - 25) ** 2 + (z - 86) ** 2) / 1500) * a * 0.45;
    h -= Math.exp(-((x - 5) ** 2 + (z + 11) ** 2) / 260) * Math.min(3.2, a * 0.5);
    h -= Math.exp(-((x + 101) ** 2 / 950 + (z - 56) ** 2 / 95)) * Math.min(4.5, a * 0.3);
    h -= Math.exp(-((x + 20) ** 2 / 130 + (z + 116) ** 2 / 1500)) * Math.min(3.8, a * 0.24);
    h += Math.exp(-((x + 55) ** 2 / 180 + (z - 4) ** 2 / 1700)) * Math.min(3.2, a * 0.18);
    if (this.biome.id === "north-ural") h += Math.max(0, (x + z + 80) / 170) * 4;
    if (this.biome.id === "slyudorudnik") {
      h += (x + 170) / 340 * 9 + Math.max(0, Math.sin((x + z) / 27)) * 2.1;
      h -= Math.exp(-((x - 38) ** 2 / 170 + (z + 4) ** 2 / 2100)) * 5.5;
    }
    return h;
  }

  heightAt(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    for (const water of this.waters ?? []) {
      const d = Math.hypot(x - water.x, z - water.z);
      if (d < water.r * 1.65) {
        const t = Math.min(1, Math.max(0, (water.r * 1.65 - d) / (water.r * 0.85)));
        h = THREE.MathUtils.lerp(h, water.level - 1.15, t * t * (3 - 2 * t));
      }
    }
    for (const marsh of this.marshes ?? []) {
      const d = Math.hypot(x - marsh.x, z - marsh.z);
      if (d < marsh.r * 1.35) {
        const t = Math.min(1, Math.max(0, (marsh.r * 1.35 - d) / (marsh.r * 0.65)));
        h = THREE.MathUtils.lerp(h, marsh.level - 0.34, t * 0.82);
      }
    }
    for (const stream of this.streams ?? []) {
      for (let i = 0; i < stream.length - 1; i++) {
        const d = distanceToSegment(x, z, stream[i].x, stream[i].z, stream[i + 1].x, stream[i + 1].z);
        if (d < 2.2) h -= (1 - d / 2.2) * 0.72;
      }
    }
    return h;
  }

  private lowPoint(x: number, z: number, radius: number): { x: number; z: number; h: number } {
    let best = { x, z, h: this.rawHeight(x, z) };
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI * 2 / 16;
      const ring = i < 16 ? radius * 0.42 : radius * 0.82;
      const px = x + Math.cos(angle) * ring, pz = z + Math.sin(angle) * ring;
      const h = this.rawHeight(px, pz);
      if (h < best.h) best = { x: px, z: pz, h };
    }
    return best;
  }

  private makeWater(x: number, z: number, r: number): WaterBody {
    const low = this.lowPoint(x, z, r);
    return { x: low.x, z: low.z, r, level: low.h - 0.18 };
  }

  private makeMarsh(x: number, z: number, r: number): MarshBody {
    const low = this.lowPoint(x, z, r);
    return { x: low.x, z: low.z, r, level: low.h - 0.08 };
  }

  private makeStreams(): Vec2[][] {
    if (!this.waters.length) return [];
    const target = this.waters[0];
    return [
      [{ x: -20, z: -150 }, { x: -20, z: -116 }, { x: 4, z: -86 }, { x: 32, z: -42 }, { x: 54, z: -4 }, { x: target.x, z: target.z }],
      [{ x: -156, z: 18 }, { x: -123, z: 8 }, { x: -106, z: -27 }, { x: this.waters[1]?.x ?? -94, z: this.waters[1]?.z ?? -84 }],
    ];
  }

  private makeTrails(): Vec2[][] {
    if (this.biome.mine) return [
      [this.course.start, ...this.course.controls, this.course.finish],
      [{ x: -145, z: 70 }, { x: -70, z: 70 }, { x: 0, z: 70 }, { x: 75, z: 70 }, { x: 145, z: 70 }],
      [{ x: -95, z: -140 }, { x: -95, z: -60 }, { x: -95, z: 20 }, { x: -95, z: 120 }],
      [{ x: 40, z: -140 }, { x: 40, z: -60 }, { x: 40, z: 20 }, { x: 40, z: 120 }],
    ];
    if (this.biome.urban) return [
      [{ x: -155, z: -90 }, { x: 155, z: -90 }], [{ x: -155, z: 0 }, { x: 155, z: 0 }], [{ x: -155, z: 90 }, { x: 155, z: 90 }],
      [{ x: -90, z: -155 }, { x: -90, z: 155 }], [{ x: 0, z: -155 }, { x: 0, z: 155 }], [{ x: 90, z: -155 }, { x: 90, z: 155 }],
    ];
    if (this.biome.tutorial) return [
      [{ x: -78, z: 70 }, { x: -35, z: 40 }, { x: 0, z: 12 }, { x: 37, z: -17 }, { x: 72, z: -62 }],
      [{ x: -45, z: -50 }, { x: -35, z: 40 }, { x: 25, z: 65 }],
    ];
    return [
      [{ x: -155, z: 126 }, { x: -132, z: 112 }, { x: -91, z: 73 }, { x: -41, z: 46 }, { x: 1, z: 31 }, { x: 52, z: 11 }, { x: 116, z: -59 }, { x: 150, z: -117 }],
      [{ x: -143, z: -112 }, { x: -91, z: -73 }, { x: -26, z: -76 }, { x: -41, z: 46 }, { x: -31, z: 61 }, { x: 25, z: 86 }, { x: 86, z: 143 }],
      [{ x: -145, z: 15 }, { x: -86, z: 105 }, { x: -31, z: 61 }, { x: 20, z: 56 }, { x: 76, z: 37 }, { x: 135, z: 36 }],
      [{ x: -20, z: -145 }, { x: -20, z: -116 }, { x: 31, z: -29 }, { x: 79, z: -109 }, { x: 126, z: -116 }],
      [{ x: -118, z: 35 }, { x: -104, z: 26 }, { x: -92, z: 30 }, { x: -81, z: 17 }],
      [{ x: 12, z: 121 }, { x: 22, z: 105 }, { x: 16, z: 91 }, { x: 25, z: 86 }],
      [{ x: 103, z: 74 }, { x: 111, z: 57 }, { x: 102, z: 43 }, { x: 112, z: 28 }],
      [{ x: -71, z: -23 }, { x: -57, z: -31 }, { x: -61, z: -41 }, { x: -47, z: -55 }],
      [{ x: 47, z: -91 }, { x: 56, z: -79 }, { x: 71, z: -83 }, { x: 79, z: -69 }],
    ];
  }

  private buildTerrain(): void {
    const geometry = new THREE.PlaneGeometry(GAME_CONFIG.WORLD_SIZE, GAME_CONFIG.WORLD_SIZE, this.biome.mine ? 24 : 128, this.biome.mine ? 24 : 128);
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(this.biome.ground), light = new THREE.Color(this.biome.groundLight), color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = this.heightAt(x, z);
      pos.setY(i, y);
      const variation = THREE.MathUtils.clamp(0.42 + valueNoise(x / 18, z / 18, this.biome.seed + 99) * 0.24 + y * 0.012, 0.12, 0.85);
      color.copy(base).lerp(light, variation);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: this.biome.mine ? 0.12 : 0 }));
    terrain.receiveShadow = true;
    this.group.add(terrain);
  }

  private irregularDisc(radius: number, seed: number): THREE.BufferGeometry {
    const geometry = new THREE.CircleGeometry(radius, 64);
    const pos = geometry.attributes.position;
    for (let i = 1; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), angle = Math.atan2(y, x);
      const scale = 0.94 + Math.sin(angle * 5 + seed) * 0.035 + Math.sin(angle * 9 + seed * 0.3) * 0.022;
      pos.setXY(i, x * scale, y * scale);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildWaterAndMarsh(): void {
    this.waterMaterial = new THREE.MeshStandardMaterial({ color: 0x548d9b, roughness: 0.24, metalness: 0.12, transparent: true, opacity: 0.87 });
    for (const water of this.waters) {
      const mesh = new THREE.Mesh(this.irregularDisc(water.r, this.biome.seed), this.waterMaterial);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(water.x, water.level, water.z); this.group.add(mesh);
      const shore = new THREE.Mesh(new THREE.RingGeometry(water.r * 0.96, water.r + 1.25, 64), new THREE.MeshStandardMaterial({ color: 0x839078, roughness: 1 }));
      shore.rotation.x = -Math.PI / 2; shore.position.set(water.x, water.level + 0.035, water.z); this.group.add(shore);
    }
    const marshMaterial = new THREE.MeshStandardMaterial({ color: 0x4e6658, roughness: 0.88, transparent: true, opacity: 0.9 });
    for (const marsh of this.marshes) {
      const mesh = new THREE.Mesh(this.irregularDisc(marsh.r, this.biome.seed + marsh.x), marshMaterial);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(marsh.x, marsh.level, marsh.z); this.group.add(mesh);
    }
    for (const stream of this.streams) {
      const water = this.ribbon(stream, 1.25, 0x5e97a0, 0.11);
      this.group.add(water);
      this.group.add(this.ribbon(stream, 2.4, 0x566c5b, 0.045));
    }
  }

  private buildTrails(): void {
    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i];
      if (this.biome.urban) {
        this.group.add(this.ribbon(trail, 12.8, 0xb5b2a8, 0.055));
        this.group.add(this.ribbon(trail, 7.1, 0xd0c9b8, 0.075));
        const road = this.ribbon(trail, 5.9, 0x50585b, 0.09); road.receiveShadow = true; this.group.add(road);
      } else if (!this.biome.mine) {
        const width = i === 0 ? 1.35 : i < 4 ? 0.78 : 0.32;
        const mesh = this.ribbon(trail, width, i < 4 ? 0x918263 : 0x756d52, 0.075);
        mesh.receiveShadow = true; this.group.add(mesh);
      }
    }
  }

  private ribbon(points: Vec2[], width: number, color: number, lift = 0.075): THREE.Mesh {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, "centripetal");
    const segments = Math.max(24, points.length * 14);
    const positions: number[] = [], indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, p = curve.getPoint(t), tangent = curve.getTangent(t);
      const nx = -tangent.z, nz = tangent.x;
      for (const side of [-1, 1]) {
        const x = p.x + nx * width * 0.5 * side, z = p.z + nz * width * 0.5 * side;
        positions.push(x, this.heightAt(x, z) + lift, z);
      }
      if (i < segments) {
        const n = i * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
  }

  private isUrbanPark(x: number, z: number): boolean {
    return (x > -78 && x < -12 && z > 12 && z < 78) || (x > 12 && x < 78 && z > -78 && z < -12) || (x > -78 && x < -12 && z > -78 && z < -12);
  }

  private buildCity(): void {
    const rng = mulberry32(this.biome.seed + 400);
    const lots: Array<{ x: number; z: number; w: number; d: number; h: number; color: THREE.Color }> = [];
    for (let x = -144; x <= 144; x += 18) for (let z = -144; z <= 144; z += 18) {
      if (this.isUrbanPark(x, z) || this.isNearRoad(x, z, 11) || this.isNearControl(x, z, 9) || rng() < 0.1) continue;
      const w = 11 + rng() * 4.5, d = 10 + rng() * 5, h = 9 + rng() * 24;
      lots.push({ x: x + (rng() - 0.5) * 2.2, z: z + (rng() - 0.5) * 2.2, w, d, h, color: new THREE.Color().setHSL(0.07 + rng() * 0.09, 0.08 + rng() * 0.1, 0.52 + rng() * 0.2) });
    }
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.getCityTexture(), roughness: 0.88 });
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, lots.length);
    const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x515a5b, roughness: 0.9 }), lots.length);
    const entrances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x354443, roughness: 0.65 }), lots.length);
    const dummy = new THREE.Object3D();
    lots.forEach((lot, i) => {
      const y = this.heightAt(lot.x, lot.z);
      dummy.position.set(lot.x, y + lot.h / 2, lot.z); dummy.scale.set(lot.w, lot.h, lot.d); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); blocks.setMatrixAt(i, dummy.matrix); blocks.setColorAt(i, lot.color);
      dummy.position.y = y + lot.h + 0.18; dummy.scale.set(lot.w + 0.4, 0.36, lot.d + 0.4); dummy.updateMatrix(); roofs.setMatrixAt(i, dummy.matrix);
      dummy.position.set(lot.x, y + 1.25, lot.z + lot.d / 2 + 0.45); dummy.scale.set(2.1, 2.5, 0.9); dummy.updateMatrix(); entrances.setMatrixAt(i, dummy.matrix);
      this.buildings.push({ x: lot.x, z: lot.z, w: lot.w, d: lot.d, rotation: 0 });
      this.obstacles.push({ x: lot.x, z: lot.z, r: Math.min(lot.w, lot.d) * 0.51 });
    });
    blocks.instanceMatrix.needsUpdate = true; roofs.instanceMatrix.needsUpdate = true; entrances.instanceMatrix.needsUpdate = true;
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
    blocks.castShadow = true; blocks.receiveShadow = true;
    this.group.add(blocks, roofs, entrances);
    this.buildCityPaths();
    this.buildStreetProps(rng);
    this.buildPlayground(-45, -45);
    this.buildPlayground(45, -45);
    this.buildSquare(45, 45);
  }

  private buildCityPaths(): void {
    this.cityPaths.push(
      [{ x: -76, z: 18 }, { x: -45, z: 45 }, { x: -14, z: 76 }],
      [{ x: -76, z: 76 }, { x: -45, z: 45 }, { x: -14, z: 14 }],
      [{ x: 14, z: -14 }, { x: 45, z: -45 }, { x: 76, z: -76 }],
      [{ x: -76, z: -14 }, { x: -45, z: -45 }, { x: -14, z: -76 }],
      [{ x: 14, z: 45 }, { x: 76, z: 45 }],
    );
    for (const path of this.cityPaths) this.group.add(this.ribbon(path, 2.4, 0xc5bda9, 0.105));
  }

  private buildStreetProps(rng: () => number): void {
    const dummy = new THREE.Object3D();
    const curbs: Array<{ x: number; z: number; r: number }> = [];
    const markings: Array<{ x: number; z: number; r: number }> = [];
    for (const lane of [-90, 0, 90]) for (let v = -150; v <= 150; v += 6) {
      if ([-90, 0, 90].some((cross) => Math.abs(v - cross) < 7)) continue;
      for (const side of [-1, 1]) {
        curbs.push({ x: v, z: lane + side * 3.15, r: 0 }, { x: lane + side * 3.15, z: v, r: Math.PI / 2 });
      }
      if (v % 12 === 0) markings.push({ x: v, z: lane, r: 0 }, { x: lane, z: v, r: Math.PI / 2 });
    }
    const curbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(5.7, 0.18, 0.18), new THREE.MeshStandardMaterial({ color: 0xd5d1c4, roughness: 1 }), curbs.length);
    curbs.forEach((p, i) => { dummy.position.set(p.x, this.heightAt(p.x, p.z) + 0.16, p.z); dummy.scale.setScalar(1); dummy.rotation.set(0, p.r, 0); dummy.updateMatrix(); curbMesh.setMatrixAt(i, dummy.matrix); });
    const markingMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.7, 0.025, 0.12), new THREE.MeshStandardMaterial({ color: 0xe8e3cf, roughness: 1 }), markings.length);
    markings.forEach((p, i) => { dummy.position.set(p.x, this.heightAt(p.x, p.z) + 0.14, p.z); dummy.rotation.set(0, p.r, 0); dummy.updateMatrix(); markingMesh.setMatrixAt(i, dummy.matrix); });
    curbMesh.instanceMatrix.needsUpdate = true; markingMesh.instanceMatrix.needsUpdate = true; this.group.add(curbMesh, markingMesh);

    const stripes: Array<{ x: number; z: number; r: number }> = [];
    for (const x of [-90, 0, 90]) for (const z of [-90, 0, 90]) {
      for (let i = -3; i <= 3; i++) {
        stripes.push({ x: x + i * 0.72, z: z + 5.2, r: 0 }, { x: x + i * 0.72, z: z - 5.2, r: 0 });
        stripes.push({ x: x + 5.2, z: z + i * 0.72, r: Math.PI / 2 }, { x: x - 5.2, z: z + i * 0.72, r: Math.PI / 2 });
      }
    }
    const crossings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.03, 3.1), new THREE.MeshStandardMaterial({ color: 0xf0ede0, roughness: 0.9 }), stripes.length);
    stripes.forEach((p, i) => { dummy.position.set(p.x, this.heightAt(p.x, p.z) + 0.145, p.z); dummy.rotation.set(0, p.r, 0); dummy.updateMatrix(); crossings.setMatrixAt(i, dummy.matrix); });
    crossings.instanceMatrix.needsUpdate = true; this.group.add(crossings);

    const lampPositions: Vec2[] = [];
    for (const lane of [-90, 0, 90]) for (let v = -132; v <= 132; v += 33) {
      if ([-90, 0, 90].some((cross) => Math.abs(v - cross) < 8)) continue;
      lampPositions.push({ x: lane + 5.2, z: v }, { x: v, z: lane - 5.2 });
    }
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 4.8, 6), new THREE.MeshStandardMaterial({ color: 0x41494a, roughness: 0.7 }), lampPositions.length);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.18, 0.25), new THREE.MeshStandardMaterial({ color: 0xffe4a8, emissive: 0x806329, emissiveIntensity: 0.7 }), lampPositions.length);
    lampPositions.forEach((p, i) => {
      const y = this.heightAt(p.x, p.z);
      dummy.rotation.set(0, 0, 0); dummy.position.set(p.x, y + 2.4, p.z); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + 4.75; dummy.updateMatrix(); lamps.setMatrixAt(i, dummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true; lamps.instanceMatrix.needsUpdate = true; this.group.add(poles, lamps);

    for (let i = 0; i < 18; i++) {
      const horizontal = i % 2 === 0, lane = [-90, 0, 90][i % 3], v = -126 + Math.floor(i / 3) * 45;
      const x = horizontal ? v : lane + (i % 4 < 2 ? 5.5 : -5.5), z = horizontal ? lane + (i % 4 < 2 ? 5.5 : -5.5) : v;
      if (this.isNearControl(x, z, 3)) continue;
      const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 6), poles.material);
      sign.position.set(x, this.heightAt(x, z) + 1.1, z); this.group.add(sign);
      const plate = this.makeTextPlane(i % 2 ? "40" : "СТОП", 0.65, 0.45, i % 2 ? "#e8e3d5" : "#b84b3e", i % 2 ? "#333" : "#fff");
      plate.position.set(x, this.heightAt(x, z) + 2.1, z); this.group.add(plate);
    }
    for (const [x, z, length] of [[-122, -68, 18], [-42, 68, 15], [48, -120, 20], [118, 68, 16], [-118, 118, 14]] as const) {
      if (!this.isNearControl(x, z, 7) && !this.isNearRoad(x, z, 8)) this.addFence(x, z, length);
    }
    for (let i = 0; i < 12; i++) {
      const x = -70 + (i % 4) * 15, z = 23 + Math.floor(i / 4) * 22;
      if (!this.isNearRoad(x, z, 6)) this.addBench(x, z, i % 2 ? Math.PI / 2 : 0);
    }
    this.addBusStop(8, 7);
    this.addBusStop(-98, -7);
  }

  private addBench(x: number, z: number, rotation: number): void {
    const group = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x76573c, roughness: 1 }), metal = new THREE.MeshStandardMaterial({ color: 0x3c4846, roughness: 0.8 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.48), wood); seat.position.y = 0.52; group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.65, 0.1), wood); back.position.set(0, 0.85, 0.22); group.add(back);
    for (const side of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.42), metal); leg.position.set(side * 0.68, 0.26, 0); group.add(leg); }
    group.position.set(x, this.heightAt(x, z), z); group.rotation.y = rotation; this.group.add(group);
  }

  private addBusStop(x: number, z: number): void {
    const group = new THREE.Group(), metal = new THREE.MeshStandardMaterial({ color: 0x405655, roughness: 0.55 }), glass = new THREE.MeshStandardMaterial({ color: 0x8fb2b5, transparent: true, opacity: 0.45, roughness: 0.2 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 1.8), metal); roof.position.y = 2.5; group.add(roof);
    const back = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 0.08), glass); back.position.set(0, 1.3, 0.75); group.add(back);
    for (const side of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.5, 0.1), metal); post.position.set(side * 1.9, 1.25, 0.7); group.add(post); }
    group.position.set(x, this.heightAt(x, z), z); this.group.add(group);
  }

  private buildPlayground(x: number, z: number): void {
    const y = this.heightAt(x, z), sand = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshStandardMaterial({ color: 0xbba876, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(x, y + 0.1, z); this.group.add(sand);
    const metal = new THREE.MeshStandardMaterial({ color: 0x476e70, roughness: 0.65 }), bright = new THREE.MeshStandardMaterial({ color: 0xd6743f, roughness: 0.7 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), metal); post.position.set(x + side * 1.5, y + 1.3, z); this.group.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 0.14), metal); bar.position.set(x, y + 2.55, z); this.group.add(bar);
    for (const side of [-0.65, 0.65]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.8, 5), metal); rope.position.set(x + side, y + 1.62, z); this.group.add(rope);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.32), bright); seat.position.set(x + side, y + 0.72, z); this.group.add(seat);
    }
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 3.4), bright); slide.position.set(x + 4, y + 1.1, z); slide.rotation.x = -0.48; this.group.add(slide);
  }

  private buildSquare(x: number, z: number): void {
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(17, 40), new THREE.MeshStandardMaterial({ color: 0xbcb8aa, roughness: 1 }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.set(x, this.heightAt(x, z) + 0.11, z); this.group.add(plaza);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.5, 0.65, 12), new THREE.MeshStandardMaterial({ color: 0x777d77, roughness: 0.9 })); base.position.set(x, this.heightAt(x, z) + 0.4, z); this.group.add(base);
    const sculpture = new THREE.Mesh(new THREE.TorusKnotGeometry(1.1, 0.22, 48, 8), new THREE.MeshStandardMaterial({ color: 0x607b74, metalness: 0.5, roughness: 0.4 })); sculpture.position.set(x, this.heightAt(x, z) + 2.2, z); this.group.add(sculpture);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; this.addBench(x + Math.cos(a) * 12, z + Math.sin(a) * 12, -a); }
  }

  private buildRecreation(): void {
    const cabins = [
      [-105, 92], [-62, 80], [-12, 104], [48, 82], [105, 72],
      [-112, -12], [-62, -32], [2, -58], [62, -72], [112, -28],
    ];
    for (let i = 0; i < cabins.length; i++) this.addCabin(cabins[i][0], cabins[i][1], i);
  }

  private addCabin(x: number, z: number, index: number): void {
    const y = this.heightAt(x, z), rotation = index % 2 ? Math.PI / 2 : 0;
    const cabin = new THREE.Group(); cabin.position.set(x, y, z); cabin.rotation.y = rotation;
    const wood = new THREE.MeshStandardMaterial({ color: index % 3 === 0 ? 0x9a6b43 : 0x805a3d, roughness: 1 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x5f412c, roughness: 1 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xe0d4b6, roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x87adb2, emissive: 0x5c542e, emissiveIntensity: 0.25, roughness: 0.25 });
    const house = new THREE.Mesh(new THREE.BoxGeometry(7, 3.3, 5.5), wood); house.position.y = 1.8; house.castShadow = true; cabin.add(house);
    for (let row = 0; row < 9; row++) {
      const yy = 0.3 + row * 0.38;
      for (const side of [-1, 1]) {
        const frontLog = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 7.35, 8), row % 2 ? wood : darkWood);
        frontLog.rotation.z = Math.PI / 2; frontLog.position.set(0, yy, side * 2.77); cabin.add(frontLog);
        const sideLog = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 5.9, 8), row % 2 ? darkWood : wood);
        sideLog.rotation.x = Math.PI / 2; sideLog.position.set(side * 3.52, yy, 0); cabin.add(sideLog);
      }
    }
    for (const side of [-1, 1]) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(8.1, 0.2, 3.75), new THREE.MeshStandardMaterial({ color: index % 2 ? 0x3f524c : 0x536057, roughness: 0.88 }));
      roof.position.set(0, 4.35, side * 1.45); roof.rotation.x = side * 0.55; cabin.add(roof);
    }
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 8.2, 7), darkWood); ridge.rotation.z = Math.PI / 2; ridge.position.y = 5.32; cabin.add(ridge);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.25, 0.12), darkWood); door.position.set(0.7, 1.3, 2.86); cabin.add(door);
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd5b464, metalness: 0.55, roughness: 0.35 })); handle.position.set(1.08, 1.28, 2.96); cabin.add(handle);
    for (const wx of [-2.05, 2.25]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.4, 0.14), trim); frame.position.set(wx, 2.05, 2.88); cabin.add(frame);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.13, 0.08), glass); pane.position.set(wx, 2.05, 2.97); cabin.add(pane);
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.15, 0.06), trim); mullion.position.set(wx, 2.05, 3.03); cabin.add(mullion);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.07, 0.06), trim); cross.position.set(wx, 2.05, 3.03); cabin.add(cross);
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.35, 0.1), darkWood); shutter.position.set(wx - 0.94, 2.05, 2.9); cabin.add(shutter);
    }
    const porch = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.24, 2.25), darkWood); porch.position.set(0, 0.25, 3.85); cabin.add(porch);
    for (let i = 0; i < 3; i++) { const step = new THREE.Mesh(new THREE.BoxGeometry(2.2 + i * 0.25, 0.16, 0.42), darkWood); step.position.set(0.5, 0.08 + i * 0.1, 5.15 - i * 0.36); cabin.add(step); }
    for (const side of [-1, 1]) {
      for (const px of [side * 2.45, side * 1.15]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.35, 0.14), trim); post.position.set(px, 1.4, 4.55); cabin.add(post); }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.12), trim); rail.position.set(side * 1.82, 1.05, 4.55); cabin.add(rail);
      for (let j = 0; j < 4; j++) { const baluster = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.75, 0.07), trim); baluster.position.set(side * (1.25 + j * 0.34), 0.67, 4.55); cabin.add(baluster); }
    }
    const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.16, 2.65), new THREE.MeshStandardMaterial({ color: 0x46564f, roughness: 0.9 })); porchRoof.position.set(0, 3.25, 3.8); porchRoof.rotation.x = -0.12; cabin.add(porchRoof);
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.65, 2, 0.65), new THREE.MeshStandardMaterial({ color: 0x826b5b, roughness: 1 })); chimney.position.set(-2.2, 4.75, -0.7); cabin.add(chimney);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.15, 0.86), darkWood); cap.position.set(-2.2, 5.77, -0.7); cabin.add(cap);
    for (let i = 0; i < 7; i++) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.1, 7), darkWood); log.rotation.x = Math.PI / 2; log.position.set(-4.05 + (i % 2) * 0.28, 0.18 + Math.floor(i / 2) * 0.24, 0.8); cabin.add(log); }
    this.group.add(cabin);
    this.buildings.push({ x, z, w: 7.4, d: 6, rotation });
    this.obstacles.push({ x, z, r: 4 });
  }

  private addBuilding(x: number, z: number, w: number, d: number, h: number, rotation = 0): void {
    this.buildings.push({ x, z, w, d, rotation });
    const material = new THREE.MeshStandardMaterial({ color: this.biome.urban ? 0xb7b6ac : 0x9a7654, map: this.biome.urban && h > 9 ? this.getCityTexture() : undefined, roughness: 0.9 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, this.heightAt(x, z) + h / 2, z); mesh.rotation.y = rotation; mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.35, 0.35, d + 0.35), new THREE.MeshStandardMaterial({ color: 0x565c5c, roughness: 0.85 }));
    roof.position.set(x, this.heightAt(x, z) + h + 0.15, z); roof.rotation.y = rotation; this.group.add(roof);
    this.obstacles.push({ x, z, r: Math.min(w, d) * 0.48 });
  }

  private buildFeatures(): void {
    const rng = mulberry32(this.biome.seed + 800);
    for (const cp of this.controls) {
      if (cp.feature === "rock") this.addRock(cp.x - 1.5, cp.z + 1.1, 1.25 + rng() * 0.5, true);
      else if (cp.feature === "tree" || cp.feature === "root") this.addDistinctiveTree(cp.x + 1.8, cp.z + 0.8, cp.feature === "root");
      else if (cp.feature === "building" && !this.biome.mine) this.addBuilding(cp.x + 3.7, cp.z + 3.7, 7.4, 7.4, this.biome.urban ? 12 : 5.5, 0);
      else if (cp.feature === "fence" && !this.biome.mine) this.addFence(cp.x + 2.5, cp.z, 8);
    }
  }

  private addRock(x: number, z: number, scale: number, obstacle = false): void {
    if (this.biome.urban && this.isNearRoad(x, z, 5)) return;
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: this.biome.rock, roughness: 0.82, metalness: this.biome.mine ? 0.32 : 0.02, flatShading: true }));
    mesh.scale.set(scale * 1.15, scale * 0.85, scale); mesh.rotation.set(0.2, x * 0.17, -0.1); mesh.position.set(x, this.heightAt(x, z) + scale * 0.55, z);
    mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh); this.rocks.push({ x, z, s: scale });
    if (obstacle) this.obstacles.push({ x, z, r: scale * 0.85 });
  }

  private addDistinctiveTree(x: number, z: number, roots: boolean): void {
    if (this.biome.mine) { this.addRock(x, z, 0.8, true); return; }
    if (this.biome.urban && this.isNearRoad(x, z, 5)) { x += 8; }
    const group = new THREE.Group(), ground = this.heightAt(x, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 7.8, 8), new THREE.MeshStandardMaterial({ color: this.biome.id === "south-ural" ? 0xd7d2bd : 0x66503b, roughness: 1 }));
    trunk.position.y = 3.9; trunk.castShadow = true; group.add(trunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.5, 1), new THREE.MeshStandardMaterial({ color: this.biome.treeLight, roughness: 1, flatShading: true }));
    crown.scale.set(1, 1.35, 1); crown.position.y = 8.3; crown.castShadow = true; group.add(crown);
    if (roots) for (let i = 0; i < 5; i++) {
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 1.8, 5), trunk.material);
      root.rotation.z = Math.PI / 2.7; root.rotation.y = i * Math.PI * 0.4; root.position.set(Math.sin(i * 1.256) * 0.6, 0.25, Math.cos(i * 1.256) * 0.6); group.add(root);
    }
    group.position.set(x, ground, z); this.group.add(group); this.obstacles.push({ x, z, r: 0.55 });
    this.trees.push({ x, z, s: 1.25, birch: this.biome.id === "south-ural" });
  }

  private addFence(x: number, z: number, length: number): void {
    if (this.biome.urban && this.isNearRoad(x, z, 5)) return;
    const material = new THREE.MeshStandardMaterial({ color: this.biome.urban ? 0x65716c : 0x6e6252, roughness: 1 });
    for (let i = 0; i <= 4; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 0.14), material);
      post.position.set(x + (i / 4 - 0.5) * length, this.heightAt(x, z) + 0.6, z); this.group.add(post);
    }
    for (const y of [0.45, 0.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, 0.1), material); rail.position.set(x, this.heightAt(x, z) + y, z); this.group.add(rail);
    }
  }

  private buildVegetation(): void {
    const rng = mulberry32(this.biome.seed);
    const multiplier = this.biome.terrainDifficulty >= 5 ? 1.48 : this.biome.terrainDifficulty >= 3 ? 1.3 : 1;
    const target = this.biome.urban ? 780 : Math.round(this.biome.treeDensity * multiplier);
    const positions: TreePoint[] = [];
    let attempts = 0;
    while (positions.length < target && attempts++ < target * 10) {
      let x = (rng() - 0.5) * (GAME_CONFIG.WORLD_SIZE - 16), z = (rng() - 0.5) * (GAME_CONFIG.WORLD_SIZE - 16);
      if (this.biome.urban) {
        const parks = [{ x: -45, z: 45 }, { x: 45, z: -45 }, { x: -45, z: -45 }], park = parks[Math.floor(rng() * parks.length)];
        x = park.x + (rng() - 0.5) * 57; z = park.z + (rng() - 0.5) * 57;
        if (!this.isUrbanPark(x, z) || this.isNearCityPath(x, z, 2.2)) continue;
      }
      if (this.isNearTrail(x, z, this.biome.urban ? 7.8 : 2.6) || this.isNearControl(x, z, 4) || this.inWater(x, z, 3)) continue;
      const patch = this.vegetation.kindAt(x, z);
      if (patch === "meadow" || patch === "thorn") continue;
      if (this.obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 1.7)) continue;
      positions.push({ x, z, s: 0.82 + rng() * 0.68, birch: this.biome.id === "south-ural" ? rng() < 0.82 : this.biome.id === "bog" ? rng() < 0.46 : rng() < 0.22 });
    }
    const count = positions.length;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.29, 1, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), count);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), count);
    const crownTop = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), count);
    const contactShadows = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: 0x14251b, transparent: true, opacity: 0.2, depthWrite: false }), count);
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const p = positions[i], y = this.heightAt(p.x, p.z), height = (p.birch ? 8.4 : 10.8) * p.s;
      dummy.position.set(p.x, y + height * 0.39, p.z); dummy.scale.set(p.s, height * 0.78, p.s); dummy.rotation.set(0, rng() * Math.PI, 0); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
      color.set(p.birch ? 0xd8d5c5 : 0x68513c).offsetHSL(0, 0, (rng() - 0.5) * 0.08); trunk.setColorAt(i, color);
      dummy.position.set(p.x, y + height * 0.68, p.z); dummy.scale.set(2.25 * p.s, height * 0.58, 2.25 * p.s); dummy.updateMatrix(); crown.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + height * 0.93; dummy.scale.set(1.55 * p.s, height * 0.42, 1.55 * p.s); dummy.updateMatrix(); crownTop.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x + 0.35 * p.s, y + 0.045, p.z + 0.25 * p.s); dummy.scale.set(2.4 * p.s, 1.7 * p.s, 1); dummy.rotation.set(-Math.PI / 2, 0, 0.35); dummy.updateMatrix(); contactShadows.setMatrixAt(i, dummy.matrix);
      color.set(this.biome.trees).offsetHSL((rng() - 0.5) * 0.025, 0, (rng() - 0.5) * 0.09); crown.setColorAt(i, color);
      color.set(this.biome.treeLight).offsetHSL(0, 0, (rng() - 0.5) * 0.08); crownTop.setColorAt(i, color);
      this.obstacles.push({ x: p.x, z: p.z, r: 0.25 * p.s + 0.13 });
    }
    this.trees.push(...positions);
    trunk.receiveShadow = true;
    trunk.instanceMatrix.needsUpdate = true; crown.instanceMatrix.needsUpdate = true; crownTop.instanceMatrix.needsUpdate = true; contactShadows.instanceMatrix.needsUpdate = true;
    if (trunk.instanceColor) trunk.instanceColor.needsUpdate = true;
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    if (crownTop.instanceColor) crownTop.instanceColor.needsUpdate = true;
    this.group.add(contactShadows, trunk, crown, crownTop);
    this.indexTrees();
    if (!this.biome.urban) this.buildRockField(rng);
  }

  private indexTrees(): void {
    this.treeGrid.clear();
    for (const tree of this.trees) {
      const key = `${Math.floor(tree.x / TREE_CELL)},${Math.floor(tree.z / TREE_CELL)}`;
      const cell = this.treeGrid.get(key); if (cell) cell.push(tree); else this.treeGrid.set(key, [tree]);
    }
  }

  treeCountNear(x: number, z: number, radius = 10): number {
    const cx = Math.floor(x / TREE_CELL), cz = Math.floor(z / TREE_CELL), range = Math.ceil(radius / TREE_CELL);
    let count = 0;
    for (let dx = -range; dx <= range; dx++) for (let dz = -range; dz <= range; dz++) {
      const cell = this.treeGrid.get(`${cx + dx},${cz + dz}`); if (!cell) continue;
      for (const tree of cell) if (Math.hypot(tree.x - x, tree.z - z) <= radius) count++;
    }
    return count;
  }

  private buildRockField(rng: () => number): void {
    const rocks: Array<{ x: number; z: number; s: number }> = [];
    let attempts = 0;
    while (rocks.length < this.biome.rockDensity && attempts++ < this.biome.rockDensity * 7) {
      const x = (rng() - 0.5) * 320, z = (rng() - 0.5) * 320;
      if (this.isNearTrail(x, z, 1.8) || this.isNearControl(x, z, 3) || this.inWater(x, z, 1)) continue;
      const large = this.biome.id === "slyudorudnik" && rng() < 0.2;
      const rock = { x, z, s: large ? 1.4 + rng() * 2.2 : 0.25 + rng() * 0.95 };
      rocks.push(rock); this.rocks.push(rock);
    }
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: this.biome.rock, roughness: 0.9, metalness: this.biome.id === "slyudorudnik" ? 0.12 : 0, flatShading: true }), rocks.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rocks.length; i++) {
      const p = rocks[i];
      dummy.position.set(p.x, this.heightAt(p.x, p.z) + p.s * 0.35, p.z); dummy.scale.set(p.s * 1.35, p.s * 0.78, p.s); dummy.rotation.set(rng(), rng() * Math.PI, rng() * 0.3); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (p.s > 0.7) this.obstacles.push({ x: p.x, z: p.z, r: p.s * 0.62 });
    }
    mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true; this.group.add(mesh);
  }

  private buildMarshVegetation(): void {
    if (!this.marshes.length) return;
    const rng = mulberry32(this.biome.seed + 5150), reedsPerMarsh = 190;
    const reeds = new THREE.InstancedMesh(new THREE.ConeGeometry(0.055, 1.2, 5), new THREE.MeshStandardMaterial({ color: 0x718059, roughness: 1 }), this.marshes.length * reedsPerMarsh);
    const hummocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 1), new THREE.MeshStandardMaterial({ color: 0x667251, roughness: 1, flatShading: true }), this.marshes.length * 70);
    const deadTrees = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.16, 3.8, 6), new THREE.MeshStandardMaterial({ color: 0x716853, roughness: 1 }), this.marshes.length * 14);
    const dummy = new THREE.Object3D(); let ri = 0, hi = 0, ti = 0;
    for (const marsh of this.marshes) {
      for (let i = 0; i < reedsPerMarsh; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * marsh.r * 0.96, x = marsh.x + Math.cos(a) * r, z = marsh.z + Math.sin(a) * r;
        dummy.position.set(x, this.heightAt(x, z) + 0.55, z); dummy.scale.set(0.7 + rng(), 0.7 + rng() * 0.8, 0.7 + rng()); dummy.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI, (rng() - 0.5) * 0.15); dummy.updateMatrix(); reeds.setMatrixAt(ri++, dummy.matrix);
      }
      for (let i = 0; i < 70; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * marsh.r * 0.9, x = marsh.x + Math.cos(a) * r, z = marsh.z + Math.sin(a) * r;
        dummy.position.set(x, this.heightAt(x, z) + 0.1, z); dummy.scale.set(0.5 + rng(), 0.2 + rng() * 0.35, 0.5 + rng()); dummy.rotation.set(0, rng() * Math.PI, 0); dummy.updateMatrix(); hummocks.setMatrixAt(hi++, dummy.matrix);
      }
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2, r = marsh.r * (0.7 + rng() * 0.45), x = marsh.x + Math.cos(a) * r, z = marsh.z + Math.sin(a) * r;
        dummy.position.set(x, this.heightAt(x, z) + 1.8, z); dummy.scale.setScalar(0.7 + rng() * 0.65); dummy.rotation.set((rng() - 0.5) * 0.18, rng() * Math.PI, (rng() - 0.5) * 0.18); dummy.updateMatrix(); deadTrees.setMatrixAt(ti++, dummy.matrix);
      }
    }
    reeds.instanceMatrix.needsUpdate = true; hummocks.instanceMatrix.needsUpdate = true; deadTrees.instanceMatrix.needsUpdate = true;
    this.group.add(hummocks, reeds, deadTrees);
  }

  private buildWildlife(): void {
    const rng = mulberry32(this.biome.seed + 2903);
    const wingGeometry = new THREE.BufferGeometry();
    wingGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.85, 0.08, 0.2, 0.12, 0, -0.12], 3)); wingGeometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({ color: this.biome.urban ? 0x536068 : 0x263b35, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const bird = new THREE.Group(), left = new THREE.Mesh(wingGeometry, material), right = new THREE.Mesh(wingGeometry, material);
      right.scale.x = -1; bird.add(left, right);
      bird.userData.centerX = (rng() - 0.5) * 210; bird.userData.centerZ = (rng() - 0.5) * 210; bird.userData.radius = 12 + rng() * 24; bird.userData.phase = rng() * Math.PI * 2; bird.userData.speed = 0.1 + rng() * 0.09; bird.scale.setScalar(0.45 + rng() * 0.35);
      this.birds.push(bird); this.group.add(bird);
    }
  }

  private buildMine(): void {
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x39423f, roughness: 0.58, metalness: 0.36, flatShading: true });
    const timber = new THREE.MeshStandardMaterial({ color: 0x554332, roughness: 1 });
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x626b69, metalness: 0.72, roughness: 0.35 });
    for (const path of this.trails) {
      this.group.add(this.ribbon(path, 5.8, 0x303633, 0.04));
      for (let s = 0; s < path.length - 1; s++) {
        const a = path[s], b = path[s + 1], length = Math.hypot(b.x - a.x, b.z - a.z), angle = Math.atan2(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(length / 4));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, x = THREE.MathUtils.lerp(a.x, b.x, t), z = THREE.MathUtils.lerp(a.z, b.z, t), y = this.heightAt(x, z);
          const nx = Math.cos(angle), nz = -Math.sin(angle);
          for (const side of [-1, 1]) {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.6, 4.4), wallMaterial);
            wall.position.set(x + nx * side * 3.25, y + 1.8, z + nz * side * 3.25); wall.rotation.y = angle; this.group.add(wall);
            this.obstacles.push({ x: x + nx * side * 3.05, z: z + nz * side * 3.05, r: 0.72 });
          }
          if (i % 2 === 0) {
            for (const side of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.22), timber); post.position.set(x + nx * side * 2.5, y + 1.6, z + nz * side * 2.5); this.group.add(post); }
            const beam = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 0.25), timber); beam.position.set(x, y + 3.1, z); beam.rotation.y = angle + Math.PI / 2; this.group.add(beam);
          }
          for (const side of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 4.25), railMaterial); rail.position.set(x + nx * side * 0.65, y + 0.1, z + nz * side * 0.65); rail.rotation.y = angle; this.group.add(rail); }
        }
      }
    }
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.25, 5, 8), new THREE.MeshStandardMaterial({ color: 0x090b0a, roughness: 1 }));
    body.position.y = 1.05; this.monster.add(body);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff5b35 });
    for (const side of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMaterial); eye.position.set(side * 0.13, 1.68, -0.31); this.monster.add(eye); }
    this.monster.visible = false; this.group.add(this.monster);
  }

  updateMonster(dt: number, player: Vec2, darkness: number): boolean {
    if (!this.biome.mine) return false;
    this.monsterTime += dt * (0.3 + darkness * 1.8);
    if (darkness > 0.6 && this.monsterTime > 7) {
      const angle = this.monsterTime * 0.17, distance = Math.max(4, 17 - this.monsterTime * 0.09);
      this.monster.position.set(player.x + Math.sin(angle) * distance, this.heightAt(player.x, player.z), player.z + Math.cos(angle) * distance);
      this.monster.lookAt(player.x, this.monster.position.y + 1.2, player.z); this.monster.visible = true;
      if (this.monsterTime > 12) { this.monsterTime = -18; return true; }
    } else {
      this.monster.visible = false;
      if (darkness < 0.2) this.monsterTime = Math.max(-4, this.monsterTime - dt * 2.5);
    }
    return false;
  }

  private buildControls(): void {
    const flagTexture = this.makeFlagTexture();
    for (const cp of this.controls) {
      const group = new THREE.Group(), y = this.heightAt(cp.x, cp.z); group.position.set(cp.x, y, cp.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0x4a4a43, roughness: 0.8 })); pole.position.y = 0.75; group.add(pole);
      const flagMaterial = new THREE.MeshBasicMaterial({ map: flagTexture, side: THREE.DoubleSide });
      for (let side = 0; side < 3; side++) {
        const angle = side * Math.PI * 2 / 3, flag = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.43), flagMaterial);
        flag.position.set(Math.sin(angle) * 0.125, 1.23, Math.cos(angle) * 0.125); flag.rotation.y = angle; group.add(flag);
      }
      const station = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.15), new THREE.MeshStandardMaterial({ color: COLORS.orange, emissive: 0x5a1805, emissiveIntensity: 0.5, roughness: 0.55 })); station.position.set(0.42, 0.82, 0); group.add(station);
      const code = this.makeTextPlane(String(cp.code), 0.34, 0.2, "#f6f1df", "#20251f"); code.position.set(0.42, 1.06, 0.081); group.add(code);
      const halo = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.34, 32), new THREE.MeshBasicMaterial({ color: COLORS.orange, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2; halo.position.y = 0.08; halo.visible = false; group.add(halo); this.halos.push(halo);
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.65, 26, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff9b52, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      beacon.position.y = 13; beacon.visible = false; group.add(beacon); this.beacons.push(beacon);
      this.controlGroups.push(group); this.group.add(group);
    }
  }

  private getCityTexture(): THREE.CanvasTexture {
    if (this.cityTexture) return this.cityTexture;
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c5c4bc"; ctx.fillRect(0, 0, 256, 256);
    for (let y = 12; y < 256; y += 31) {
      for (let x = 10; x < 256; x += 29) {
        ctx.fillStyle = (x + y) % 3 ? "#607d86" : "#d9c997"; ctx.fillRect(x, y, 15, 18);
        ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(x + 2, y + 2, 5, 14);
        ctx.fillStyle = "rgba(35,45,45,.28)"; ctx.fillRect(x - 2, y + 19, 20, 2);
      }
      ctx.fillStyle = "rgba(70,75,72,.18)"; ctx.fillRect(0, y + 23, 256, 3);
    }
    this.cityTexture = new THREE.CanvasTexture(canvas); this.cityTexture.colorSpace = THREE.SRGBColorSpace; this.cityTexture.wrapS = this.cityTexture.wrapT = THREE.RepeatWrapping;
    return this.cityTexture;
  }

  private makeFlagTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#f7f2df"; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = "#ed641f"; ctx.beginPath(); ctx.moveTo(0, 128); ctx.lineTo(128, 0); ctx.lineTo(128, 128); ctx.closePath(); ctx.fill();
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }

  private makeTextPlane(text: string, w: number, h: number, background: string, foreground: string): THREE.Mesh {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = background; ctx.fillRect(0, 0, 256, 128); ctx.fillStyle = foreground; ctx.font = "bold 72px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 128, 68);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  }

  private buildStartFinish(): void {
    this.addGate(this.course.start.x, this.course.start.z, "СТАРТ", 0xd58b34);
    this.addGate(this.course.finish.x, this.course.finish.z, "ФИНИШ", COLORS.orange);
  }

  private addGate(x: number, z: number, text: string, color: number): void {
    const y = this.heightAt(x, z), material = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.6, 0.13), material); post.position.set(x + side * 1.35, y + 1.3, z); this.group.add(post);
      for (let n = 1; n <= 5; n++) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.85, 1.7), new THREE.MeshStandardMaterial({ color: 0xe7e0ca, roughness: 0.9 }));
        rail.position.set(x + side * 2.25, this.heightAt(x, z + n * 1.55) + 0.48, z + n * 1.55); this.group.add(rail);
      }
    }
    const banner = this.makeTextPlane(text, 2.8, 0.48, "#ed6b27", "#ffffff"); banner.position.set(x, y + 2.35, z); this.group.add(banner);
    const spectators = 12, bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.18, 0.65, 3, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), spectators);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc89572, roughness: 1 }), spectators);
    const dummy = new THREE.Object3D(), palette = [0xcc6547, 0x47728a, 0xd6b34f, 0x586c58, 0x8b5c83, 0xd8d5c8];
    for (let i = 0; i < spectators; i++) {
      const side = i % 2 ? -1 : 1, zz = z + 1.5 + Math.floor(i / 2) * 1.25, xx = x + side * (3.1 + (i % 3) * 0.25), yy = this.heightAt(xx, zz);
      dummy.position.set(xx, yy + 0.73, zz); dummy.rotation.set(0, side * Math.PI / 2, 0); dummy.scale.setScalar(0.9 + (i % 4) * 0.04); dummy.updateMatrix(); bodies.setMatrixAt(i, dummy.matrix); bodies.setColorAt(i, new THREE.Color(palette[i % palette.length]));
      dummy.position.y = yy + 1.46; dummy.scale.setScalar(1); dummy.updateMatrix(); heads.setMatrixAt(i, dummy.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true; if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    this.group.add(bodies, heads);
  }

  setCurrentControl(index: number): void {
    const guided = this.course.difficulty === "M12";
    for (let i = 0; i < this.halos.length; i++) {
      this.halos[i].visible = guided && i === index;
      this.beacons[i].visible = Boolean(this.biome.tutorial) && guided && i === index;
    }
  }

  update(dt: number, player?: Vec2): void {
    this.elapsed += dt; this.traffic?.update(dt, player);
    if (this.waterMaterial) this.waterMaterial.opacity = 0.84 + Math.sin(this.elapsed * 0.8) * 0.025;
    for (let i = 0; i < this.halos.length; i++) {
      if (!this.halos[i].visible) continue;
      const scale = 1 + Math.sin(this.elapsed * 3) * 0.08; this.halos[i].scale.setScalar(scale);
    }
    for (const bird of this.birds) {
      const angle = this.elapsed * bird.userData.speed + bird.userData.phase, x = bird.userData.centerX + Math.cos(angle) * bird.userData.radius, z = bird.userData.centerZ + Math.sin(angle) * bird.userData.radius;
      bird.position.set(x, this.heightAt(x, z) + 13 + Math.sin(angle * 2.3) * 1.5, z); bird.rotation.y = -angle;
      bird.children[0].rotation.z = Math.sin(this.elapsed * 5 + bird.userData.phase) * 0.28; bird.children[1].rotation.z = -bird.children[0].rotation.z;
    }
  }

  surfaceAt(x: number, z: number): Surface {
    for (const water of this.waters) if (Math.hypot(x - water.x, z - water.z) < water.r) return "water";
    for (const stream of this.streams) if (this.nearPath(stream, x, z, 0.68)) return "water";
    for (const marsh of this.marshes) if (Math.hypot(x - marsh.x, z - marsh.z) < marsh.r) return "marsh";
    if (this.isNearTrail(x, z, this.biome.urban ? 3 : this.biome.mine ? 2.8 : 0.72)) return this.biome.urban ? "road" : "trail";
    if (this.biome.urban && this.isNearCityPath(x, z, 1.25)) return "road";
    return this.vegetation.kindAt(x, z) ?? "grass";
  }

  private nearPath(path: Vec2[], x: number, z: number, distance: number): boolean {
    for (let i = 0; i < path.length - 1; i++) if (distanceToSegment(x, z, path[i].x, path[i].z, path[i + 1].x, path[i + 1].z) < distance) return true;
    return false;
  }

  private isNearTrail(x: number, z: number, distance: number): boolean {
    return this.trails.some((trail) => this.nearPath(trail, x, z, distance));
  }

  private isNearCityPath(x: number, z: number, distance: number): boolean {
    return this.cityPaths.some((path) => this.nearPath(path, x, z, distance));
  }

  private isNearRoad(x: number, z: number, distance: number): boolean {
    if (!this.biome.urban) return false;
    return this.trails.slice(0, 6).some((trail) => this.nearPath(trail, x, z, distance));
  }

  private isNearControl(x: number, z: number, distance: number): boolean {
    if (Math.hypot(x - this.course.start.x, z - this.course.start.z) < distance + 2) return true;
    if (Math.hypot(x - this.course.finish.x, z - this.course.finish.z) < distance + 2) return true;
    return this.controls.some((cp) => Math.hypot(x - cp.x, z - cp.z) < distance);
  }

  private inWater(x: number, z: number, margin: number): boolean {
    return this.waters.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + margin);
  }

  private isObstacle(x: number, z: number, margin: number): boolean {
    return this.obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + margin);
  }

  private rebuildObstacleGrid(): void {
    this.obstacleGrid.clear();
    for (const obstacle of this.obstacles) {
      const key = `${Math.floor(obstacle.x / CELL)},${Math.floor(obstacle.z / CELL)}`, cell = this.obstacleGrid.get(key);
      if (cell) cell.push(obstacle); else this.obstacleGrid.set(key, [obstacle]);
    }
  }

  resolveCollision(position: Vec2, radius = 0.38): void {
    const cx = Math.floor(position.x / CELL), cz = Math.floor(position.z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const cell = this.obstacleGrid.get(`${cx + dx},${cz + dz}`); if (!cell) continue;
      for (const obstacle of cell) {
        const ox = position.x - obstacle.x, oz = position.z - obstacle.z, minDistance = radius + obstacle.r, d2 = ox * ox + oz * oz;
        if (d2 >= minDistance * minDistance) continue;
        const d = Math.sqrt(d2) || 0.001; position.x = obstacle.x + ox / d * minDistance; position.z = obstacle.z + oz / d * minDistance;
      }
    }
    position.x = THREE.MathUtils.clamp(position.x, -HALF + 4, HALF - 4); position.z = THREE.MathUtils.clamp(position.z, -HALF + 4, HALF - 4);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) { if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose(); material.dispose(); }
    });
  }
}
