import { storage } from "./storage";
import type { UpgradeStat } from "./types";

export interface PlayerProfile {
  xp: number;
  level: number;
  skillPoints: number;
  upgrades: Record<UpgradeStat, number>;
}

const KEY = "orienteering.profile.v1";
const MAX_RANK = 8;

export function xpForLevel(level: number): number {
  return 120 + Math.max(0, level - 1) * 80;
}

function calculateLevel(xp: number): number {
  let level = 1, remaining = Math.max(0, xp);
  while (level < 30 && remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  return level;
}

function spentPoints(upgrades: Record<UpgradeStat, number>): number {
  return upgrades.speed + upgrades.strength + upgrades.recovery;
}

export function defaultProfile(): PlayerProfile {
  return { xp: 0, level: 1, skillPoints: 0, upgrades: { speed: 0, strength: 0, recovery: 0 } };
}

export function loadProfile(): PlayerProfile {
  const raw = storage.get<unknown>(KEY, null);
  if (!raw || typeof raw !== "object") return defaultProfile();
  const value = raw as Partial<PlayerProfile>;
  const xp = typeof value.xp === "number" && Number.isFinite(value.xp) ? Math.max(0, Math.min(100000, value.xp)) : 0;
  const upgrades = { speed: 0, strength: 0, recovery: 0 };
  for (const stat of Object.keys(upgrades) as UpgradeStat[]) {
    const rank = value.upgrades?.[stat];
    upgrades[stat] = typeof rank === "number" ? Math.max(0, Math.min(MAX_RANK, Math.floor(rank))) : 0;
  }
  const level = calculateLevel(xp);
  return { xp, level, upgrades, skillPoints: Math.max(0, (level - 1) * 3 - spentPoints(upgrades)) };
}

export function saveProfile(profile: PlayerProfile): void {
  storage.set(KEY, profile);
}

export function addExperience(profile: PlayerProfile, amount: number): PlayerProfile {
  const xp = profile.xp + Math.max(0, Math.round(amount));
  const level = calculateLevel(xp);
  return { xp, level, upgrades: { ...profile.upgrades }, skillPoints: Math.max(0, (level - 1) * 3 - spentPoints(profile.upgrades)) };
}

export function purchaseUpgrade(profile: PlayerProfile, stat: UpgradeStat): PlayerProfile {
  if (profile.skillPoints <= 0 || profile.upgrades[stat] >= MAX_RANK) return profile;
  const upgrades = { ...profile.upgrades, [stat]: profile.upgrades[stat] + 1 };
  return { ...profile, upgrades, skillPoints: profile.skillPoints - 1 };
}

export function xpIntoLevel(profile: PlayerProfile): number {
  let xp = profile.xp;
  for (let level = 1; level < profile.level; level++) xp -= xpForLevel(level);
  return xp;
}
