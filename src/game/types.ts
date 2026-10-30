export type Difficulty = "M12" | "M16" | "ME";
export type BiomeId = "tutorial" | "north-ural" | "south-ural" | "ladoga" | "bog" | "mixed" | "recreation" | "slyudorudnik" | "big-slyudorudnik" | "mine" | "city" | "city-2";
export type GameMode = "title" | "tester" | "briefing" | "playing" | "paused" | "results";
export type ControlMode = "desktop" | "mobile";
export type UpgradeStat = "speed" | "strength" | "recovery";
export type FeatureKind = "trail" | "rock" | "tree" | "hill" | "depression" | "water" | "marsh" | "root" | "building" | "fence" | "fountain" | "bench";

export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }

export interface ControlPoint extends Vec2 {
  code: number;
  feature: FeatureKind;
  description: string;
}

export interface Course {
  difficulty: Difficulty;
  label: string;
  start: Vec2;
  finish: Vec2;
  controls: ControlPoint[];
  nominalLength: number;
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  region: string;
  subtitle: string;
  description: string;
  seed: number;
  sky: number;
  fog: number;
  ground: number;
  groundLight: number;
  trees: number;
  treeDark: number;
  treeLight: number;
  rock: number;
  accent: string;
  terrainAmplitude: number;
  treeDensity: number;
  rockDensity: number;
  marshiness: number;
  urban?: boolean;
  tutorial?: boolean;
  mine?: boolean;
  terrainDifficulty: 1 | 2 | 3 | 4 | 5;
  fatigue: number;
  vegetationDensity: number;
  worldSize?: number;
}

export interface Split {
  number: number;
  code: number;
  legTime: number;
  totalTime: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "success" | "warning";
}

export interface GameSnapshot {
  mode: GameMode;
  biomeId: BiomeId;
  difficulty: Difficulty;
  mapOpen: boolean;
  compassOpen: boolean;
  muted: boolean;
  elapsed: number;
  penalty: number;
  stamina: number;
  speed: number;
  bearing: number;
  player: Vec2;
  currentControl: number;
  totalControls: number;
  canInteract: boolean;
  interactLabel: string;
  toast: Toast | null;
  splits: Split[];
  finished: boolean;
  bestTimes: Record<string, number>;
  tutorialStep: number;
  tutorialText: string;
  courseLength: number;
  fps: number;
  drawCalls: number;
  level: number;
  xp: number;
  xpNext: number;
  skillPoints: number;
  upgrades: Record<UpgradeStat, number>;
  tester: boolean;
  wet: boolean;
  mapRaised: boolean;
  surface: string;
  xpAwarded: number;
  runLevel: number;
  flashlight: boolean;
  monsterScare: boolean;
  mapAdjust: boolean;
  finishReason: string;
  jumpHeight: number;
  grounded: boolean;
  mapZoom: number;
  controlMode: ControlMode;
  mouseSensitivity: number;
  touchSensitivity: number;
}

export interface WorldControl extends ControlPoint {
  index: number;
}
