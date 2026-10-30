import * as THREE from "three";
import { mulberry32 } from "./random";
import type { BiomeDef, Course } from "./types";

export type VegetationKind = "meadow" | "rough" | "slow" | "walk" | "fight" | "fallen" | "thorn";
export interface VegetationPatch { x: number; z: number; rx: number; rz: number; rotation: number; kind: VegetationKind }
interface Environment {
  heightAt: (x: number, z: number) => number;
  isNearTrail: (x: number, z: number, distance: number) => boolean;
  isNearAnyTrail: (x: number, z: number, distance: number) => boolean;
  isNearControl: (x: number, z: number, distance: number) => boolean;
  inWater: (x: number, z: number, margin: number) => boolean;
  isObstacle: (x: number, z: number, margin: number) => boolean;
}

const CELL = 28;
type BushPoint = { x: number; z: number; s: number; kind: VegetationKind };

export class VegetationSystem {
  readonly patches: VegetationPatch[] = [];
  private readonly grid = new Map<string, VegetationPatch[]>();

  constructor(private group: THREE.Group, private biome: BiomeDef, course: Course, private env: Environment) {
    if (biome.mine) return;
    const rng = mulberry32(biome.seed + 1703);
    if (!biome.urban) {
      this.generatePatches(rng, course);
      this.indexPatches();
      this.buildGrass(rng);
      this.buildBushesAndSaplings(rng);
      this.buildThorns(rng);
      this.buildBoundaries(rng);
      this.buildDeadwood(rng);
      if (biome.id === "slyudorudnik" || biome.id === "big-slyudorudnik") this.buildFerns(rng);
    }
  }

  private generatePatches(rng: () => number, course: Course): void {
    const target = Math.round((20 + this.biome.terrainDifficulty * 7) * this.biome.vegetationDensity);
    let attempts = 0;
    while (this.patches.length < target && attempts++ < target * 18) {
      const range = (this.biome.worldSize ?? 340) - 50, x = (rng() - 0.5) * range, z = (rng() - 0.5) * range;
      if (this.env.isNearControl(x, z, 12) || this.env.inWater(x, z, 7) || this.env.isNearTrail(x, z, 5) || this.env.isObstacle(x, z, 7)) continue;
      const roll = rng();
      let kind: VegetationKind;
      if (this.biome.id === "ladoga" && roll < 0.34) kind = "meadow";
      else if (roll < 0.15) kind = "meadow";
      else if (roll < 0.31) kind = "rough";
      else if (roll < 0.49) kind = "slow";
      else if (roll < 0.66) kind = "walk";
      else if (roll < 0.76) kind = "fallen";
      else if (roll < 0.84 && this.biome.terrainDifficulty >= 3) kind = "thorn";
      else kind = this.biome.terrainDifficulty < 3 ? "slow" : "fight";
      const size = kind === "meadow" ? 1.35 : kind === "fight" ? 1.14 : kind === "thorn" ? 0.42 : 1.12;
      this.patches.push({ x, z, rx: (8 + rng() * 17) * size, rz: (7 + rng() * 14) * size, rotation: rng() * Math.PI, kind });
    }
    if (this.biome.terrainDifficulty === 5) {
      const kinds: VegetationKind[] = ["meadow", "rough", "slow", "walk", "fight", "fallen", "thorn"];
      kinds.forEach((kind, i) => {
        const cp = course.controls[(i * 2 + 1) % course.controls.length];
        const size = kind === "thorn" ? 0.42 : 1;
        this.patches.push({ x: cp.x + 13, z: cp.z - 11, rx: (12 + i) * size, rz: (9 + i * 0.8) * size, rotation: i * 0.55, kind });
      });
    }
  }

  private indexPatches(): void {
    for (const patch of this.patches) {
      const radius = Math.max(patch.rx, patch.rz);
      const minX = Math.floor((patch.x - radius) / CELL), maxX = Math.floor((patch.x + radius) / CELL);
      const minZ = Math.floor((patch.z - radius) / CELL), maxZ = Math.floor((patch.z + radius) / CELL);
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const key = `${x},${z}`, cell = this.grid.get(key);
        if (cell) cell.push(patch); else this.grid.set(key, [patch]);
      }
    }
  }

  kindAt(x: number, z: number): VegetationKind | null {
    const cell = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!cell) return null;
    let result: VegetationKind | null = null;
    const priority: Record<VegetationKind, number> = { meadow: 1, rough: 2, slow: 3, fallen: 4, walk: 5, fight: 6, thorn: 7 };
    for (const patch of cell) {
      const dx = x - patch.x, dz = z - patch.z;
      const cos = Math.cos(patch.rotation), sin = Math.sin(patch.rotation);
      const px = dx * cos + dz * sin, pz = -dx * sin + dz * cos;
      if ((px * px) / (patch.rx * patch.rx) + (pz * pz) / (patch.rz * patch.rz) > 1) continue;
      if (!result || priority[patch.kind] > priority[result]) result = patch.kind;
    }
    return result;
  }

  private randomPointInPatch(rng: () => number, patch: VegetationPatch): { x: number; z: number } {
    const angle = rng() * Math.PI * 2, radius = Math.sqrt(rng());
    const px = Math.cos(angle) * patch.rx * radius, pz = Math.sin(angle) * patch.rz * radius;
    const cos = Math.cos(patch.rotation), sin = Math.sin(patch.rotation);
    return { x: patch.x + px * cos - pz * sin, z: patch.z + px * sin + pz * cos };
  }

  private tuftGeometry(blades: number, radius: number, height: number): THREE.BufferGeometry {
    const positions: number[] = [];
    for (let i = 0; i < blades; i++) {
      const angle = i * Math.PI * 2 / blades + (i % 3) * 0.19;
      const r = radius * (0.25 + (i % 5) / 5);
      const bx = Math.cos(angle) * r, bz = Math.sin(angle) * r;
      const width = 0.035 + (i % 4) * 0.009;
      const lean = 0.12 + (i % 3) * 0.055;
      const h = height * (0.68 + (i % 6) * 0.065);
      const px = -Math.sin(angle) * width, pz = Math.cos(angle) * width;
      positions.push(
        bx - px, 0, bz - pz,
        bx + px, 0, bz + pz,
        bx + Math.cos(angle) * lean, h, bz + Math.sin(angle) * lean,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildGrass(rng: () => number): void {
    const count = Math.round(13200 * this.biome.vegetationDensity);
    const geometry = this.tuftGeometry(14, 0.34, 0.72);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    let placed = 0, attempts = 0;
    while (placed < count && attempts++ < count * 5) {
      let x: number, z: number, tall = 1, patch: VegetationPatch | null = null;
      if (rng() < 0.66 && this.patches.length) {
        patch = this.patches[Math.floor(rng() * this.patches.length)];
        const point = this.randomPointInPatch(rng, patch); x = point.x; z = point.z;
        tall = patch.kind === "meadow" || patch.kind === "rough" ? 1.25 : patch.kind === "fight" ? 0.55 : 0.82;
      } else {
        const range = (this.biome.worldSize ?? 340) - 12;
        x = (rng() - 0.5) * range; z = (rng() - 0.5) * range;
      }
      if (patch?.kind === "thorn" || this.env.inWater(x, z, 0.4) || this.env.isNearAnyTrail(x, z, 0.28) || this.env.isObstacle(x, z, 0.25)) continue;
      dummy.position.set(x, this.env.heightAt(x, z) + 0.018, z);
      dummy.scale.set(0.65 + rng() * 0.65, (0.42 + rng() * 0.58) * tall, 0.65 + rng() * 0.65);
      dummy.rotation.set(0, rng() * Math.PI, (rng() - 0.5) * 0.08);
      dummy.updateMatrix(); mesh.setMatrixAt(placed, dummy.matrix);
      color.set(this.biome.groundLight).offsetHSL((rng() - 0.5) * 0.035, 0.07, (rng() - 0.5) * 0.11);
      mesh.setColorAt(placed, color);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private buildBushesAndSaplings(rng: () => number): void {
    const bushPositions: BushPoint[] = [];
    const firPositions: BushPoint[] = [];
    for (const patch of this.patches) {
      if (patch.kind === "fight") {
        const density = Math.round((105 + patch.rx * patch.rz * 0.34) * (this.biome.id === "slyudorudnik" ? 1.65 : this.biome.id === "big-slyudorudnik" ? 1.9 : 1));
        for (let i = 0; i < density; i++) {
          const point = this.randomPointInPatch(rng, patch);
          if (this.env.isNearTrail(point.x, point.z, 0.65) || this.env.isNearControl(point.x, point.z, 2.2)) continue;
          firPositions.push({ ...point, s: 0.72 + rng() * 0.55, kind: patch.kind });
        }
        continue;
      }
      const density = patch.kind === "walk" ? 68 : patch.kind === "slow" ? 52 : patch.kind === "rough" || patch.kind === "meadow" ? 18 : patch.kind === "thorn" ? 0 : 24;
      for (let i = 0; i < density; i++) {
        const point = this.randomPointInPatch(rng, patch);
        if (this.env.isNearTrail(point.x, point.z, 0.7) || this.env.isNearControl(point.x, point.z, 2.5)) continue;
        bushPositions.push({ ...point, s: 0.38 + rng() * 0.72, kind: patch.kind });
      }
    }
    const extra = Math.round(420 * this.biome.vegetationDensity);
    for (let i = 0; i < extra; i++) {
      const range = (this.biome.worldSize ?? 340) - 20, x = (rng() - 0.5) * range, z = (rng() - 0.5) * range;
      if (this.env.inWater(x, z, 1) || this.env.isNearTrail(x, z, 1.2) || this.env.isNearControl(x, z, 3) || this.env.isObstacle(x, z, 1)) continue;
      bushPositions.push({ x, z, s: 0.35 + rng() * 0.65, kind: "slow" });
    }
    if (bushPositions.length) {
      const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), bushPositions.length);
      const dummy = new THREE.Object3D(), color = new THREE.Color();
      bushPositions.forEach((p, i) => {
        dummy.position.set(p.x, this.env.heightAt(p.x, p.z) + p.s * 0.48, p.z);
        dummy.scale.set(p.s * 1.15, p.s * 0.82, p.s);
        dummy.rotation.set(0, rng() * Math.PI, 0); dummy.updateMatrix(); bushes.setMatrixAt(i, dummy.matrix);
        const base = p.kind === "meadow" ? this.biome.treeLight : this.biome.trees;
        color.set(base).offsetHSL((rng() - 0.5) * 0.04, 0.05, (rng() - 0.5) * 0.1); bushes.setColorAt(i, color);
      });
      bushes.instanceMatrix.needsUpdate = true;
      if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
      this.group.add(bushes);
    }
    this.buildFightFirs(rng, firPositions);
  }

  private buildFightFirs(rng: () => number, sources: BushPoint[]): void {
    if (!sources.length) return;
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.055, 1, 5), new THREE.MeshStandardMaterial({ color: 0x594b39, roughness: 1 }), sources.length);
    const lower = new THREE.InstancedMesh(new THREE.ConeGeometry(0.62, 1.15, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), sources.length);
    const upper = new THREE.InstancedMesh(new THREE.ConeGeometry(0.43, 1.05, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), sources.length);
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    sources.forEach((p, i) => {
      const h = (1.65 + rng() * 0.85) * p.s, y = this.env.heightAt(p.x, p.z), rotation = rng() * Math.PI;
      dummy.rotation.set(0, rotation, 0);
      dummy.position.set(p.x, y + h * 0.45, p.z); dummy.scale.set(1, h * 0.9, 1); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + h * 0.53; dummy.scale.set(p.s, h * 0.72, p.s); dummy.updateMatrix(); lower.setMatrixAt(i, dummy.matrix);
      dummy.position.y = y + h * 0.88; dummy.scale.set(p.s, h * 0.55, p.s); dummy.updateMatrix(); upper.setMatrixAt(i, dummy.matrix);
      color.set(this.biome.treeDark).offsetHSL((rng() - 0.5) * 0.02, 0.04, (rng() - 0.5) * 0.08);
      lower.setColorAt(i, color); upper.setColorAt(i, color.clone().offsetHSL(0, 0, 0.035));
    });
    trunks.instanceMatrix.needsUpdate = true; lower.instanceMatrix.needsUpdate = true; upper.instanceMatrix.needsUpdate = true;
    if (lower.instanceColor) lower.instanceColor.needsUpdate = true;
    if (upper.instanceColor) upper.instanceColor.needsUpdate = true;
    this.group.add(trunks, lower, upper);
  }

  private buildThorns(rng: () => number): void {
    const patches = this.patches.filter((patch) => patch.kind === "thorn");
    if (!patches.length) return;
    const points: Array<{ x: number; z: number; h: number }> = [];
    for (const patch of patches) {
      const count = Math.round(52 + patch.rx * patch.rz * 1.05);
      for (let i = 0; i < count; i++) {
        const point = this.randomPointInPatch(rng, patch);
        if (!this.env.isNearControl(point.x, point.z, 2.3) && !this.env.isNearTrail(point.x, point.z, 0.85)) points.push({ ...point, h: 1.75 + rng() * 0.65 });
      }
    }
    const branchesPerPlant = 8;
    const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.035, 1, 5), new THREE.MeshStandardMaterial({ color: 0x70553b, roughness: 1 }), points.length * branchesPerPlant);
    const dummy = new THREE.Object3D();
    let index = 0;
    for (const p of points) {
      const y = this.env.heightAt(p.x, p.z);
      for (let branch = 0; branch < branchesPerPlant; branch++) {
        const angle = branch * Math.PI * 2 / branchesPerPlant + rng() * 0.5;
        dummy.position.set(p.x + Math.cos(angle) * 0.17, y + p.h * 0.48, p.z + Math.sin(angle) * 0.17);
        dummy.scale.set(1, p.h * (0.75 + rng() * 0.25), 1);
        dummy.rotation.set(Math.sin(angle) * 0.32, angle, Math.cos(angle) * 0.32);
        dummy.updateMatrix(); branches.setMatrixAt(index++, dummy.matrix);
      }
    }
    branches.count = index; branches.instanceMatrix.needsUpdate = true;
    this.group.add(branches);
  }

  private buildBoundaries(rng: () => number): void {
    const markers: Array<{ x: number; z: number; kind: VegetationKind; s: number }> = [];
    for (const patch of this.patches) {
      if (patch.kind === "meadow" || patch.kind === "thorn") continue;
      const circumference = Math.PI * (patch.rx + patch.rz);
      const count = Math.max(12, Math.floor(circumference / 4.4));
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        const px = Math.cos(angle) * patch.rx, pz = Math.sin(angle) * patch.rz;
        const cos = Math.cos(patch.rotation), sin = Math.sin(patch.rotation);
        const x = patch.x + px * cos - pz * sin, z = patch.z + px * sin + pz * cos;
        if (this.env.isNearTrail(x, z, 1) || this.env.isNearControl(x, z, 3)) continue;
        markers.push({ x, z, kind: patch.kind, s: 0.65 + rng() * 0.55 });
      }
    }
    if (!markers.length) return;
    const boundaryGeometry = ["south-ural", "mixed", "recreation", "ladoga"].includes(this.biome.id) ? new THREE.IcosahedronGeometry(0.72, 1) : new THREE.ConeGeometry(0.5, 1.6, 6);
    const crowns = new THREE.InstancedMesh(boundaryGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), markers.length);
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    markers.forEach((p, i) => {
      const h = p.kind === "fight" ? 2.1 : p.kind === "walk" ? 1.55 : 0.85;
      dummy.position.set(p.x, this.env.heightAt(p.x, p.z) + h * 0.5, p.z);
      dummy.scale.set(p.s, h / 1.6, p.s); dummy.rotation.set(0, rng() * Math.PI, 0); dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
      color.set(p.kind === "fallen" || p.kind === "rough" ? 0x7c7651 : this.biome.treeLight).offsetHSL(0, 0, (rng() - 0.5) * 0.08); crowns.setColorAt(i, color);
    });
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    this.group.add(crowns);
  }

  private buildDeadwood(rng: () => number): void {
    const fallenPatches = this.patches.filter((p) => p.kind === "fallen");
    const logCount = Math.round(65 + fallenPatches.length * 9 + this.biome.terrainDifficulty * 12);
    const logs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 1, 7), new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 1 }), logCount);
    const dummy = new THREE.Object3D();
    let placed = 0, attempts = 0;
    while (placed < logCount && attempts++ < logCount * 8) {
      let x = 0, z = 0;
      if (fallenPatches.length && rng() < 0.78) {
        const patch = fallenPatches[Math.floor(rng() * fallenPatches.length)], point = this.randomPointInPatch(rng, patch); x = point.x; z = point.z;
      } else { const range = (this.biome.worldSize ?? 340) - 30; x = (rng() - 0.5) * range; z = (rng() - 0.5) * range; }
      if (this.env.inWater(x, z, 0) || this.env.isNearControl(x, z, 2.2) || this.env.isNearTrail(x, z, 0.9) || this.env.isObstacle(x, z, 0.5)) continue;
      const length = 2 + rng() * 4.5, angle = rng() * Math.PI * 2;
      const ax = x - Math.cos(angle) * length * 0.5, az = z - Math.sin(angle) * length * 0.5;
      const bx = x + Math.cos(angle) * length * 0.5, bz = z + Math.sin(angle) * length * 0.5;
      if (this.env.isNearTrail(ax, az, 0.85) || this.env.isNearTrail(bx, bz, 0.85)) continue;
      const ay = this.env.heightAt(ax, az) + 0.24, by = this.env.heightAt(bx, bz) + 0.24;
      const direction = new THREE.Vector3(bx - ax, by - ay, bz - az), slopeLength = direction.length();
      dummy.position.set(x, (ay + by) * 0.5, z);
      dummy.scale.set(0.75 + rng() * 0.6, slopeLength, 0.75 + rng() * 0.6);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); dummy.updateMatrix(); logs.setMatrixAt(placed++, dummy.matrix);
    }
    logs.count = placed; logs.instanceMatrix.needsUpdate = true; this.group.add(logs);
    const stumpCount = Math.round(70 + this.biome.terrainDifficulty * 24);
    const stumps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.27, 0.55, 7), new THREE.MeshStandardMaterial({ color: 0x6b5137, roughness: 1 }), stumpCount);
    placed = 0; attempts = 0;
    while (placed < stumpCount && attempts++ < stumpCount * 6) {
      const range = (this.biome.worldSize ?? 340) - 25, x = (rng() - 0.5) * range, z = (rng() - 0.5) * range;
      if (this.env.inWater(x, z, 0.5) || this.env.isNearTrail(x, z, 1) || this.env.isObstacle(x, z, 0.4)) continue;
      dummy.position.set(x, this.env.heightAt(x, z) + 0.25, z); dummy.scale.setScalar(0.6 + rng() * 1.1); dummy.quaternion.identity(); dummy.rotation.set(0, rng() * Math.PI, 0); dummy.updateMatrix(); stumps.setMatrixAt(placed++, dummy.matrix);
    }
    stumps.count = placed; stumps.instanceMatrix.needsUpdate = true; this.group.add(stumps);
  }

  private buildFerns(rng: () => number): void {
    const count = this.biome.id === "big-slyudorudnik" ? 5600 : 3900;
    const geometry = this.tuftGeometry(18, 0.58, 0.82);
    const ferns = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0x4e793e, roughness: 1, side: THREE.DoubleSide }), count);
    const dummy = new THREE.Object3D();
    let placed = 0, attempts = 0;
    while (placed < count && attempts++ < count * 5) {
      const range = (this.biome.worldSize ?? 340) - 22, x = (rng() - 0.5) * range, z = (rng() - 0.5) * range;
      if (this.env.inWater(x, z, 0.5) || this.env.isNearTrail(x, z, 0.75) || this.env.isObstacle(x, z, 0.3)) continue;
      dummy.position.set(x, this.env.heightAt(x, z) + 0.03, z);
      dummy.scale.set(0.75 + rng() * 0.65, 0.65 + rng() * 0.45, 0.75 + rng() * 0.65);
      dummy.rotation.set(0, rng() * Math.PI, 0); dummy.updateMatrix(); ferns.setMatrixAt(placed++, dummy.matrix);
    }
    ferns.count = placed; ferns.instanceMatrix.needsUpdate = true; this.group.add(ferns);
  }
}
