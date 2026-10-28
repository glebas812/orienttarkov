import { clamp } from "./random";

export type TesterDevice = "garmin" | "polar";

export interface TesterProfile {
  device: TesterDevice;
  weight: number;
  paceSeconds: number;
  vo2max: number;
  lactateThreshold: number;
  runningIndex: number;
  hrMax: number;
  hrRest: number;
}

export interface TesterModifiers {
  speed: number;
  stamina: number;
  recovery: number;
  strength: number;
}

export const EMPTY_TESTER: TesterProfile = {
  device: "garmin", weight: 72, paceSeconds: 330, vo2max: 48,
  lactateThreshold: 165, runningIndex: 48, hrMax: 190, hrRest: 55,
};

/** Game-oriented conversion, intentionally not a medical or training assessment. */
export function testerModifiers(profile: TesterProfile): TesterModifiers {
  const aerobic = profile.device === "garmin" ? profile.vo2max : profile.runningIndex;
  const paceFactor = clamp(420 / Math.max(180, profile.paceSeconds), 0.72, 1.28);
  const aerobicFactor = clamp(0.85 + (aerobic - 35) * 0.007, 0.82, 1.18);
  const weightFactor = clamp(1.08 - Math.max(0, profile.weight - 75) * 0.002, 0.88, 1.08);
  const threshold = profile.device === "garmin"
    ? clamp(profile.lactateThreshold / Math.max(130, profile.hrMax || 190), 0.7, 0.96)
    : clamp(1 - profile.hrRest / 180, 0.55, 0.78);
  return {
    speed: clamp(paceFactor * weightFactor, 0.72, 1.28),
    stamina: clamp(85 + (aerobic - 35) * 1.5, 70, 135),
    recovery: clamp(0.8 + threshold * 0.45 + (aerobicFactor - 1) * 0.8, 0.75, 1.35),
    strength: clamp(0.92 + (profile.weight - 60) * 0.002 + (aerobicFactor - 1) * 0.25, 0.85, 1.18),
  };
}

export function validTester(profile: TesterProfile): boolean {
  const common = profile.weight >= 35 && profile.weight <= 200 && profile.paceSeconds >= 150 && profile.paceSeconds <= 900;
  if (!common) return false;
  if (profile.device === "garmin") return profile.vo2max >= 20 && profile.vo2max <= 90 && profile.lactateThreshold >= 90 && profile.lactateThreshold <= 220 && profile.hrMax >= 120 && profile.hrMax <= 230;
  return profile.runningIndex >= 20 && profile.runningIndex <= 90 && profile.hrMax >= 120 && profile.hrMax <= 230 && profile.hrRest >= 30 && profile.hrRest <= 120;
}
