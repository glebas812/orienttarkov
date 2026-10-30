import { getCourse, recordKey } from "./data";
import { storage } from "./storage";
import { addExperience, loadProfile, purchaseUpgrade, saveProfile, xpForLevel, xpIntoLevel } from "./progression";
import type { ControlMode, GameSnapshot, UpgradeStat } from "./types";

interface ControlSettings {
  controlMode: ControlMode;
  mouseSensitivity: number;
  touchSensitivity: number;
}

function loadControlSettings(): ControlSettings {
  const raw = storage.get<Partial<ControlSettings>>("orienteering.controls.v1", {});
  const bounded = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(2.5, Math.max(0.35, value)) : fallback;
  return {
    controlMode: raw.controlMode === "mobile" ? "mobile" : "desktop",
    mouseSensitivity: bounded(raw.mouseSensitivity, 1),
    touchSensitivity: bounded(raw.touchSensitivity, 1),
  };
}

const controlSettings = loadControlSettings();

function saveControlSettings(patch: Partial<ControlSettings>): void {
  Object.assign(controlSettings, patch);
  storage.set("orienteering.controls.v1", controlSettings);
  setSnapshot(patch);
}

function loadRecords(): Record<string, number> {
  const raw = storage.get<unknown>("orienteering.records.v1", {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 86400) result[key] = value;
  }
  return result;
}

const profile = loadProfile();
const defaultBiome = "ladoga" as const;
const defaultDifficulty = "M12" as const;

let snapshot: GameSnapshot = {
  mode: "title", biomeId: defaultBiome, difficulty: defaultDifficulty,
  mapOpen: false, compassOpen: false, muted: false,
  elapsed: 0, penalty: 0, stamina: 100, speed: 0, bearing: 0,
  player: { x: -132, z: 112 }, currentControl: 0, totalControls: getCourse(defaultBiome, defaultDifficulty).controls.length,
  canInteract: false, interactLabel: "", toast: null, splits: [], finished: false,
  bestTimes: loadRecords(), tutorialStep: 0, tutorialText: "",
  courseLength: getCourse(defaultBiome, defaultDifficulty).nominalLength,
  fps: 60, drawCalls: 0,
  level: profile.level, xp: xpIntoLevel(profile), xpNext: xpForLevel(profile.level), skillPoints: profile.skillPoints,
  upgrades: profile.upgrades, tester: false, wet: false, mapRaised: false,
  surface: "grass", xpAwarded: 0, runLevel: profile.level,
  flashlight: false, monsterScare: false, mapAdjust: false, finishReason: "",
  jumpHeight: 0, grounded: true, mapZoom: 1,
  ...controlSettings,
};

export function setControlMode(controlMode: ControlMode): void {
  saveControlSettings({ controlMode });
}

export function setMouseSensitivity(mouseSensitivity: number): void {
  saveControlSettings({ mouseSensitivity: Math.min(2.5, Math.max(0.35, mouseSensitivity)) });
}

export function setTouchSensitivity(touchSensitivity: number): void {
  saveControlSettings({ touchSensitivity: Math.min(2.5, Math.max(0.35, touchSensitivity)) });
}

const listeners = new Set<() => void>();

export function getSnapshot(): GameSnapshot { return snapshot; }

export function setSnapshot(patch: Partial<GameSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function saveRecord(time: number): boolean {
  if (snapshot.tester) return false;
  const key = recordKey(snapshot.biomeId, snapshot.difficulty, snapshot.runLevel);
  const previous = snapshot.bestTimes[key];
  if (previous !== undefined && previous <= time) return false;
  const bestTimes = { ...snapshot.bestTimes, [key]: time };
  storage.set("orienteering.records.v1", bestTimes);
  setSnapshot({ bestTimes });
  return true;
}

export function awardExperience(amount: number): void {
  if (snapshot.tester) return;
  const current = loadProfile();
  const next = addExperience(current, amount);
  saveProfile(next);
  setSnapshot({ level: next.level, xp: xpIntoLevel(next), xpNext: xpForLevel(next.level), skillPoints: next.skillPoints, upgrades: next.upgrades });
}

export function buyUpgrade(stat: UpgradeStat): void {
  const next = purchaseUpgrade(loadProfile(), stat);
  saveProfile(next);
  setSnapshot({ skillPoints: next.skillPoints, upgrades: next.upgrades });
}

export function clearToast(id: number): void {
  if (snapshot.toast?.id === id) setSnapshot({ toast: null });
}
