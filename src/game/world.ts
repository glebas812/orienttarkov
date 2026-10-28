import * as THREE from "three";
import { GAME_CONFIG, COLORS } from "./config";
import { distanceToSegment, mulberry32, valueNoise } from "./random";
import type { BiomeDef, Course, Vec2, WorldControl } from "./types";
import { VegetationSystem, type VegetationKind } from "./vegetation";
import { TrafficSystem } from "./traffic";
import { generateMineLayout, mineLineOpen, type MineLayout, type MineWall } from "./mine";

export type Surface = "trail" | "microtrail" | "grass" | "marsh" | "water" | "road" | VegetationKind;
export type TrailKind = "clearing" | "trail" | "micro";
interface Obstacle { x: number; z: number; r: number }
interface RouteHazard { x: number; z: number; r: number }
export interface WaterBody { x: number; z: number; r: number; level: number }
export interface MarshBody { x: number; z: number; r: number; level: number }
export interface BuildingFootprint { x: number; z: number; w: number; d: number; rotation: number }
export interface TreePoint { x: number; z: number; s: number; birch: boolean }
export interface Depression { x: number; z: number; r: number; depth: number }

const CELL = 12;
const TREE_CELL = 10;

export class World {
  readonly group = new THREE.Group();
  readonly controls: WorldControl[];
  readonly trails: Vec2[][];
  readonly trailKinds: TrailKind[];
  readonly size: number;
  readonly cityPaths: Vec2[][] = [];
  readonly streams: Vec2[][];
  readonly waters: WaterBody[];
  readonly marshes: MarshBody[];
  readonly buildings: BuildingFootprint[] = [];
  readonly rocks: Array<{ x: number; z: number; s: number }> = [];
  readonly trees: TreePoint[] = [];
  readonly depressions: Depression[] = [];
  private readonly fountains: Vec2[] = [];
  readonly obstacles: Obstacle[] = [];
  readonly vegetation: VegetationSystem;
  readonly mineLayout?: MineLayout;
  readonly traffic?: TrafficSystem;
  readonly monster = new THREE.Group();
  private readonly obstacleGrid = new Map<string, Obstacle[]>();
  private readonly treeGrid = new Map<string, TreePoint[]>();
  private readonly mineWallGrid = new Map<string, MineWall[]>();
  private readonly controlGroups: THREE.Group[] = [];
  private readonly halos: THREE.Mesh[] = [];
  private readonly beacons: THREE.Mesh[] = [];
  private readonly birds: THREE.Group[] = [];
  private waterMaterial?: THREE.MeshStandardMaterial;
  private cityTexture?: THREE.CanvasTexture;
  private elapsed = 0;
  private monsterTime = 2.5;
  private monsterActive = false;
  private monsterPath: Vec2[] = [];
  private monsterPathTimer = 0;
  private monsterRetreat = 0;
  private monsterContactCooldown = 0;

  constructor(private scene: THREE.Scene, readonly biome: BiomeDef, readonly course: Course) {
    this.controls = course.controls.map((cp, index) => ({ ...cp, index }));
    this.size = biome.worldSize ?? GAME_CONFIG.WORLD_SIZE;
    if (biome.mine) this.mineLayout = generateMineLayout(biome.seed);
    this.waters = biome.urban || biome.mine ? [] : [this.makeWater(82, 42, 27), this.makeWater(-94, -84, 17)];
    this.marshes = biome.urban || biome.mine ? [] : [
      this.makeMarsh(42, -28, 28 + biome.marshiness * 12),
      this.makeMarsh(-78, 5, 13 + biome.marshiness * 15),
      this.makeMarsh(95, 105, 10 + biome.marshiness * 8),
    ];
    this.streams = biome.urban || biome.mine ? [] : this.makeStreams();
    this.trails = this.makeTrails();
    this.trailKinds = this.trails.map((_, index) => this.trailKind(index));
    scene.add(this.group);
    this.prepareDepressions();
    this.buildTerrain();
    this.buildWaterAndMarsh();
    this.buildTrails();
    if (biome.urban) this.buildCity();
    if (biome.id === "recreation") this.buildRecreation();
    if (biome.mine) this.buildMine();
    this.traffic = biome.urban ? new TrafficSystem(this.group, (x, z) => this.heightAt(x, z)) : undefined;
    this.buildFeatures();
    if (!biome.urban && !biome.mine) this.buildFallenOak();
    this.vegetation = new VegetationSystem(this.group, biome, course, {
      heightAt: (x, z) => this.heightAt(x, z),
      isNearTrail: (x, z, d) => this.isNearMajorTrail(x, z, d),
      isNearAnyTrail: (x, z, d) => this.isNearTrail(x, z, d),
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
    for (const pit of this.depressions) {
      const d2 = (x - pit.x) ** 2 + (z - pit.z) ** 2;
      if (d2 < pit.r * pit.r * 5) h -= Math.exp(-d2 / (pit.r * pit.r * 0.42)) * pit.depth;
    }
    h += Math.exp(-((x + 55) ** 2 / 180 + (z - 4) ** 2 / 1700)) * Math.min(3.2, a * 0.18);
    if (this.biome.id === "north-ural") h += Math.max(0, (x + z + 80) / 170) * 4;
    if (this.biome.id === "slyudorudnik" || this.biome.id === "big-slyudorudnik") {
      h += (x + this.size / 2) / this.size * (this.biome.id === "big-slyudorudnik" ? 14 : 9) + Math.max(0, Math.sin((x + z) / 27)) * 2.1;
      h -= Math.exp(-((x - 38) ** 2 / 170 + (z + 4) ** 2 / 2100)) * (this.biome.id === "big-slyudorudnik" ? 8 : 5.5);
    }
    if (this.biome.id === "big-slyudorudnik") {
      for (let ridge = 0; ridge < 6; ridge++) {
        const line = -205 + ridge * 78 + Math.sin(x / 43 + ridge * 0.8) * 15;
        h += Math.exp(-((z - line) ** 2) / 190) * (7.5 + (ridge % 3) * 2.2);
      }
      h -= Math.exp(-((x + 62) ** 2 / 95 + (z + 15) ** 2 / 12500)) * 9.5;
      h -= Math.exp(-((x - 105) ** 2 / 130 + (z - 32) ** 2 / 8200)) * 7.5;
    }
    return h;
  }

  heightAt(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    for (const water of this.waters ?? []) {
      const d = Math.hypot(x - water.x, z - water.z);
      if (d < water.r * 1.65) {
        const t = Math.min(1, Math.max(0, (water.r * 1.65 - d) / (water.r * 0.85)));
        h = THREE.MathUtils.lerp(h, water.level - 1.65, Math.min(1, t * 1.18) ** 2 * (3 - 2 * Math.min(1, t * 1.18)));
      }
    }
    for (const marsh of this.marshes ?? []) {
      const d = Math.hypot(x - marsh.x, z - marsh.z);
      if (d < marsh.r * 1.35) {
        const t = Math.min(1, Math.max(0, (marsh.r * 1.35 - d) / (marsh.r * 0.65)));
        h = THREE.MathUtils.lerp(h, marsh.level - 0.48, Math.min(1, t * 1.12) * 0.92);
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

  private trailKind(index: number): TrailKind {
    if (this.biome.urban || this.biome.tutorial && index === 0) return "trail";
    if (index === 0 || index === 4 || index === 9) return "clearing";
    if (index < 4 || index === 10 || index === 11) return "trail";
    return "micro";
  }

  private trailWidth(index: number): number {
    if (this.biome.urban) return 5.9;
    const kind = this.trailKind(index);
    return kind === "clearing" ? 5 : kind === "trail" ? 1.7 : 0.55;
  }

  private makeTrails(): Vec2[][] {
    if (this.biome.mine) return [];
    if (this.biome.urban) return [
      [{ x: -155, z: -90 }, { x: 155, z: -90 }], [{ x: -155, z: 0 }, { x: 155, z: 0 }], [{ x: -155, z: 90 }, { x: 155, z: 90 }],
      [{ x: -90, z: -155 }, { x: -90, z: 155 }], [{ x: 0, z: -155 }, { x: 0, z: 155 }], [{ x: 90, z: -155 }, { x: 90, z: 155 }],
    ];
    const tutorial = [
      [{ x: -78, z: 70 }, { x: -35, z: 40 }, { x: 0, z: 12 }, { x: 37, z: -17 }, { x: 72, z: -62 }],
      [{ x: -45, z: -50 }, { x: -35, z: 40 }, { x: 25, z: 65 }],
    ];
    const routes = this.biome.tutorial ? tutorial : [
      [{ x: -155, z: 126 }, { x: -132, z: 112 }, { x: -91, z: 73 }, { x: -41, z: 46 }, { x: 1, z: 31 }, { x: 52, z: 11 }, { x: 116, z: -59 }, { x: 150, z: -117 }],
      [{ x: -143, z: -112 }, { x: -91, z: -73 }, { x: -26, z: -76 }, { x: -41, z: 46 }, { x: -31, z: 61 }, { x: 25, z: 86 }, { x: 86, z: 143 }],
      [{ x: -145, z: 15 }, { x: -86, z: 105 }, { x: -31, z: 61 }, { x: 20, z: 56 }, { x: 76, z: 37 }, { x: 135, z: 36 }],
      [{ x: -20, z: -145 }, { x: -20, z: -116 }, { x: 31, z: -29 }, { x: 79, z: -109 }, { x: 126, z: -116 }],
      [{ x: -118, z: 35 }, { x: -104, z: 26 }, { x: -92, z: 30 }, { x: -81, z: 17 }],
      [{ x: 12, z: 121 }, { x: 22, z: 105 }, { x: 16, z: 91 }, { x: 25, z: 86 }],
      [{ x: 103, z: 74 }, { x: 111, z: 57 }, { x: 102, z: 43 }, { x: 112, z: 28 }],
      [{ x: -71, z: -23 }, { x: -57, z: -31 }, { x: -61, z: -41 }, { x: -47, z: -55 }],
      [{ x: 47, z: -91 }, { x: 56, z: -79 }, { x: 71, z: -83 }, { x: 79, z: -69 }],
      [{ x: -150, z: -135 }, { x: -105, z: -100 }, { x: -50, z: -50 }, { x: 0, z: 0 }, { x: 55, z: 55 }, { x: 115, z: 120 }],
      [{ x: -150, z: 70 }, { x: -90, z: 30 }, { x: -20, z: -10 }, { x: 50, z: -60 }, { x: 140, z: -95 }],
      [{ x: -120, z: 145 }, { x: -60, z: 110 }, { x: 10, z: 100 }, { x: 80, z: 130 }, { x: 145, z: 110 }],
      [{ x: -135, z: -45 }, { x: -105, z: -20 }, { x: -90, z: 15 }, { x: -55, z: 35 }],
      [{ x: -65, z: 145 }, { x: -50, z: 120 }, { x: -15, z: 105 }, { x: 5, z: 75 }],
      [{ x: 35, z: 145 }, { x: 55, z: 120 }, { x: 85, z: 100 }, { x: 125, z: 80 }],
      [{ x: 145, z: 15 }, { x: 120, z: -5 }, { x: 95, z: -15 }, { x: 65, z: -55 }],
      [{ x: 25, z: -140 }, { x: 10, z: -105 }, { x: -10, z: -80 }, { x: -45, z: -65 }],
      [{ x: -145, z: 95 }, { x: -120, z: 70 }, { x: -115, z: 45 }, { x: -90, z: 20 }],
    ];
    const scale = this.biome.id === "big-slyudorudnik" ? 1.35 : 1;
    return routes.map((route, index) => this.keepRouteDry(route.map((p) => ({ x: p.x * scale, z: p.z * scale })), this.trailWidth(index) * 0.5 + 0.8));
  }

  private routeHazards(clearance: number): RouteHazard[] {
    const hazards: RouteHazard[] = [
      ...this.waters.map((w) => ({ x: w.x, z: w.z, r: w.r + clearance })),
      ...this.marshes.map((m) => ({ x: m.x, z: m.z, r: m.r + clearance })),
    ];
    for (const stream of this.streams) for (let i = 0; i < stream.length - 1; i++) {
      const a = stream[i], b = stream[i + 1], length = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(1, Math.ceil(length / 5));
      for (let j = 0; j <= steps; j++) hazards.push({ x: THREE.MathUtils.lerp(a.x, b.x, j / steps), z: THREE.MathUtils.lerp(a.z, b.z, j / steps), r: 1.6 + clearance });
    }
    return hazards;
  }

  private dryPoint(point: Vec2, hazards: RouteHazard[]): Vec2 {
    let { x, z } = point;
    const limit = this.size / 2 - 5;
    for (let pass = 0; pass < 18; pass++) {
      let moved = false;
      for (const hazard of hazards) {
        const dx = x - hazard.x, dz = z - hazard.z, d = Math.hypot(dx, dz), minimum = hazard.r + 0.45;
        if (d >= minimum) continue;
        const nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0;
        x = hazard.x + nx * minimum; z = hazard.z + nz * minimum; moved = true;
      }
      x = THREE.MathUtils.clamp(x, -limit, limit); z = THREE.MathUtils.clamp(z, -limit, limit);
      if (!moved) break;
    }
    return { x, z };
  }

  private routePointDry(point: Vec2, clearance: number): boolean {
    const limit = this.size / 2 - 2;
    if (Math.abs(point.x) > limit || Math.abs(point.z) > limit) return false;
    if (this.waters.some((water) => Math.hypot(point.x - water.x, point.z - water.z) < water.r + clearance)) return false;
    if (this.marshes.some((marsh) => Math.hypot(point.x - marsh.x, point.z - marsh.z) < marsh.r + clearance)) return false;
    return !this.streams.some((stream) => this.nearPath(stream, point.x, point.z, 0.68 + clearance));
  }

  private routeEdgeDry(a: Vec2, b: Vec2, clearance: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.7));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.routePointDry({ x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t) }, clearance)) return false;
    }
    return true;
  }

  private drySegment(a: Vec2, b: Vec2, clearance: number): Vec2[] {
    if (this.routeEdgeDry(a, b, clearance)) return [a, b];
    const step = 2.5, margin = this.size, limit = this.size / 2 - 2;
    const minX = Math.max(-limit, Math.min(a.x, b.x) - margin), maxX = Math.min(limit, Math.max(a.x, b.x) + margin);
    const minZ = Math.max(-limit, Math.min(a.z, b.z) - margin), maxZ = Math.min(limit, Math.max(a.z, b.z) + margin);
    const nx = Math.max(1, Math.ceil((maxX - minX) / step)), nz = Math.max(1, Math.ceil((maxZ - minZ) / step)), stride = nx + 1;
    const points: Vec2[] = new Array(stride * (nz + 1));
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) points[ix + iz * stride] = { x: minX + ix * step, z: minZ + iz * step };
    const dry = new Map<number, boolean>();
    const isDry = (index: number) => {
      let value = dry.get(index);
      if (value === undefined) { value = this.routePointDry(points[index], clearance); dry.set(index, value); }
      return value;
    };
    const nearestNode = (target: Vec2) => {
      let best = -1, distance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length; i++) {
        const d = (points[i].x - target.x) ** 2 + (points[i].z - target.z) ** 2;
        if (d >= distance || !isDry(i) || !this.routeEdgeDry(target, points[i], clearance)) continue;
        best = i; distance = d;
      }
      return best;
    };
    const start = nearestNode(a), finish = nearestNode(b);
    if (start < 0 || finish < 0) return [a, b];
    const heap: Array<{ index: number; score: number }> = [];
    const push = (item: { index: number; score: number }) => {
      let at = heap.length; heap.push(item);
      while (at > 0) { const parent = (at - 1) >> 1; if (heap[parent].score <= item.score) break; heap[at] = heap[parent]; at = parent; heap[at] = item; }
    };
    const pop = () => {
      const first = heap[0], last = heap.pop()!;
      if (heap.length) {
        let at = 0;
        while (true) {
          let child = at * 2 + 1;
          if (child >= heap.length) break;
          if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
          if (heap[child].score >= last.score) break;
          heap[at] = heap[child]; at = child;
        }
        heap[at] = last;
      }
      return first;
    };
    const costs = new Map<number, number>([[start, 0]]), parents = new Map<number, number>(), closed = new Set<number>();
    const heuristic = (index: number) => Math.hypot(points[index].x - points[finish].x, points[index].z - points[finish].z);
    push({ index: start, score: heuristic(start) });
    const directions = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]] as const;
    while (heap.length && !closed.has(finish)) {
      const current = pop().index;
      if (closed.has(current)) continue;
      closed.add(current);
      if (current === finish) break;
      const ix = current % stride, iz = Math.floor(current / stride), currentCost = costs.get(current)!;
      for (const [dx, dz] of directions) {
        const x = ix + dx, z = iz + dz;
        if (x < 0 || x > nx || z < 0 || z > nz) continue;
        const next = x + z * stride;
        if (closed.has(next) || !isDry(next) || !this.routeEdgeDry(points[current], points[next], clearance)) continue;
        const cost = currentCost + Math.hypot(points[next].x - points[current].x, points[next].z - points[current].z);
        if (cost >= (costs.get(next) ?? Number.POSITIVE_INFINITY)) continue;
        costs.set(next, cost); parents.set(next, current); push({ index: next, score: cost + heuristic(next) });
      }
    }
    if (!closed.has(finish)) return [a, b];
    const reversed: Vec2[] = [b, points[finish]];
    for (let at = finish; at !== start;) { at = parents.get(at)!; reversed.push(points[at]); }
    reversed.push(a);
    const raw = reversed.reverse().filter((point, index, array) => index === 0 || Math.hypot(point.x - array[index - 1].x, point.z - array[index - 1].z) > 0.05);
    const simplified: Vec2[] = [a];
    let anchor = 0;
    while (anchor < raw.length - 1) {
      let next = anchor + 1;
      for (let candidate = raw.length - 1; candidate > anchor + 1; candidate--) {
        if (this.routeEdgeDry(raw[anchor], raw[candidate], clearance)) { next = candidate; break; }
      }
      simplified.push(raw[next]); anchor = next;
    }
    return simplified;
  }

  private keepRouteDry(route: Vec2[], clearance: number): Vec2[] {
    const hazards = this.routeHazards(clearance), points = route.map((point) => {
      const shifted = this.dryPoint(point, hazards);
      if (this.routePointDry(shifted, clearance)) return shifted;
      for (let radius = 1; radius <= 80; radius += 1) for (let i = 0; i < 40; i++) {
        const angle = i * Math.PI * 2 / 40, candidate = { x: shifted.x + Math.cos(angle) * radius, z: shifted.z + Math.sin(angle) * radius };
        if (this.routePointDry(candidate, clearance)) return candidate;
      }
      return shifted;
    });
    const result: Vec2[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) result.push(...this.drySegment(points[i], points[i + 1], clearance).slice(1));
    return result.filter((point, index) => index === 0 || Math.hypot(point.x - result[index - 1].x, point.z - result[index - 1].z) > 0.05);
  }

  private buildTerrain(): void {
    const geometry = new THREE.PlaneGeometry(this.size, this.size, this.biome.mine ? 24 : this.biome.id === "big-slyudorudnik" ? 176 : 128, this.biome.mine ? 24 : this.biome.id === "big-slyudorudnik" ? 176 : 128);
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
        const kind = this.trailKinds[i], width = this.trailWidth(i), lift = (this.biome.id === "big-slyudorudnik" ? 0.18 : 0.14) + i * 0.015;
        if (kind === "clearing") this.group.add(this.ribbon(trail, width + 0.8, 0x6f7651, lift - 0.035));
        const mesh = this.ribbon(trail, width, kind === "clearing" ? 0xa2936c : kind === "trail" ? 0x918263 : 0x756d52, lift);
        mesh.receiveShadow = false; this.group.add(mesh);
      }
    }
  }

  private ribbon(points: Vec2[], width: number, color: number, lift = 0.075): THREE.Mesh {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    const total = lengths[lengths.length - 1] || 1;
    const sample = (t: number) => {
      const distance = THREE.MathUtils.clamp(t, 0, 1) * total;
      let index = 0;
      while (index < lengths.length - 2 && lengths[index + 1] < distance) index++;
      const a = points[index], b = points[index + 1], length = lengths[index + 1] - lengths[index] || 1;
      const local = THREE.MathUtils.clamp((distance - lengths[index]) / length, 0, 1);
      return { x: THREE.MathUtils.lerp(a.x, b.x, local), z: THREE.MathUtils.lerp(a.z, b.z, local), tx: (b.x - a.x) / length, tz: (b.z - a.z) / length };
    };
    const segments = Math.max(48, Math.ceil(total * 2));
    const positions: number[] = [], indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const p = sample(i / segments);
      const nx = -p.tz, nz = p.tx;
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
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  }

  private isUrbanPark(x: number, z: number): boolean {
    if (this.biome.id === "city-2") return (Math.abs(x) > 12 && Math.abs(x) < 82 && Math.abs(z) > 12 && Math.abs(z) < 82) || (x > -82 && x < 82 && z > 98 && z < 142);
    return (x > -78 && x < -12 && z > 12 && z < 78) || (x > 12 && x < 78 && z > -78 && z < -12) || (x > -78 && x < -12 && z > -78 && z < -12);
  }

  private buildCity(): void {
    const rng = mulberry32(this.biome.seed + 400);
    type CityLot = { x: number; z: number; w: number; d: number; h: number; rotation: number; old: boolean; color: THREE.Color };
    const lots: CityLot[] = [];
    for (let x = -144; x <= 144; x += 18) for (let z = -144; z <= 144; z += 18) {
      if (this.isUrbanPark(x, z) || this.isNearRoad(x, z, 11) || this.isNearControl(x, z, 9) || rng() < (this.biome.id === "city-2" ? 0.035 : 0.08)) continue;
      const old = rng() < 0.38, w = 12.5 + rng() * 4.2, d = 6.8 + rng() * 2.4, h = old ? 8 + rng() * 8 : 13 + rng() * 22;
      const rotation = rng() < 0.5 ? 0 : Math.PI / 2;
      const color = old ? new THREE.Color().setHSL(0.075 + rng() * 0.055, 0.18 + rng() * 0.12, 0.52 + rng() * 0.13) : new THREE.Color().setHSL(0.09 + rng() * 0.09, 0.06 + rng() * 0.09, 0.56 + rng() * 0.17);
      lots.push({ x: x + (rng() - 0.5) * 0.35, z: z + (rng() - 0.5) * 0.35, w, d, h, rotation, old, color });
    }
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.getCityTexture(), roughness: 0.88 });
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, lots.length);
    const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x515a5b, roughness: 0.9 }), lots.length);
    const roofTiers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x6a5c50, roughness: 0.92 }), lots.length);
    const entrances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x354443, roughness: 0.65 }), lots.length);
    const bands = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd2c3a7, roughness: 0.94 }), lots.length * 4);
    const balconies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8b9692, roughness: 0.8 }), lots.length * 6);
    const dummy = new THREE.Object3D();
    const setPart = (mesh: THREE.InstancedMesh, index: number, lot: CityLot, lx: number, y: number, lz: number, sx: number, sy: number, sz: number) => {
      const cos = Math.cos(lot.rotation), sin = Math.sin(lot.rotation);
      dummy.position.set(lot.x + lx * cos + lz * sin, y, lot.z - lx * sin + lz * cos);
      dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, lot.rotation, 0); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
    };
    let bandIndex = 0, balconyIndex = 0, tierIndex = 0;
    lots.forEach((lot, i) => {
      const y = this.heightAt(lot.x, lot.z);
      setPart(blocks, i, lot, 0, y + lot.h / 2, 0, lot.w, lot.h, lot.d); blocks.setColorAt(i, lot.color);
      setPart(roofs, i, lot, 0, y + lot.h + 0.18, 0, lot.w + 0.45, 0.36, lot.d + 0.45);
      setPart(entrances, i, lot, 0, y + 1.25, lot.d / 2 + 0.38, 2.1, 2.5, 0.76);
      if (lot.old) {
        setPart(roofTiers, tierIndex++, lot, 0, y + lot.h + 0.75, 0, lot.w * 0.82, 0.85, lot.d * 0.76);
        for (const floor of [0.3, 3.2, 6.35, lot.h - 0.45]) if (floor < lot.h) setPart(bands, bandIndex++, lot, 0, y + floor, lot.d / 2 + 0.11, lot.w + 0.22, floor < 1 ? 0.6 : 0.18, 0.2);
      } else {
        for (let floor = 4; floor < lot.h - 1 && balconyIndex + 2 <= lots.length * 6; floor += 4.1) for (const side of [-1, 1]) setPart(balconies, balconyIndex++, lot, side * lot.w * 0.24, y + floor, lot.d / 2 + 0.48, 2.35, 0.16, 0.92);
      }
      this.buildings.push({ x: lot.x, z: lot.z, w: lot.w, d: lot.d, rotation: lot.rotation });
      this.addFootprintObstacles(lot);
    });
    bands.count = bandIndex; balconies.count = balconyIndex; roofTiers.count = tierIndex;
    for (const mesh of [blocks, roofs, roofTiers, entrances, bands, balconies]) mesh.instanceMatrix.needsUpdate = true;
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
    blocks.castShadow = true; blocks.receiveShadow = true;
    this.group.add(blocks, roofs, roofTiers, entrances, bands, balconies);
    this.buildCityPaths();
    this.buildStreetProps(rng);
    this.buildPlayground(-45, -45);
    this.buildPlayground(45, -45);
    this.buildSquare(45, 45);
    if (this.biome.id === "city-2") {
      this.buildSquare(-45, 45);
      this.buildSquare(45, -45);
      for (const [x, z] of [[-66,-22],[66,25],[70,68],[-58,-24],[-63,-66]] as const) this.addBench(x, z, 0);
    }
  }

  private buildCityPaths(): void {
    this.cityPaths.push(
      [{ x: -76, z: 18 }, { x: -45, z: 45 }, { x: -14, z: 76 }],
      [{ x: -76, z: 76 }, { x: -45, z: 45 }, { x: -14, z: 14 }],
      [{ x: 14, z: -14 }, { x: 45, z: -45 }, { x: 76, z: -76 }],
      [{ x: -76, z: -14 }, { x: -45, z: -45 }, { x: -14, z: -76 }],
      [{ x: 14, z: 45 }, { x: 76, z: 45 }],
    );
    if (this.biome.id === "city-2") this.cityPaths.push(
      [{ x: -76, z: -76 }, { x: -45, z: -45 }, { x: -14, z: -14 }],
      [{ x: -76, z: -45 }, { x: -14, z: -45 }],
      [{ x: 14, z: 45 }, { x: 45, z: 45 }, { x: 76, z: 76 }],
      [{ x: 45, z: 14 }, { x: 45, z: 76 }],
      [{ x: -76, z: 45 }, { x: -45, z: 45 }, { x: -14, z: 76 }],
      [{ x: -70, z: 105 }, { x: 0, z: 130 }, { x: 70, z: 105 }],
      [{ x: -83.5, z: 90 }, { x: -70, z: 105 }], [{ x: 70, z: 105 }, { x: 83.5, z: 90 }], [{ x: 0, z: 130 }, { x: 0, z: 96 }],
    );
    const fountainCenters = this.biome.id === "city-2" ? [{ x: 45, z: 45 }, { x: -45, z: 45 }, { x: 45, z: -45 }] : [{ x: 45, z: 45 }];
    const originalPaths = this.cityPaths.splice(0).map((path) => path.map((point, index) => {
      if (index !== 0 && index !== path.length - 1) return point;
      let { x, z } = point;
      if (Math.abs(Math.abs(x) - 14) < 0.1) x = Math.sign(x) * 5.8;
      if (Math.abs(Math.abs(z) - 14) < 0.1) z = Math.sign(z) * 5.8;
      if (Math.abs(Math.abs(x) - 76) < 0.1) x = Math.sign(x) * 83.5;
      if (Math.abs(Math.abs(z) - 76) < 0.1) z = Math.sign(z) * 83.5;
      return { x, z };
    }));
    for (const path of originalPaths) {
      let run: Vec2[] = [];
      const flush = () => { if (run.length > 1) this.cityPaths.push(run); run = []; };
      for (let segment = 0; segment < path.length - 1; segment++) {
        const a = path[segment], b = path[segment + 1], steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.25));
        for (let i = segment ? 1 : 0; i <= steps; i++) {
          const t = i / steps, point = { x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t) };
          if (fountainCenters.some((f) => Math.hypot(point.x - f.x, point.z - f.z) < 4.6)) flush(); else run.push(point);
        }
      }
      flush();
    }
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
    this.buildCrossingSigns();

    const lampPositions: Vec2[] = [];
    for (const lane of [-90, 0, 90]) for (let v = -132; v <= 132; v += 33) {
      if ([-90, 0, 90].some((cross) => Math.abs(v - cross) < 8)) continue;
      lampPositions.push({ x: lane + 7.4, z: v }, { x: v, z: lane - 7.4 });
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
      const x = horizontal ? v : lane + (i % 4 < 2 ? 8.1 : -8.1), z = horizontal ? lane + (i % 4 < 2 ? 8.1 : -8.1) : v;
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

  private buildCrossingSigns(): void {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#2369a0"; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#f4f1df"; ctx.lineWidth = 7; ctx.strokeRect(5, 5, 118, 118);
    ctx.fillStyle = "#f4f1df"; ctx.beginPath(); ctx.moveTo(64, 17); ctx.lineTo(111, 103); ctx.lineTo(17, 103); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#202a2c"; ctx.beginPath(); ctx.arc(64, 43, 7, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = "#202a2c"; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(63, 52); ctx.lineTo(58, 73); ctx.lineTo(45, 91); ctx.moveTo(59, 70); ctx.lineTo(75, 88); ctx.moveTo(59, 58); ctx.lineTo(45, 66); ctx.moveTo(61, 58); ctx.lineTo(77, 63); ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const plateMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x465150, roughness: 0.75 });
    for (const x of [-90, 0, 90]) for (const z of [-90, 0, 90]) for (const side of [-1, 1]) {
      const sx = x + 7.8, sz = z + side * 7.8, y = this.heightAt(sx, sz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.5, 6), poleMaterial); pole.position.set(sx, y + 1.25, sz); this.group.add(pole);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82), plateMaterial); plate.position.set(sx, y + 2.35, sz); plate.rotation.y = side > 0 ? 0 : Math.PI; this.group.add(plate);
    }
  }

  private addBench(x: number, z: number, rotation: number): void {
    if (this.isNearRoad(x, z, 6.8)) return;
    if (this.isNearCityPath(x, z, 1.8)) z += 2.4;
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
    this.addFountain(x, z);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; this.addBench(x + Math.cos(a) * 12, z + Math.sin(a) * 12, -a); }
  }

  private addFountain(x: number, z: number): void {
    if (this.fountains.some((f) => Math.hypot(f.x - x, f.z - z) < 1)) return;
    this.fountains.push({ x, z });
    const y = this.heightAt(x, z), stone = new THREE.MeshStandardMaterial({ color: 0x9a9d94, roughness: 0.72 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.5, 0.62, 32), stone); basin.position.set(x, y + 0.31, z); basin.castShadow = true; this.group.add(basin);
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.82, 32), new THREE.MeshStandardMaterial({ color: 0x65b7c4, roughness: 0.2, metalness: 0.18 })); water.rotation.x = -Math.PI / 2; water.position.set(x, y + 0.65, z); this.group.add(water);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.65, 1.8, 16), stone); pedestal.position.set(x, y + 1.45, z); this.group.add(pedestal);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.45, 0.35, 24), stone); bowl.position.set(x, y + 2.25, z); this.group.add(bowl);
    const jetMaterial = new THREE.MeshBasicMaterial({ color: 0xa8e2e8, transparent: true, opacity: 0.72 });
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, jet = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 1.55, 5), jetMaterial);
      jet.position.set(x + Math.cos(angle) * 0.95, y + 1.65, z + Math.sin(angle) * 0.95); jet.rotation.z = Math.cos(angle) * 0.34; jet.rotation.x = Math.sin(angle) * 0.34; this.group.add(jet);
    }
    this.obstacles.push({ x, z, r: 3.1 });
  }

  private buildRecreation(): void {
    const cabins = [
      [-105, 92], [-62, 80], [-12, 104], [48, 82], [105, 72],
      [-112, -12], [-62, -32], [2, -58], [62, -72], [112, -28],
    ];
    for (let i = 0; i < cabins.length; i++) this.addCabin(cabins[i][0], cabins[i][1], i);
  }

  private addCabin(x: number, z: number, index: number): void {
    ({ x, z } = this.clearOfRoutes(x, z, 6.2));
    ({ x, z } = this.dryPoint({ x, z }, this.routeHazards(6)));
    ({ x, z } = this.clearOfRoutes(x, z, 6.2));
    ({ x, z } = this.dryPoint({ x, z }, this.routeHazards(6)));
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
    ({ x, z } = this.clearOfRoutes(x, z, Math.max(w, d) * 0.72 + 1.2));
    this.buildings.push({ x, z, w, d, rotation });
    const y = this.heightAt(x, z);
    const material = new THREE.MeshStandardMaterial({ color: this.biome.urban ? 0xb7b6ac : 0x9a7654, map: this.biome.urban && h > 9 ? this.getCityTexture() : undefined, roughness: 0.9 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h / 2, z); mesh.rotation.y = rotation; mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.35, 0.35, d + 0.35), new THREE.MeshStandardMaterial({ color: 0x565c5c, roughness: 0.85 }));
    roof.position.set(x, y + h + 0.15, z); roof.rotation.y = rotation; this.group.add(roof);
    if (this.biome.urban) {
      for (const floor of [0.35, 3.2, h - 0.45]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, floor < 1 ? 0.55 : 0.18, 0.18), new THREE.MeshStandardMaterial({ color: 0xd0c1a6, roughness: 0.94 }));
        band.position.set(x + Math.sin(rotation) * (d / 2 + 0.1), y + floor, z + Math.cos(rotation) * (d / 2 + 0.1)); band.rotation.y = rotation; this.group.add(band);
      }
    }
    this.addFootprintObstacles({ x, z, w, d, rotation });
  }

  private addFootprintObstacles(building: BuildingFootprint): void {
    const alongX = building.w >= building.d, length = Math.max(building.w, building.d), radius = Math.min(building.w, building.d) * 0.52;
    const count = Math.max(1, Math.ceil(length / 3.8)), cos = Math.cos(building.rotation), sin = Math.sin(building.rotation);
    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : -length / 2 + radius + (length - radius * 2) * i / (count - 1);
      const lx = alongX ? offset : 0, lz = alongX ? 0 : offset;
      this.obstacles.push({ x: building.x + lx * cos + lz * sin, z: building.z - lx * sin + lz * cos, r: radius });
    }
  }

  private prepareDepressions(): void {
    if (this.biome.urban || this.biome.mine) return;
    const rng = mulberry32(this.biome.seed + 803);
    for (const cp of this.controls.filter((control) => control.feature === "depression")) {
      this.depressions.push({ x: cp.x, z: cp.z, r: 3.2 + rng() * 1.8, depth: 1.15 + rng() * 0.85 });
    }
    const extra = this.biome.id === "big-slyudorudnik" ? 44 : 14, range = this.size - 55;
    for (let i = 0; i < extra; i++) {
      const x = (rng() - 0.5) * range, z = (rng() - 0.5) * range;
      if (!this.isNearMajorTrail(x, z, 4) && !this.inWater(x, z, 5)) this.depressions.push({ x, z, r: 1.5 + rng() * (this.biome.id === "big-slyudorudnik" ? 4.2 : 2.4), depth: 0.35 + rng() * (this.biome.id === "big-slyudorudnik" ? 2.8 : 0.65) });
    }
  }

  private buildFeatures(): void {
    const rng = mulberry32(this.biome.seed + 800);
    for (const cp of this.controls) {
      if (cp.feature === "rock") this.addRock(cp.x - 1.5, cp.z + 1.1, 1.25 + rng() * 0.5, true);
      else if (cp.feature === "tree" || cp.feature === "root") this.addDistinctiveTree(cp.x + 1.8, cp.z + 0.8, cp.feature === "root");
      else if (cp.feature === "building" && !this.biome.mine) {
        const w = this.biome.urban ? 12.5 + rng() * 3.5 : 7.4, d = this.biome.urban ? 6.8 + rng() * 1.6 : 7.4;
        this.addBuilding(cp.x + w / 2, cp.z + d / 2, w, d, this.biome.urban ? 10 + rng() * 9 : 5.5, 0);
      }
      else if (cp.feature === "fence" && !this.biome.mine) this.addFence(cp.x + 2.5, cp.z, 8);
      else if (cp.feature === "fountain" && this.biome.urban) this.addFountain(cp.x - 4, cp.z);
      else if (cp.feature === "bench" && this.biome.urban) this.addBench(cp.x, cp.z + 1.2, 0);
    }
  }

  private buildFallenOak(): void {
    const start = new THREE.Vector3(100, 0, 128), end = new THREE.Vector3(113, 0, 138);
    start.y = this.heightAt(start.x, start.z) + 0.65; end.y = this.heightAt(end.x, end.z) + 0.65;
    const direction = end.clone().sub(start), length = direction.length();
    const wood = new THREE.MeshStandardMaterial({ color: 0x57412d, roughness: 1 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.78, length, 11), wood);
    trunk.position.copy(start).add(end).multiplyScalar(0.5);
    trunk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    trunk.castShadow = true; trunk.receiveShadow = true; this.group.add(trunk);
    for (let i = 0; i < 7; i++) {
      const t = 0.18 + i * 0.1, base = start.clone().lerp(end, t), angle = i * 2.4;
      const tip = base.clone().add(new THREE.Vector3(Math.cos(angle) * (2.2 + i % 3), 0.7 + (i % 2) * 0.6, Math.sin(angle) * (2.2 + i % 3)));
      const branchDirection = tip.clone().sub(base), branch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, branchDirection.length(), 7), wood);
      branch.position.copy(base).add(tip).multiplyScalar(0.5); branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), branchDirection.normalize());
      branch.castShadow = true; this.group.add(branch);
    }
    for (let i = 0; i <= 5; i++) { const p = start.clone().lerp(end, i / 5); this.obstacles.push({ x: p.x, z: p.z, r: 0.7 }); }
  }

  private addRock(x: number, z: number, scale: number, obstacle = false): void {
    ({ x, z } = this.clearOfRoutes(x, z, this.biome.urban ? 7 : 2.4 + scale));
    if (this.biome.urban && this.isNearRoad(x, z, 5)) return;
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: this.biome.rock, roughness: 0.82, metalness: this.biome.mine ? 0.32 : 0.02, flatShading: true }));
    mesh.scale.set(scale * 1.15, scale * 0.85, scale); mesh.rotation.set(0.2, x * 0.17, -0.1); mesh.position.set(x, this.heightAt(x, z) + scale * 0.55, z);
    mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh); this.rocks.push({ x, z, s: scale });
    if (obstacle) this.obstacles.push({ x, z, r: scale * 0.85 });
  }

  private addDistinctiveTree(x: number, z: number, roots: boolean): void {
    ({ x, z } = this.clearOfRoutes(x, z, this.biome.urban ? 7.2 : 3));
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
    ({ x, z } = this.clearOfRoutes(x, z, this.biome.urban ? 7 : 2.2));
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
      let x = (rng() - 0.5) * (this.size - 16), z = (rng() - 0.5) * (this.size - 16);
      if (this.biome.urban) {
        const parks = [{ x: -45, z: 45 }, { x: 45, z: -45 }, { x: -45, z: -45 }], park = parks[Math.floor(rng() * parks.length)];
        x = park.x + (rng() - 0.5) * 57; z = park.z + (rng() - 0.5) * 57;
        if (!this.isUrbanPark(x, z) || this.isNearCityPath(x, z, 2.2)) continue;
      }
      if (this.isNearMajorTrail(x, z, this.biome.urban ? 7.8 : 3.4) || this.isNearControl(x, z, 4) || this.inWater(x, z, 3)) continue;
      const patch = this.vegetation.kindAt(x, z);
      if (patch === "meadow" || patch === "thorn") continue;
      if (this.obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 1.7)) continue;
      positions.push({ x, z, s: 0.82 + rng() * 0.68, birch: this.biome.id === "south-ural" ? rng() < 0.82 : this.biome.id === "bog" ? rng() < 0.46 : rng() < 0.22 });
    }
    const count = positions.length;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.29, 1, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), count);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), count);
    const crownTop = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), count);
    const contactShadows = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: 0x14251b, transparent: true, opacity: 0.1, depthWrite: false }), count);
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
    trunk.receiveShadow = true; crown.receiveShadow = true; crownTop.receiveShadow = true;
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
    const rocks: Array<{ x: number; z: number; s: number }> = [], slyud = this.biome.id === "slyudorudnik" || this.biome.id === "big-slyudorudnik";
    let attempts = 0;
    while (rocks.length < this.biome.rockDensity && attempts++ < this.biome.rockDensity * 8) {
      const range = this.size - 20, x = (rng() - 0.5) * range, z = (rng() - 0.5) * range;
      const large = slyud && rng() < 0.25, s = large ? 1.4 + rng() * 2.5 : 0.25 + rng() * 0.95;
      if (this.isNearMajorTrail(x, z, 1 + s) || this.isNearControl(x, z, 3) || this.inWater(x, z, 1)) continue;
      const rock = { x, z, s }; rocks.push(rock); this.rocks.push(rock);
    }
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: this.biome.rock, roughness: 0.9, metalness: slyud ? 0.12 : 0, flatShading: true }), rocks.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rocks.length; i++) {
      const p = rocks[i];
      dummy.position.set(p.x, this.heightAt(p.x, p.z) + p.s * 0.35, p.z); dummy.scale.set(p.s * 1.35, p.s * 0.78, p.s); dummy.rotation.set(rng(), rng() * Math.PI, rng() * 0.3); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (p.s > 0.7) this.obstacles.push({ x: p.x, z: p.z, r: p.s * 0.62 });
    }
    mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true; this.group.add(mesh);
    if (slyud) { this.buildRockRidges(rng); this.buildGiantBoulders(rng); }
  }

  private buildRockRidges(rng: () => number): void {
    const big = this.biome.id === "big-slyudorudnik";
    const points: Array<{ x: number; z: number; sx: number; sy: number; sz: number; ry: number; shape: number }> = [];
    const ridgeCount = big ? 8 : 6, segments = big ? 38 : 26;
    for (let ridge = 0; ridge < ridgeCount; ridge++) {
      const baseZ = -this.size / 2 + 24 + ridge * (this.size - 48) / (ridgeCount - 1);
      for (let i = 0; i < segments; i++) {
        const x = -this.size / 2 + 18 + i * (this.size - 36) / (segments - 1) + (rng() - 0.5) * 4;
        const guide = baseZ + Math.sin(i * 0.48 + ridge) * (big ? 13 : 8) + x * 0.07;
        let z = guide, highest = -Infinity;
        for (let sample = -4; sample <= 4; sample++) {
          const candidate = guide + sample * 4.2, h = this.rawHeight(x, candidate);
          if (h > highest) { highest = h; z = candidate; }
        }
        const large = i % 4 === 0, sx = large ? 3.8 + rng() * (big ? 4.8 : 3) : 1.4 + rng() * 2.5;
        const sy = large ? 3.2 + rng() * (big ? 5.5 : 2.5) : 1 + rng() * 2.1, sz = large ? 3 + rng() * 3 : 1.3 + rng() * 2;
        if (this.isNearMajorTrail(x, z, Math.max(sx, sz) * 0.7 + 1) || this.isNearControl(x, z, 6) || this.inWater(x, z, 4)) continue;
        points.push({ x, z, sx, sy, sz, ry: -0.55 + rng() * 1.1, shape: (i + ridge) % 3 });
      }
    }
    const material = new THREE.MeshStandardMaterial({ color: 0x7b8280, roughness: 0.83, metalness: 0.14, flatShading: true });
    const geometries = [new THREE.DodecahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 0), new THREE.TetrahedronGeometry(1, 0)];
    const dummy = new THREE.Object3D();
    for (let shape = 0; shape < 3; shape++) {
      const subset = points.filter((p) => p.shape === shape), rocks = new THREE.InstancedMesh(geometries[shape], material, subset.length);
      subset.forEach((p, i) => {
        dummy.position.set(p.x, this.heightAt(p.x, p.z) + p.sy * 0.36, p.z); dummy.scale.set(p.sx, p.sy, p.sz); dummy.rotation.set((rng() - 0.5) * 0.35, p.ry, (rng() - 0.5) * 0.28); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
        this.rocks.push({ x: p.x, z: p.z, s: Math.max(p.sx, p.sz) });
        this.obstacles.push({ x: p.x, z: p.z, r: Math.min(p.sx, p.sz) * 0.68 });
      });
      rocks.castShadow = true; rocks.receiveShadow = true; rocks.instanceMatrix.needsUpdate = true; this.group.add(rocks);
    }
  }

  private buildGiantBoulders(rng: () => number): void {
    const big = this.biome.id === "big-slyudorudnik";
    let placed = 0, attempts = 0;
    while (placed < 5 && attempts++ < 300) {
      const range = this.size - 70, x = (rng() - 0.5) * range, z = (rng() - 0.5) * range;
      const sx = (big ? 6.5 : 4.5) + rng() * (big ? 4 : 2.5), sy = sx * (0.72 + rng() * 0.55), sz = sx * (0.72 + rng() * 0.5);
      if (this.isNearMajorTrail(x, z, sx + 1.5) || this.isNearControl(x, z, 11) || this.inWater(x, z, 8)) continue;
      const geometry = placed % 2 ? new THREE.IcosahedronGeometry(1, 1) : new THREE.DodecahedronGeometry(1, 0);
      const rock = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: this.biome.rock, roughness: 0.86, metalness: 0.1, flatShading: true }));
      rock.position.set(x, this.heightAt(x, z) + sy * 0.42, z); rock.scale.set(sx, sy, sz); rock.rotation.set(rng() * 0.25, rng() * Math.PI, rng() * 0.2); rock.castShadow = true; rock.receiveShadow = true; this.group.add(rock);
      this.rocks.push({ x, z, s: Math.max(sx, sz) }); this.obstacles.push({ x, z, r: Math.min(sx, sz) * 0.72 }); placed++;
    }
  }

  private buildMarshVegetation(): void {
    if (!this.marshes.length) return;
    const rng = mulberry32(this.biome.seed + 5150), reedsPerMarsh = 370, hummocksPerMarsh = 135, deadTreesPerMarsh = 22;
    const reeds = new THREE.InstancedMesh(new THREE.ConeGeometry(0.055, 1.2, 5), new THREE.MeshStandardMaterial({ color: 0x718059, roughness: 1 }), this.marshes.length * reedsPerMarsh);
    const hummocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 1), new THREE.MeshStandardMaterial({ color: 0x667251, roughness: 1, flatShading: true }), this.marshes.length * hummocksPerMarsh);
    const deadTrees = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.16, 3.8, 6), new THREE.MeshStandardMaterial({ color: 0x716853, roughness: 1 }), this.marshes.length * deadTreesPerMarsh);
    const dummy = new THREE.Object3D(); let ri = 0, hi = 0, ti = 0;
    for (const marsh of this.marshes) {
      for (let i = 0; i < reedsPerMarsh; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * marsh.r * 0.96, x = marsh.x + Math.cos(a) * r, z = marsh.z + Math.sin(a) * r;
        if (this.isNearTrail(x, z, 0.9)) continue;
        dummy.position.set(x, this.heightAt(x, z) + 0.55, z); dummy.scale.set(0.7 + rng(), 0.7 + rng() * 0.8, 0.7 + rng()); dummy.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI, (rng() - 0.5) * 0.15); dummy.updateMatrix(); reeds.setMatrixAt(ri++, dummy.matrix);
      }
      for (let i = 0; i < hummocksPerMarsh; i++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * marsh.r * 0.9, x = marsh.x + Math.cos(a) * r, z = marsh.z + Math.sin(a) * r;
        if (this.isNearTrail(x, z, 0.9)) continue;
        dummy.position.set(x, this.heightAt(x, z) + 0.1, z); dummy.scale.set(0.5 + rng(), 0.2 + rng() * 0.35, 0.5 + rng()); dummy.rotation.set(0, rng() * Math.PI, 0); dummy.updateMatrix(); hummocks.setMatrixAt(hi++, dummy.matrix);
      }
      for (let i = 0; i < deadTreesPerMarsh; i++) {
        const a = rng() * Math.PI * 2, r = marsh.r * (0.7 + rng() * 0.45), x = marsh.x + Math.cos(a) * r, z = marsh.z + Math.sin(a) * r;
        if (this.isNearTrail(x, z, 1)) continue;
        dummy.position.set(x, this.heightAt(x, z) + 1.8, z); dummy.scale.setScalar(0.7 + rng() * 0.65); dummy.rotation.set((rng() - 0.5) * 0.18, rng() * Math.PI, (rng() - 0.5) * 0.18); dummy.updateMatrix(); deadTrees.setMatrixAt(ti++, dummy.matrix);
      }
    }
    reeds.count = ri; hummocks.count = hi; deadTrees.count = ti;
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
    const layout = this.mineLayout!;
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x39423f, roughness: 0.58, metalness: 0.36, flatShading: true });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x303633, roughness: 0.92, metalness: 0.08 });
    const timber = new THREE.MeshStandardMaterial({ color: 0x624833, roughness: 1 });
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x737c78, metalness: 0.72, roughness: 0.35 });
    const dummy = new THREE.Object3D();
    const floors = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), floorMaterial, layout.floors.length);
    layout.floors.forEach((f, i) => {
      dummy.position.set(f.x, this.heightAt(f.x, f.z) - 0.02, f.z); dummy.scale.set(f.w, 0.14, f.d); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); floors.setMatrixAt(i, dummy.matrix);
    });
    floors.receiveShadow = true; floors.instanceMatrix.needsUpdate = true; this.group.add(floors);
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMaterial, layout.walls.length);
    layout.walls.forEach((wall, i) => {
      const dx = wall.b.x - wall.a.x, dz = wall.b.z - wall.a.z, x = (wall.a.x + wall.b.x) / 2, z = (wall.a.z + wall.b.z) / 2;
      dummy.position.set(x, this.heightAt(x, z) + 2.05, z); dummy.scale.set(0.95, 4.25, Math.hypot(dx, dz) + 0.35); dummy.rotation.set(0, Math.atan2(dx, dz), 0); dummy.updateMatrix(); walls.setMatrixAt(i, dummy.matrix);
      const minX = Math.floor((Math.min(wall.a.x, wall.b.x) - 1) / CELL), maxX = Math.floor((Math.max(wall.a.x, wall.b.x) + 1) / CELL);
      const minZ = Math.floor((Math.min(wall.a.z, wall.b.z) - 1) / CELL), maxZ = Math.floor((Math.max(wall.a.z, wall.b.z) + 1) / CELL);
      for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
        const key = `${cx},${cz}`, cell = this.mineWallGrid.get(key); if (cell) cell.push(wall); else this.mineWallGrid.set(key, [wall]);
      }
    });
    walls.castShadow = true; walls.receiveShadow = true; walls.instanceMatrix.needsUpdate = true; this.group.add(walls);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(307, 0.45, 307), wallMaterial); ceiling.position.set(0, 4.22, 0); ceiling.receiveShadow = true; this.group.add(ceiling);

    const supportedCells = layout.cells.filter((c) => (Math.round(c.x / 18) + Math.round(c.z / 18)) % 2 === 0);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 3.35, 0.24), timber, supportedCells.length * 2);
    const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(5.6, 0.28, 0.3), timber, supportedCells.length);
    supportedCells.forEach((c, i) => {
      const y = this.heightAt(c.x, c.z);
      for (const side of [-1, 1]) { dummy.position.set(c.x + side * 2.5, y + 1.67, c.z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, side * 0.035); dummy.updateMatrix(); posts.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), dummy.matrix); }
      dummy.position.set(c.x, y + 3.22, c.z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); beams.setMatrixAt(i, dummy.matrix);
    });
    posts.instanceMatrix.needsUpdate = true; beams.instanceMatrix.needsUpdate = true; posts.castShadow = true; beams.castShadow = true; this.group.add(posts, beams);
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.09, 18), railMaterial, layout.edges.length * 2);
    layout.edges.forEach((edge, i) => {
      const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z, length = Math.hypot(dx, dz), angle = Math.atan2(dx, dz), nx = Math.cos(angle), nz = -Math.sin(angle);
      for (const side of [-1, 1]) {
        const x = (edge.a.x + edge.b.x) / 2 + nx * side * 0.67, z = (edge.a.z + edge.b.z) / 2 + nz * side * 0.67;
        dummy.position.set(x, this.heightAt(x, z) + 0.1, z); dummy.scale.set(1, 1, length / 18); dummy.rotation.set(0, angle, 0); dummy.updateMatrix(); rails.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), dummy.matrix);
      }
    });
    rails.instanceMatrix.needsUpdate = true; this.group.add(rails);

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x080a09, roughness: 1 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9b83, roughness: 0.94 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.15, 5, 8), bodyMaterial); body.position.y = 0.95; this.monster.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.39, 12, 10), skinMaterial); head.scale.set(0.78, 1.18, 0.72); head.position.set(0, 1.83, 0.03); this.monster.add(head);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.045), new THREE.MeshBasicMaterial({ color: 0x090000 })); mouth.position.set(0, 1.63, 0.29); this.monster.add(mouth);
    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), new THREE.MeshBasicMaterial({ color: 0x050000 })); socket.position.set(side * 0.14, 1.93, 0.27); this.monster.add(socket);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.037, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b20 })); eye.position.set(side * 0.14, 1.93, 0.345); this.monster.add(eye);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 1.15, 4, 7), bodyMaterial); arm.position.set(side * 0.5, 0.95, 0); arm.rotation.z = side * -0.22; this.monster.add(arm);
      for (let tooth = 0; tooth < 3; tooth++) { const fang = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 5), new THREE.MeshBasicMaterial({ color: 0xe8dfc2 })); fang.position.set(side * (0.035 + tooth * 0.042), 1.69, 0.325); fang.rotation.z = Math.PI; this.monster.add(fang); }
    }
    this.monster.visible = false; this.group.add(this.monster);
  }

  isMineOpen(x: number, z: number, clearance = 0.35): boolean {
    return Boolean(this.mineLayout?.floors.some((f) => Math.abs(x - f.x) <= f.w / 2 - clearance && Math.abs(z - f.z) <= f.d / 2 - clearance));
  }

  private nearestMineCell(point: Vec2): number {
    const cells = this.mineLayout!.cells;
    let best = 0, distance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cells.length; i++) {
      const d = (cells[i].x - point.x) ** 2 + (cells[i].z - point.z) ** 2;
      if (d < distance) { distance = d; best = i; }
    }
    return best;
  }

  private mineDistances(to: Vec2): number[] {
    const layout = this.mineLayout!, finish = this.nearestMineCell(to);
    const adjacency: number[][] = layout.cells.map(() => []);
    const index = new Map(layout.cells.map((cell, i) => [`${cell.x},${cell.z}`, i]));
    for (const edge of layout.edges) {
      const a = index.get(`${edge.a.x},${edge.a.z}`)!, b = index.get(`${edge.b.x},${edge.b.z}`)!;
      adjacency[a].push(b); adjacency[b].push(a);
    }
    const distances = new Array<number>(layout.cells.length).fill(Number.POSITIVE_INFINITY);
    distances[finish] = 0;
    const queue = [finish];
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      for (const next of adjacency[current]) {
        if (Number.isFinite(distances[next])) continue;
        distances[next] = distances[current] + 1; queue.push(next);
      }
    }
    return distances;
  }

  private mineNextStep(from: Vec2, to: Vec2): Vec2 | null {
    const layout = this.mineLayout!, start = this.nearestMineCell(from), finish = this.nearestMineCell(to);
    if (start === finish) return { ...to };
    const distances = this.mineDistances(to), current = layout.cells[start];
    let best = distances[start], target: Vec2 | null = null;
    for (const edge of layout.edges) {
      let neighbor: Vec2 | null = null;
      if (edge.a.x === current.x && edge.a.z === current.z) neighbor = edge.b;
      if (edge.b.x === current.x && edge.b.z === current.z) neighbor = edge.a;
      if (!neighbor) continue;
      const index = this.nearestMineCell(neighbor), score = distances[index];
      if (score < best) { best = score; target = neighbor; }
    }
    return target ? { ...target } : null;
  }

  updateMonster(dt: number, player: Vec2, flashlightOn: boolean, yaw = 0): boolean {
    if (!this.biome.mine || !this.mineLayout) return false;
    this.monsterContactCooldown = Math.max(0, this.monsterContactCooldown - dt);
    if (!this.monsterActive) {
      this.monsterTime -= dt;
      if (this.monsterTime > 0) return false;
      const cells = this.mineLayout.cells, distances = this.mineDistances(player);
      let spawn = cells[0], best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i], graphDistance = distances[i];
        const score = Math.abs(graphDistance - 4) * 100 + Math.abs(Math.hypot(cell.x - player.x, cell.z - player.z) - 62);
        if (score < best) { best = score; spawn = cell; }
      }
      this.monster.position.set(spawn.x, this.heightAt(spawn.x, spawn.z), spawn.z);
      this.monsterActive = true; this.monster.visible = true; this.monsterPathTimer = 0;
    }

    const mx = this.monster.position.x, mz = this.monster.position.z;
    const dx = mx - player.x, dz = mz - player.z, distance = Math.hypot(dx, dz) || 0.001;
    const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
    const inBeam = flashlightOn && distance < 34 && (dx * forwardX + dz * forwardZ) / distance > 0.93 &&
      mineLineOpen(this.mineLayout, player, { x: mx, z: mz }, 0.12);
    if (inBeam) this.monsterRetreat = Math.max(this.monsterRetreat, 0.5);
    else this.monsterRetreat = Math.max(0, this.monsterRetreat - dt);

    this.monsterPathTimer -= dt;
    if (this.monsterPathTimer <= 0 && (this.monsterRetreat > 0 || this.monsterPath.length === 0)) {
      this.monsterPathTimer = this.monsterRetreat > 0 ? 0.4 : 0.34;
      if (this.monsterRetreat > 0) {
        const current = this.nearestMineCell({ x: mx, z: mz }), currentCell = this.mineLayout.cells[current];
        const candidates = [currentCell];
        for (const edge of this.mineLayout.edges) {
          if (edge.a.x === currentCell.x && edge.a.z === currentCell.z) candidates.push(edge.b);
          if (edge.b.x === currentCell.x && edge.b.z === currentCell.z) candidates.push(edge.a);
        }
        let target: Vec2 | null = null, farthest = distance;
        for (const cell of candidates) {
          const d = Math.hypot(cell.x - player.x, cell.z - player.z);
          if (d > farthest + 0.2) { farthest = d; target = cell; }
        }
        this.monsterPath = target ? [{ ...target }] : [];
      } else {
        const next = this.mineNextStep({ x: mx, z: mz }, player);
        this.monsterPath = next ? [next] : [];
      }
    }

    while (this.monsterPath.length && Math.hypot(this.monster.position.x - this.monsterPath[0].x, this.monster.position.z - this.monsterPath[0].z) < 0.3) this.monsterPath.shift();
    let target = this.monsterPath[0];
    if (!target && this.monsterRetreat <= 0 && mineLineOpen(this.mineLayout, { x: mx, z: mz }, player, 0.12)) target = player;
    if (target) {
      const tx = target.x - this.monster.position.x, tz = target.z - this.monster.position.z;
      const length = Math.hypot(tx, tz);
      if (length > 0.001) {
        const speed = this.monsterRetreat > 0 ? 6.4 : 5.15;
        const step = Math.min(length, speed * dt);
        this.monster.position.x += tx / length * step;
        this.monster.position.z += tz / length * step;
        this.monster.position.y = this.heightAt(this.monster.position.x, this.monster.position.z);
        this.monster.lookAt(target.x, this.monster.position.y + 1.2, target.z);
      }
    }
    this.monster.visible = true;
    const contactDistance = Math.hypot(this.monster.position.x - player.x, this.monster.position.z - player.z);
    if (!flashlightOn && contactDistance < 0.76 && this.monsterContactCooldown <= 0) {
      this.monsterContactCooldown = 2.5; this.monsterRetreat = 2.4; this.monsterPathTimer = 0;
      return true;
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
    const spectators = this.biome.mine ? 0 : 12, bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.18, 0.65, 3, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), spectators);
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
    if (this.biome.mine) return "trail";
    for (let i = 0; i < this.trails.length; i++) {
      if (!this.nearPath(this.trails[i], x, z, this.trailWidth(i) * 0.5)) continue;
      if (this.biome.urban) return "road";
      return this.trailKinds[i] === "micro" ? "microtrail" : "trail";
    }
    if (this.biome.urban && this.isNearCityPath(x, z, 1.2)) return "road";
    for (const water of this.waters) if (Math.hypot(x - water.x, z - water.z) < water.r) return "water";
    for (const stream of this.streams) if (this.nearPath(stream, x, z, 0.68)) return "water";
    for (const marsh of this.marshes) if (Math.hypot(x - marsh.x, z - marsh.z) < marsh.r) return "marsh";
    return this.vegetation.kindAt(x, z) ?? "grass";
  }

  private clearOfRoutes(x: number, z: number, clearance: number): Vec2 {
    let best = { x, z, d: Number.POSITIVE_INFINITY, nx: 0, nz: 0 };
    const paths = [...this.trails, ...this.cityPaths];
    for (const path of paths) for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], abx = b.x - a.x, abz = b.z - a.z, length2 = abx * abx + abz * abz || 1;
      const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / length2, 0, 1);
      const qx = a.x + abx * t, qz = a.z + abz * t, dx = x - qx, dz = z - qz, d = Math.hypot(dx, dz);
      if (d < best.d) best = { x: qx, z: qz, d, nx: d > 0.001 ? dx / d : -abz / Math.sqrt(length2), nz: d > 0.001 ? dz / d : abx / Math.sqrt(length2) };
    }
    return best.d < clearance ? { x: best.x + best.nx * clearance, z: best.z + best.nz * clearance } : { x, z };
  }

  private nearPath(path: Vec2[], x: number, z: number, distance: number): boolean {
    for (let i = 0; i < path.length - 1; i++) if (distanceToSegment(x, z, path[i].x, path[i].z, path[i + 1].x, path[i + 1].z) < distance) return true;
    return false;
  }

  isNearTrail(x: number, z: number, distance: number): boolean {
    return this.trails.some((trail, index) => this.nearPath(trail, x, z, this.trailWidth(index) * 0.5 + distance));
  }

  isNearMajorTrail(x: number, z: number, distance: number): boolean {
    return this.trails.some((trail, index) => this.trailKinds[index] !== "micro" && this.nearPath(trail, x, z, this.trailWidth(index) * 0.5 + distance));
  }

  isRoadAt(x: number, z: number): boolean {
    return Boolean(this.biome.urban) && [-90, 0, 90].some((lane) => Math.abs(z - lane) <= 2.95 || Math.abs(x - lane) <= 2.95);
  }

  isOnCrossing(x: number, z: number): boolean {
    if (!this.biome.urban) return false;
    return [-90, 0, 90].some((cx) => [-90, 0, 90].some((cz) => Math.abs(x - cx) <= 8.2 && Math.abs(z - cz) <= 8.2));
  }

  illegalRoadCrossing(from: Vec2, to: Vec2): boolean {
    if (!this.biome.urban || this.isOnCrossing(to.x, to.z) || this.isOnCrossing((from.x + to.x) / 2, (from.z + to.z) / 2)) return false;
    for (const lane of [-90, 0, 90]) {
      if ((from.z - lane) * (to.z - lane) < 0 && Math.abs(from.z - to.z) > 0.001) {
        const t = (lane - from.z) / (to.z - from.z), x = THREE.MathUtils.lerp(from.x, to.x, t);
        if (!this.isOnCrossing(x, lane)) return true;
      }
      if ((from.x - lane) * (to.x - lane) < 0 && Math.abs(from.x - to.x) > 0.001) {
        const t = (lane - from.x) / (to.x - from.x), z = THREE.MathUtils.lerp(from.z, to.z, t);
        if (!this.isOnCrossing(lane, z)) return true;
      }
    }
    return false;
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
    if (this.biome.mine) {
      for (let pass = 0; pass < 3; pass++) {
        const cx = Math.floor(position.x / CELL), cz = Math.floor(position.z / CELL);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const cell = this.mineWallGrid.get(`${cx + dx},${cz + dz}`); if (!cell) continue;
          for (const wall of cell) {
            const abx = wall.b.x - wall.a.x, abz = wall.b.z - wall.a.z;
            const t = THREE.MathUtils.clamp(((position.x - wall.a.x) * abx + (position.z - wall.a.z) * abz) / (abx * abx + abz * abz), 0, 1);
            const qx = wall.a.x + abx * t, qz = wall.a.z + abz * t, minimum = radius + 0.5;
            let ox = position.x - qx, oz = position.z - qz, d = Math.hypot(ox, oz);
            if (d >= minimum) continue;
            if (d < 0.0001) { ox = -abz; oz = abx; d = Math.hypot(ox, oz) || 1; }
            position.x = qx + ox / d * minimum; position.z = qz + oz / d * minimum;
          }
        }
      }
      position.x = THREE.MathUtils.clamp(position.x, -152, 152); position.z = THREE.MathUtils.clamp(position.z, -152, 152); return;
    }
    const limit = this.size / 2 - 4;
    position.x = THREE.MathUtils.clamp(position.x, -limit, limit); position.z = THREE.MathUtils.clamp(position.z, -limit, limit);
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
