import * as THREE from "three";
import { AudioSystem } from "./audio";
import { GAME_CONFIG } from "./config";
import { getBiome, getCourse } from "./data";
import { GameLoop } from "./engine";
import { HandView } from "./hands";
import { Input } from "./input";
import { OrienteeringMap } from "./map";
import { clamp, mulberry32 } from "./random";
import { awardExperience, clearToast, getSnapshot, saveRecord, setSnapshot } from "./state";
import { testerModifiers, type TesterProfile } from "./tester";
import type { BiomeDef, BiomeId, Course, Difficulty, Split, Vec2 } from "./types";
import { World, type Surface } from "./world";

const TUTORIAL_TEXT = [
  "Иди к первому КП: WASD — движение, Shift — бег. Мышь — осмотреться.",
  "Зажми ЛКМ, чтобы поднять карту в правой руке. Колёсико поворачивает её; F + мышь перемещает, M раскрывает большую карту.",
  "Компас лежит на карте и показывает север. Нажми C для крупного компаса.",
  "Сверь азимут с направлением на КП. Около оранжево-белой призмы нажми E для отметки.",
  "Отметка принята! Кусты, валежник и болото замедляют. С поднятой картой можно идти, но не бежать.",
  "Все КП взяты. Доберись до финишных ворот и нажми E.",
];

const SURFACE_SPEED: Record<Surface, number> = {
  road: 1.14, trail: 1.07, grass: 1, meadow: 1.04, rough: 0.84,
  slow: 0.7, walk: 0.53, fight: 0.34, fallen: 0.6, thorn: 0.075, marsh: 0.5, water: 0.18,
};
const SURFACE_EFFORT: Record<Surface, number> = {
  road: 0, trail: 0, grass: 0.8, meadow: 0.3, rough: 2.5,
  slow: 5, walk: 8, fight: 13, fallen: 9, thorn: 24, marsh: 9, water: 17,
};
const SURFACE_NAMES: Record<Surface, string> = {
  road: "Асфальт", trail: "Тропа", grass: "Лес", meadow: "Поляна", rough: "Вырубка",
  slow: "Кустарник", walk: "Густой лес", fight: "Еловая зелёнка", fallen: "Валежник", thorn: "Сухая колючая заросль", marsh: "Болото", water: "Вода",
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private input: Input;
  private audio = new AudioSystem();
  private loop: GameLoop;
  private world: World | null = null;
  private mapRenderer: OrienteeringMap | null = null;
  private handView: HandView | null = null;
  private biome: BiomeDef;
  private course: Course;
  private player: Vec2 = { x: 0, z: 0 };
  private velocity: Vec2 = { x: 0, z: 0 };
  private yaw = 0;
  private pitch = 0;
  private stamina = 100;
  private elapsed = 0;
  private penalty = 0;
  private currentControl = 0;
  private splits: Split[] = [];
  private lastSplitTotal = 0;
  private interactionControl = -2;
  private bobPhase = 0;
  private footstepTimer = 0;
  private publishTimer = 0;
  private toastId = 0;
  private tutorialStep = 0;
  private tutorialMapSeen = false;
  private tutorialCompassSeen = false;
  private distanceWalked = 0;
  private frames = 0;
  private fpsTimer = 0;
  private lastRenderTime = performance.now();
  private fps = 60;
  private lowFpsTime = 0;
  private degraded = false;
  private disposed = false;
  private wetTimer = 0;
  private wasWater = false;
  private carCooldown = 0;
  private resultsReadyAt = 0;
  private pointerLockGraceUntil = 0;
  private pointerLockWasActive = false;
  private testerProfile: TesterProfile | null = null;
  private eventRng = mulberry32(90210);
  private eventTimer = 18;
  private majorEventTimer = 110;
  private flashlight = false;
  private flashlightLight = new THREE.SpotLight(0xffedc4, 0, 48, Math.PI / 5.2, 0.48, 1.15);
  private monsterScareTimer = 0;
  private handLook = { yaw: 0, pitch: 0 };
  private readonly onResize = () => this.resize();
  private readonly onCanvasClick = () => {
    if (getSnapshot().mode === "playing" && !getSnapshot().mapOpen) this.requestPointerLock();
  };
  private readonly onPointerLock = () => {
    if (document.pointerLockElement === this.canvas) {
      this.pointerLockWasActive = true;
      return;
    }
    const wasActive = this.pointerLockWasActive;
    this.pointerLockWasActive = false;
    const snap = getSnapshot();
    if (wasActive && performance.now() >= this.pointerLockGraceUntil && snap.mode === "playing" && !snap.mapOpen) this.pause();
  };

  constructor(private canvas: HTMLCanvasElement) {
    const snap = getSnapshot();
    this.biome = getBiome(snap.biomeId);
    this.course = getCourse(snap.biomeId, snap.difficulty);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GAME_CONFIG.MAX_PIXEL_RATIO));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.08, 520);
    this.camera.rotation.order = "YXZ";
    this.input = new Input(canvas);
    setSnapshot({ muted: this.audio.muted });
    this.setupWorld();
    this.resize();
    window.addEventListener("resize", this.onResize);
    document.addEventListener("pointerlockchange", this.onPointerLock);
    canvas.addEventListener("click", this.onCanvasClick);
    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: () => this.render() });
    this.loop.start();
    this.installTestHooks();
  }

  private setupWorld(): void {
    if (this.handView) {
      this.camera.remove(this.handView.group);
      this.handView.dispose();
    }
    this.world?.dispose();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.biome.sky);
    this.scene.fog = new THREE.FogExp2(this.biome.fog, this.biome.mine ? 0.026 : this.biome.urban ? 0.0055 : 0.0072);
    const hemi = new THREE.HemisphereLight(0xd9ede5, 0x344137, this.biome.mine ? 0.075 : 2.2);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d2, this.biome.mine ? 0.025 : 2.6);
    sun.position.set(-85, 130, 65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -150; sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150; sun.shadow.camera.bottom = -150;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 340;
    sun.shadow.bias = -0.00035;
    this.scene.add(sun);
    this.world = new World(this.scene, this.biome, this.course);
    this.mapRenderer = new OrienteeringMap(this.world, this.biome, this.course);
    this.handView = new HandView(this.mapRenderer);
    this.camera.add(this.handView.group);
    this.flashlightLight.position.set(0.18, -0.12, 0.05);
    this.flashlightLight.target.position.set(0, -0.08, -8);
    this.flashlightLight.intensity = 0;
    this.camera.add(this.flashlightLight, this.flashlightLight.target);
    this.scene.add(this.camera);
    this.resetPlayer();
  }

  private resetPlayer(): void {
    this.player.x = this.course.start.x;
    this.player.z = this.course.start.z + 3;
    this.velocity.x = this.velocity.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.camera.position.set(this.player.x, (this.world?.heightAt(this.player.x, this.player.z) ?? 0) + GAME_CONFIG.PLAYER_HEIGHT, this.player.z);
  }

  selectBiome(id: BiomeId): void {
    if (getSnapshot().mode !== "title") return;
    this.biome = getBiome(id);
    const difficulty = this.biome.tutorial ? "M12" : getSnapshot().difficulty;
    this.course = getCourse(id, difficulty);
    this.setupWorld();
    setSnapshot({ biomeId: id, difficulty, totalControls: this.course.controls.length, courseLength: this.course.nominalLength });
    this.audio.sfx("ui");
  }

  selectDifficulty(difficulty: Difficulty): void {
    if (getSnapshot().mode !== "title" || this.biome.tutorial) return;
    this.course = getCourse(this.biome.id, difficulty);
    this.setupWorld();
    setSnapshot({ difficulty, totalControls: this.course.controls.length, courseLength: this.course.nominalLength });
    this.audio.sfx("ui");
  }

  openBriefing(): void {
    if (getSnapshot().mode !== "title") return;
    setSnapshot({ mode: "briefing" });
    this.audio.sfx("ui");
  }

  openTester(): void {
    if (getSnapshot().mode !== "title") return;
    document.exitPointerLock?.();
    setSnapshot({ mode: "tester" });
    this.audio.sfx("ui");
  }

  closeTester(): void {
    if (getSnapshot().mode !== "tester") return;
    setSnapshot({ mode: "title" });
  }

  startTester(profile: TesterProfile): void {
    this.testerProfile = { ...profile };
    setSnapshot({ tester: true, mode: "briefing" });
    this.audio.sfx("ui");
  }

  clearTester(): void {
    this.testerProfile = null;
    setSnapshot({ tester: false });
    this.audio.sfx("ui");
  }

  beginCourse(): void {
    const snap = getSnapshot();
    if (snap.mode === "playing") return;
    if (this.biome.id !== snap.biomeId || this.course.difficulty !== snap.difficulty) {
      this.biome = getBiome(snap.biomeId);
      this.course = getCourse(snap.biomeId, snap.difficulty);
      this.setupWorld();
    }
    this.input.clearActions();
    this.input.consumeLook();
    this.pointerLockGraceUntil = performance.now() + 800;
    this.pointerLockWasActive = false;
    this.elapsed = 0; this.penalty = 0; this.currentControl = 0;
    this.splits = []; this.lastSplitTotal = 0; this.stamina = 100;
    this.tutorialStep = 0; this.tutorialMapSeen = false; this.tutorialCompassSeen = false; this.distanceWalked = 0;
    this.interactionControl = -2; this.wetTimer = 0; this.wasWater = false; this.carCooldown = 0;
    this.flashlight = false; this.flashlightLight.intensity = 0; this.monsterScareTimer = 0;
    this.eventRng = mulberry32(this.biome.seed + 7403);
    this.eventTimer = 16 + this.eventRng() * 12;
    this.majorEventTimer = 95 + this.eventRng() * 70;
    this.resetPlayer();
    this.world?.setCurrentControl(0);
    setSnapshot({
      mode: "playing", mapOpen: false, compassOpen: false, elapsed: 0, penalty: 0, stamina: 100,
      currentControl: 0, totalControls: this.course.controls.length, splits: [], finished: false,
      player: { ...this.player }, speed: 0, bearing: 0, canInteract: false, interactLabel: "",
      tutorialStep: 0, tutorialText: this.biome.tutorial ? TUTORIAL_TEXT[0] : "",
      courseLength: this.course.nominalLength, wet: false, mapRaised: false, surface: "grass",
      xpAwarded: 0, runLevel: snap.level, flashlight: false, monsterScare: false, mapAdjust: false, finishReason: "",
    });
    this.showToast(this.biome.tutorial ? "Следуй подсказкам. Первый КП уже ждёт!" : snap.tester ? "Тестовый старт: рекорды и опыт отключены." : "Старт! Время пошло.", "info");
    this.audio.startMusic();
    this.requestPointerLock();
  }

  pause(): void {
    if (getSnapshot().mode !== "playing") return;
    this.input.primaryDown = false;
    setSnapshot({ mode: "paused", mapOpen: false, mapRaised: false, mapAdjust: false });
    document.exitPointerLock?.();
    this.audio.stopMusic();
  }

  resume(): void {
    if (getSnapshot().mode !== "paused") return;
    this.input.clearActions();
    setSnapshot({ mode: "playing" });
    this.audio.startMusic();
    this.requestPointerLock();
  }

  quitToTitle(): void {
    document.exitPointerLock?.();
    this.audio.stopMusic();
    this.input.primaryDown = false;
    setSnapshot({ mode: "title", mapOpen: false, compassOpen: false, toast: null, wet: false, mapRaised: false, mapAdjust: false, monsterScare: false });
    if (this.world) this.world.monster.visible = false;
  }

  retire(): void {
    if (getSnapshot().mode !== "paused" && getSnapshot().mode !== "playing") return;
    this.finish(false);
  }

  toggleMap(): void {
    const snap = getSnapshot();
    if (snap.mode !== "playing") return;
    const mapOpen = !snap.mapOpen;
    if (mapOpen) this.tutorialMapSeen = true;
    this.input.primaryDown = false;
    setSnapshot({ mapOpen, mapRaised: false });
    if (mapOpen) document.exitPointerLock?.(); else this.requestPointerLock();
    this.audio.sfx("ui");
  }

  toggleCompass(): void {
    if (getSnapshot().mode !== "playing") return;
    this.tutorialCompassSeen = true;
    setSnapshot({ compassOpen: !getSnapshot().compassOpen });
    this.audio.sfx("ui");
  }

  toggleMute(): void {
    setSnapshot({ muted: this.audio.toggleMute() });
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const request = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      void request?.catch(() => undefined);
    } catch {
      // Keyboard play remains available when an iframe or browser denies pointer lock.
    }
  }

  renderMap(canvas: HTMLCanvasElement): void {
    const bearing = (-this.yaw * 180 / Math.PI + 360) % 360;
    this.mapRenderer?.render(canvas, this.player, bearing, this.currentControl);
  }

  private update(dt: number): void {
    if (this.disposed) return;
    this.world?.update(dt, this.player);
    const mode = getSnapshot().mode;
    if (mode === "title") {
      if (this.input.consumeAction("Space")) this.beginCourse();
      return;
    }
    if (mode === "tester") return;
    if (mode === "briefing") {
      if (this.input.consumeAction("Space") || this.input.consumeAction("Enter")) this.beginCourse();
      if (this.input.consumeAction("Escape")) this.quitToTitle();
      return;
    }
    if (mode === "paused") {
      if (this.input.consumeAction("Escape") || this.input.consumeAction("Space")) this.resume();
      return;
    }
    if (mode === "results") {
      if (performance.now() < this.resultsReadyAt) {
        this.input.clearActions();
        return;
      }
      if (this.input.consumeAction("Space")) this.beginCourse();
      if (this.input.consumeAction("Escape")) this.quitToTitle();
      return;
    }
    if (this.input.consumeAction("Escape")) {
      if (getSnapshot().mapOpen) this.toggleMap(); else this.pause();
      return;
    }
    if (this.input.consumeAction("KeyM") || this.input.consumeAction("Tab")) this.toggleMap();
    if (this.input.consumeAction("KeyC")) this.toggleCompass();
    if (this.input.consumeAction("KeyE")) this.interact();
    if (this.input.consumeAction("KeyL") && this.biome.mine) {
      this.flashlight = !this.flashlight;
      this.flashlightLight.intensity = this.flashlight ? 18 : 0;
      setSnapshot({ flashlight: this.flashlight });
      this.audio.sfx("ui");
      this.showToast(this.flashlight ? "Фонарик включён. Луч отпугивает то, что движется в штреках." : "Фонарик выключен. В темноте что-то приблизилось.", this.flashlight ? "info" : "warning");
    }

    this.elapsed += dt;
    const look = this.input.consumeLook();
    const mapRaised = this.input.primaryDown && !getSnapshot().mapOpen;
    const mapAdjust = mapRaised && this.input.isDown("KeyF");
    this.handLook.yaw = mapAdjust ? look.yaw : 0;
    this.handLook.pitch = mapAdjust ? look.pitch : 0;
    if (!getSnapshot().mapOpen && !mapAdjust) {
      this.yaw += look.yaw;
      this.pitch = clamp(this.pitch + look.pitch, -1.35, 1.35);
    }
    const moveX = this.input.moveX, moveZ = this.input.moveZ;
    const moving = Math.abs(moveX) + Math.abs(moveZ) > 0.05;
    const surface = this.world?.surfaceAt(this.player.x, this.player.z) ?? "grass";
    const inWater = surface === "water";
    if (inWater) {
      this.wetTimer = 20;
      if (!this.wasWater) {
        this.velocity.x *= 0.22; this.velocity.z *= 0.22;
        this.showToast("Глубоко! Одежда намокла — после выхода ты будешь тяжелее.", "warning");
        this.audio.sfx("hit");
      }
    } else {
      this.wetTimer = Math.max(0, this.wetTimer - dt);
    }
    this.wasWater = inWater;

    const snap = getSnapshot();
    const tester = snap.tester && this.testerProfile ? testerModifiers(this.testerProfile) : null;
    const speedUpgrade = tester ? tester.speed : 1 + snap.upgrades.speed * 0.028;
    const strength = tester ? tester.strength : 1 + snap.upgrades.strength * 0.055;
    const recovery = tester ? tester.recovery : 1 + snap.upgrades.recovery * 0.085;
    const staminaFactor = tester ? tester.stamina / 100 : 1;
    const baseSurface = SURFACE_SPEED[surface];
    const terrainFactor = 1 - (1 - baseSurface) / strength;
    const wetFactor = this.wetTimer > 0 && !inWater ? 0.82 : 1;
    const wantsRun = moving && !mapRaised && !inWater && (this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight")) && this.stamina > 0.5;
    const speed = (wantsRun ? GAME_CONFIG.RUN_SPEED : GAME_CONFIG.WALK_SPEED) * terrainFactor * speedUpgrade * wetFactor;
    const norm = Math.hypot(moveX, moveZ) || 1;
    const mx = moveX / norm, mz = moveZ / norm;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const desiredX = (-sin * mz + cos * mx) * speed;
    const desiredZ = (-cos * mz - sin * mx) * speed;
    const blend = Math.min(1, GAME_CONFIG.ACCELERATION * dt);
    this.velocity.x += (desiredX - this.velocity.x) * blend;
    this.velocity.z += (desiredZ - this.velocity.z) * blend;
    const oldX = this.player.x, oldZ = this.player.z;
    this.player.x += this.velocity.x * dt;
    this.player.z += this.velocity.z * dt;
    this.world?.resolveCollision(this.player);
    const ground = this.world?.heightAt(this.player.x, this.player.z) ?? 0;
    const ahead = this.world?.heightAt(this.player.x + this.velocity.x * 0.08, this.player.z + this.velocity.z * 0.08) ?? ground;
    const slopePenalty = clamp(1 - (ahead - ground) * 0.12 / strength, 0.68, 1.05);
    if (slopePenalty < 1 && moving) {
      this.player.x = oldX + (this.player.x - oldX) * slopePenalty;
      this.player.z = oldZ + (this.player.z - oldZ) * slopePenalty;
    }
    const actualSpeed = Math.hypot(this.player.x - oldX, this.player.z - oldZ) / dt;
    this.distanceWalked += actualSpeed * dt;
    if (wantsRun && actualSpeed > 0.5) {
      this.stamina -= (8.5 + SURFACE_EFFORT[surface] / strength) * this.biome.fatigue * dt / staminaFactor;
    } else {
      const terrainRecovery = surface === "thorn" ? 0.12 : surface === "fight" || surface === "water" ? 0.25 : surface === "marsh" || surface === "walk" ? 0.55 : 1;
      this.stamina += (moving ? 6 : 11) * recovery * terrainRecovery * (this.wetTimer > 0 ? 0.82 : 1) * dt;
    }
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.stamina <= 0.5) this.velocity.x *= 0.985, this.velocity.z *= 0.985;

    this.carCooldown = Math.max(0, this.carCooldown - dt);
    if (this.world?.traffic && this.carCooldown <= 0 && this.world.traffic.collision(this.player)) {
      this.carCooldown = 2.5;
      this.audio.sfx("hit");
      this.finish(false, "ДТП: столкновение с автомобилем. Машины тормозят заранее, но контакт с движущимся транспортом завершает дистанцию.");
      return;
    }

    this.bobPhase += actualSpeed * dt * 1.65;
    this.footstepTimer -= dt;
    if (actualSpeed > 1 && this.footstepTimer <= 0) {
      this.audio.step(surface, this.testerProfile?.weight ?? 75);
      this.footstepTimer = wantsRun ? 0.3 : 0.46;
    }
    if (this.biome.mine && this.world) {
      const darkness = this.flashlight ? 0 : this.course.difficulty === "ME" ? 1 : 0.78;
      if (this.world.updateMonster(dt, this.player, darkness)) {
        this.monsterScareTimer = this.course.difficulty === "ME" ? 1.45 : 0.95;
        this.stamina = Math.max(0, this.stamina - (this.course.difficulty === "ME" ? 28 : 16));
        this.audio.sfx("explosion");
        setSnapshot({ monsterScare: true });
        this.showToast("Оно вышло из бокового штрека! Включи фонарик — L.", "warning");
      }
      if (this.monsterScareTimer > 0) {
        this.monsterScareTimer -= dt;
        if (this.monsterScareTimer <= 0) setSnapshot({ monsterScare: false });
      }
    }
    this.updateEvents(dt);
    this.updateInteraction();
    this.updateTutorial();
    this.publishTimer += dt;
    if (this.publishTimer >= GAME_CONFIG.UI_PUBLISH_INTERVAL) {
      this.publishTimer = 0;
      this.publish(actualSpeed);
    }
  }

  private updateEvents(dt: number): void {
    this.eventTimer -= dt;
    this.majorEventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = 20 + this.eventRng() * 20;
      const nature = [
        "Сорока перелетела через тропу и явно знает более короткий маршрут.",
        "Заяц выскочил из кустов. Валежник за его спиной качнулся.",
        "Ветер шелестит в верхушках — компас, в отличие от деревьев, не отклонился.",
        "Где-то слева стучит дятел. Лес ненадолго стал громче.",
        "Бабочка кружит над поляной. Почти попросилась в коллеги по навигации.",
        "На тропе следы лося. Свежие, но владелец следов уже ушёл.",
      ];
      const city = [
        "Голубь занял весь тротуар и уступил только в последний момент.",
        "Во дворе скрипнули качели. Город живёт своей дистанцией.",
        "Велосипедист звякнул звонком и лихо объехал куст.",
        "Кот наблюдает с забора. Похоже, контролирует порядок прохождения КП.",
        "Светофор сменился. Поток машин на мгновение стал плотнее.",
      ];
      const recreation = [
        "На веранде стукнула дверь. Кто-то вышел посмотреть на лидера.",
        "Пахнет шашлыком. Сосредоточься: следующий КП не за беседкой.",
        "Собака на соседнем участке гавкнула и сразу вернулась спать.",
        "Из окна домика доносится радио. Сверяй карту, а не мелодию.",
      ];
      const mine = [
        "В глубине штрека звякнула рельса. Ты не прикасался к рельсам.",
        "С потолка упала каменная крошка. Слюда на стенах блеснула и погасла.",
        "За деревянной крепью прошелестели крылья летучих мышей.",
        "Из тупикового хода донёсся второй шаг — через долю секунды после твоего.",
        "Где-то позади скрипнула вагонетка. Вагонетка стоит на месте.",
      ];
      const list = this.biome.mine ? mine : this.biome.urban ? city : this.biome.id === "recreation" ? recreation : nature;
      this.showToast(list[Math.floor(this.eventRng() * list.length)], "info");
    }
    if (this.majorEventTimer <= 0) {
      this.majorEventTimer = 130 + this.eventRng() * 100;
      if (this.biome.mine) {
        this.showToast(this.flashlight ? "Большое событие: луч фонаря на секунду поймал силуэт в дальнем штреке." : "Большое событие: все звуки в выработке внезапно стихли. Кроме шагов за спиной.", "warning");
      } else if (this.biome.urban && this.world?.traffic) {
        this.world.traffic.jam(20);
        this.showToast("Большое событие: на центральной улице образовалась пробка. Машины почти встали.", "warning");
      } else if (this.eventRng() < 0.48) {
        this.wetTimer = Math.max(this.wetTimer, 14);
        this.showToast("Большое событие: внезапный ливень! Одежда промокла, восстановление замедлено.", "warning");
      } else {
        this.showToast("Большое событие: лось пересёк долину. На секунду весь лес замер.", "info");
      }
    }
  }

  private updateInteraction(): void {
    this.interactionControl = -2;
    let nearest: number = GAME_CONFIG.INTERACT_DISTANCE;
    if (!this.world) return;
    for (let i = 0; i < this.course.controls.length; i++) {
      const cp = this.course.controls[i];
      const d = Math.hypot(this.player.x - cp.x, this.player.z - cp.z);
      if (d < nearest) { nearest = d; this.interactionControl = i; }
    }
    const finishDistance = Math.hypot(this.player.x - this.course.finish.x, this.player.z - this.course.finish.z);
    if (finishDistance < nearest + 0.5) this.interactionControl = -1;
  }

  private interact(): void {
    if (getSnapshot().mode !== "playing" || getSnapshot().mapOpen) return;
    if (this.interactionControl === -1) {
      if (this.currentControl === this.course.controls.length) this.finish(true);
      else this.showToast(`Финиш пока не засчитан: осталось КП — ${this.course.controls.length - this.currentControl}`, "warning");
      return;
    }
    if (this.interactionControl < 0) {
      this.showToast("Подойди ближе к станции отметки", "info");
      return;
    }
    if (this.interactionControl !== this.currentControl) {
      this.penalty += GAME_CONFIG.WRONG_CONTROL_PENALTY;
      this.audio.sfx("hit");
      this.showToast(`Не тот порядок! +${GAME_CONFIG.WRONG_CONTROL_PENALTY} сек. Сейчас нужен КП ${this.currentControl + 1}.`, "warning");
      return;
    }
    const cp = this.course.controls[this.currentControl];
    const total = this.elapsed + this.penalty;
    this.splits.push({ number: this.currentControl + 1, code: cp.code, legTime: total - this.lastSplitTotal, totalTime: total });
    this.lastSplitTotal = total;
    this.currentControl++;
    this.world?.setCurrentControl(this.currentControl);
    this.handView?.punch();
    this.audio.sfx("pickup");
    this.showToast(this.currentControl === this.course.controls.length ? `КП ${cp.code} принят. Все пункты взяты — на финиш!` : `КП ${cp.code} принят • следующий: ${this.currentControl + 1}`, "success");
    this.publish(Math.hypot(this.velocity.x, this.velocity.z));
  }

  private updateTutorial(): void {
    if (!this.biome.tutorial) return;
    let step = this.tutorialStep;
    if (step === 0 && this.distanceWalked > 4) step = 1;
    if (step === 1 && this.tutorialMapSeen) step = 2;
    if (step === 2 && this.tutorialCompassSeen) step = 3;
    if (step === 3 && this.currentControl > 0) step = 4;
    if (step >= 3 && this.currentControl === this.course.controls.length) step = 5;
    if (step !== this.tutorialStep) {
      this.tutorialStep = step;
      setSnapshot({ tutorialStep: step, tutorialText: TUTORIAL_TEXT[step] });
    }
  }

  private publish(speed: number): void {
    let label = "";
    if (this.interactionControl === -1) label = this.currentControl === this.course.controls.length ? "E — финишировать" : "Финиш закрыт: не все КП";
    else if (this.interactionControl >= 0) {
      const cp = this.course.controls[this.interactionControl];
      label = this.interactionControl === this.currentControl ? `E — отметиться на КП ${cp.code}` : `КП ${cp.code} — сейчас не твой`;
    }
    const surface = this.world?.surfaceAt(this.player.x, this.player.z) ?? "grass";
    setSnapshot({
      elapsed: this.elapsed, penalty: this.penalty, stamina: this.stamina, speed,
      bearing: (-this.yaw * 180 / Math.PI % 360 + 360) % 360,
      player: { x: this.player.x, z: this.player.z }, currentControl: this.currentControl,
      canInteract: this.interactionControl !== -2, interactLabel: label,
      splits: [...this.splits], fps: this.fps, drawCalls: this.renderer.info.render.calls,
      wet: this.wetTimer > 0, mapRaised: this.input.primaryDown && !getSnapshot().mapOpen,
      surface: SURFACE_NAMES[surface], flashlight: this.flashlight,
      monsterScare: this.monsterScareTimer > 0,
      mapAdjust: this.input.primaryDown && this.input.isDown("KeyF") && !getSnapshot().mapOpen,
    });
  }

  private finish(success: boolean, reason = ""): void {
    this.input.primaryDown = false;
    this.input.clearActions();
    this.resultsReadyAt = performance.now() + 900;
    document.exitPointerLock?.();
    this.audio.stopMusic();
    if (this.world) this.world.monster.visible = false;
    let xpAwarded = 0;
    if (success) {
      const total = this.elapsed + this.penalty;
      this.splits.push({ number: this.splits.length + 1, code: 999, legTime: total - this.lastSplitTotal, totalTime: total });
      saveRecord(total);
      if (!getSnapshot().tester) {
        xpAwarded = 30 + this.course.controls.length * 10 + this.biome.terrainDifficulty * 5 + (this.course.difficulty === "ME" ? 35 : this.course.difficulty === "M16" ? 20 : 0);
        awardExperience(xpAwarded);
      }
      this.audio.sfx("win");
    } else this.audio.sfx("lose");
    setSnapshot({
      mode: "results", finished: success, mapOpen: false, compassOpen: false,
      elapsed: this.elapsed, penalty: this.penalty, splits: [...this.splits],
      currentControl: this.currentControl, toast: null, wet: this.wetTimer > 0, mapRaised: false, xpAwarded,
      mapAdjust: false, monsterScare: false, finishReason: reason,
    });
  }

  private showToast(text: string, tone: "info" | "success" | "warning"): void {
    const id = ++this.toastId;
    setSnapshot({ toast: { id, text, tone } });
    window.setTimeout(() => clearToast(id), 3400);
  }

  private render(): void {
    if (this.disposed || !this.world) return;
    const mode = getSnapshot().mode;
    const now = performance.now();
    const frameDt = Math.min(0.25, Math.max(0, (now - this.lastRenderTime) / 1000));
    this.lastRenderTime = now;
    if (mode === "title" || mode === "briefing" || mode === "tester") {
      const t = now * 0.00007;
      this.camera.position.set(Math.sin(t) * 128, 48 + Math.sin(t * 1.7) * 5, Math.cos(t) * 128);
      this.camera.lookAt(0, 4, 0);
    } else {
      const ground = this.world.heightAt(this.player.x, this.player.z);
      const bob = Math.sin(this.bobPhase * 2) * Math.min(0.035, Math.hypot(this.velocity.x, this.velocity.z) * 0.005);
      this.camera.position.set(this.player.x, ground + GAME_CONFIG.PLAYER_HEIGHT + bob, this.player.z);
      this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase) * 0.003, "YXZ");
    }
    if (this.handView && this.mapRenderer) {
      this.handView.group.visible = mode === "playing" && !getSnapshot().mapOpen;
      if (this.handView.group.visible) {
        const bearing = (-this.yaw * 180 / Math.PI % 360 + 360) % 360;
        const adjusting = this.input.primaryDown && this.input.isDown("KeyF");
        this.handView.update(frameDt, this.input.primaryDown, this.input.consumeWheel(), bearing, this.player, this.currentControl, adjusting, this.handLook, this.biome.mine ? (this.flashlight ? 1 : 0.12) : 1);
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    this.fpsTimer += frameDt;
    if (this.fpsTimer >= 1) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      if (getSnapshot().mode === "playing" && this.fps < 45) this.lowFpsTime += this.fpsTimer; else this.lowFpsTime = 0;
      if (this.lowFpsTime > 3 && !this.degraded) {
        this.degraded = true;
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = false;
        this.resize();
      }
      this.frames = 0; this.fpsTimer = 0;
    }
    if (!window.__GAME_READY__) window.__GAME_READY__ = true;
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth, height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private installTestHooks(): void {
    window.__gameProbe = () => ({ x: this.player.x, y: this.camera.position.y, z: this.player.z });
    if (new URLSearchParams(location.search).has("test")) {
      window.__gameTest = {
        start: (biome: BiomeId, difficulty: Difficulty) => {
          if (getSnapshot().mode !== "title") this.quitToTitle();
          this.selectBiome(biome); this.selectDifficulty(difficulty); this.beginCourse();
        },
        teleportNext: () => {
          const target = this.currentControl < this.course.controls.length ? this.course.controls[this.currentControl] : this.course.finish;
          this.player.x = target.x; this.player.z = target.z + 0.8; this.updateInteraction(); this.publish(0);
        },
        teleport: (x: number, z: number) => { this.player.x = x; this.player.z = z; this.updateInteraction(); this.publish(0); },
        interact: () => this.interact(),
        surface: () => this.world?.surfaceAt(this.player.x, this.player.z) ?? "grass",
        carPosition: () => this.world?.traffic?.firstCarPosition() ?? null,
        waterPosition: () => this.world?.waters[0] ? { x: this.world.waters[0].x, z: this.world.waters[0].z } : null,
        treeCount: (x: number, z: number) => this.world?.treeCountNear(x, z, 10) ?? 0,
        snapshot: getSnapshot,
      };
    }
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerlockchange", this.onPointerLock);
    this.canvas.removeEventListener("click", this.onCanvasClick);
    document.exitPointerLock?.();
    this.input.dispose();
    this.audio.dispose();
    this.handView?.dispose();
    this.world?.dispose();
    this.renderer.dispose();
    delete window.__gameProbe;
    delete window.__gameTest;
    window.__GAME_READY__ = false;
  }
}

declare global {
  interface Window {
    __GAME_READY__: boolean;
    __gameProbe?: () => { x: number; y: number; z: number };
    __gameTest?: {
      start: (biome: BiomeId, difficulty: Difficulty) => void;
      teleportNext: () => void;
      teleport: (x: number, z: number) => void;
      interact: () => void;
      surface: () => Surface;
      carPosition: () => Vec2 | null;
      waterPosition: () => Vec2 | null;
      treeCount: (x: number, z: number) => number;
      snapshot: typeof getSnapshot;
    };
  }
}
