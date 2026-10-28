import { distanceToSegment, mulberry32 } from "./random";
import type { Vec2 } from "./types";

export interface MineWall { a: Vec2; b: Vec2 }
export interface MineFloor { x: number; z: number; w: number; d: number }
export interface MineLayout {
  walls: MineWall[];
  floors: MineFloor[];
  cells: Vec2[];
  edges: Array<{ a: Vec2; b: Vec2 }>;
}

const N = 17;
const STEP = 18;
const ORIGIN = -144;
const CORRIDOR = 6;

const cellKey = (x: number, z: number) => `${x},${z}`;
const edgeKey = (a: number, b: number, c: number, d: number) => [cellKey(a, b), cellKey(c, d)].sort().join("|");

/** A connected perfect maze with a few loops. Every wall and floor is shared by rendering, collision and the map. */
export function generateMineLayout(seed: number): MineLayout {
  const rng = mulberry32(seed + 991);
  const open = new Set<string>();
  const visited = new Set<string>();
  const stack: Array<[number, number]> = [[0, N - 1]];
  visited.add(cellKey(0, N - 1));
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const candidates = directions
      .map(([dx, dz]) => [x + dx, z + dz] as const)
      .filter(([nx, nz]) => nx >= 0 && nx < N && nz >= 0 && nz < N && !visited.has(cellKey(nx, nz)));
    if (!candidates.length) { stack.pop(); continue; }
    const [nx, nz] = candidates[Math.floor(rng() * candidates.length)];
    open.add(edgeKey(x, z, nx, nz)); visited.add(cellKey(nx, nz)); stack.push([nx, nz]);
  }
  for (let i = 0; i < 34; i++) {
    const x = Math.floor(rng() * N), z = Math.floor(rng() * N), [dx, dz] = directions[Math.floor(rng() * directions.length)];
    const nx = x + dx, nz = z + dz;
    if (nx >= 0 && nx < N && nz >= 0 && nz < N) open.add(edgeKey(x, z, nx, nz));
  }
  const cells: Vec2[] = [], floors: MineFloor[] = [], edges: Array<{ a: Vec2; b: Vec2 }> = [];
  const center = (i: number) => ORIGIN + i * STEP;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const c = { x: center(x), z: center(z) }; cells.push(c); floors.push({ x: c.x, z: c.z, w: CORRIDOR, d: CORRIDOR });
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx >= N || nz >= N || !open.has(edgeKey(x, z, nx, nz))) continue;
      const next = { x: center(nx), z: center(nz) }; edges.push({ a: c, b: next });
      floors.push({ x: (c.x + next.x) / 2, z: (c.z + next.z) / 2, w: dx ? STEP : CORRIDOR, d: dz ? STEP : CORRIDOR });
    }
  }
  const walls: MineWall[] = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) {
    const x = ORIGIN - STEP / 2 + i * STEP, z = ORIGIN - STEP / 2 + j * STEP;
    if (i === 0 || i === N || !open.has(edgeKey(i - 1, j, i, j))) walls.push({ a: { x, z }, b: { x, z: z + STEP } });
  }
  for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) {
    const x = ORIGIN - STEP / 2 + i * STEP, z = ORIGIN - STEP / 2 + j * STEP;
    if (j === 0 || j === N || !open.has(edgeKey(i, j - 1, i, j))) walls.push({ a: { x, z }, b: { x: x + STEP, z } });
  }
  return { walls, floors, cells, edges };
}

export function mineLineOpen(layout: MineLayout, a: Vec2, b: Vec2, clearance = 0.4): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.max(2, Math.ceil(length / 1.2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const onFloor = layout.floors.some((f) => Math.abs(x - f.x) <= f.w / 2 - clearance && Math.abs(z - f.z) <= f.d / 2 - clearance);
    if (!onFloor) return false;
    if (layout.walls.some((w) => distanceToSegment(x, z, w.a.x, w.a.z, w.b.x, w.b.z) < clearance + 0.48)) return false;
  }
  return true;
}
