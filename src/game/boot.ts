import { Game } from "./game";
import type { BiomeId, Difficulty, UpgradeStat } from "./types";
import type { TesterProfile } from "./tester";
import { buyUpgrade } from "./state";

let session: Game | null = null;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  window.__GAME_READY__ = false;
  session = new Game(canvas);
}

export function stopGame(): void {
  session?.dispose();
  session = null;
}

export const gameActions = {
  selectBiome: (id: BiomeId) => session?.selectBiome(id),
  selectDifficulty: (difficulty: Difficulty) => session?.selectDifficulty(difficulty),
  openBriefing: () => session?.openBriefing(),
  beginCourse: () => session?.beginCourse(),
  pause: () => session?.pause(),
  resume: () => session?.resume(),
  restart: () => session?.beginCourse(),
  quitToTitle: () => session?.quitToTitle(),
  retire: () => session?.retire(),
  toggleMap: () => session?.toggleMap(),
  toggleCompass: () => session?.toggleCompass(),
  toggleMute: () => session?.toggleMute(),
  renderMap: (canvas: HTMLCanvasElement) => session?.renderMap(canvas),
  buyUpgrade: (stat: UpgradeStat) => buyUpgrade(stat),
  openTester: () => session?.openTester(),
  closeTester: () => session?.closeTester(),
  startTester: (profile: TesterProfile) => session?.startTester(profile),
  clearTester: () => session?.clearTester(),
};
